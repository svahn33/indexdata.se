#!/usr/bin/env python3
"""Create Indexdata's transparent *modelled* Swedish petrol 95 price.

Data dependencies, all already collected by this site's GitHub Actions:
- EU EnergyPrices (source: EU Commission weekly retail petrol 95 with tax)
- EIA/FRED DCOILBRENTEU Brent spot (USD/barrel)
- Riksbank SEKUSDPMI and SEKEURPMI daily SEK per currency unit

Method: weekly EUR pump quote -> approximate SEK via that week's Riksbank
EUR/SEK; crude proxy = 1.25 * Brent[USD/barrel] * USDSEK / 158.9873.
Estimate = median(weekly pump SEK - weekly crude proxy, last 8–12 weeks)
          + current five-session mean crude proxy.
The 1.25 is a *sensitivity assumption* incorporating VAT, NOT a statement
about physical refining yield or a causal statistical estimate.
Backtest: one-week-ahead, rolling median of SIX preceding observations;
the interval is an indicative error band, not a confidence interval.

Only publishes data when enough real observations exist. Never fake prices.
"""
from __future__ import annotations

import json
import logging
import math
import statistics
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data'
OUT = DATA / 'fuel_model.json'
BARREL_LITRES = 158.9873
PASS_THROUGH = 1.25
LOG = logging.getLogger('fuel-model')


def read_json(path):
    try:
        obj = json.loads(path.read_text(encoding='utf-8'))
        return obj if isinstance(obj, dict) else {}
    except (OSError, ValueError):
        return {}


def number(x, lo=None, hi=None):
    if isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x):
        return None
    if lo is not None and x < lo or hi is not None and x > hi:
        return None
    return float(x)


def iso_day(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = date.fromisoformat(value)
        return parsed if parsed.isoformat() == value else None
    except ValueError:
        return None


def points(series, low, high):
    cleaned = {}
    for item in series if isinstance(series, list) else []:
        if not isinstance(item, dict):
            continue
        day, value = iso_day(item.get('date')), number(item.get('value'), low, high)
        if day is not None and value is not None:
            cleaned[day] = value
    return sorted(cleaned.items())


def latest_before(series, when, max_age=7):
    for day, value in reversed(series):
        delta = (when - day).days
        if delta >= 0:
            return (day, value) if delta <= max_age else None
    return None


def daily_crude_proxy(brent, usd, when, require_oil_today=False):
    # Five last *observations* in previous 8 calendar days: reduces one-day jumps.
    recent = [(d, v) for d, v in brent if 0 <= (when - d).days <= 8]
    oil = recent[-5:]
    if len(oil) < 3 or (when - oil[-1][0]).days > 5:
        return None
    fx = latest_before(usd, when, 7)
    if not fx:
        return None
    oil_avg = statistics.mean(v for d, v in oil)
    return {'date':oil[-1][0], 'oil_usd_per_barrel':oil_avg,
            'oil_latest_date':oil[-1][0], 'fx_usdsek':fx[1],
            'fx_latest_date':fx[0],
            'proxy':PASS_THROUGH * oil_avg * fx[1] / BARREL_LITRES}


def weekly_observations(fuel, brent, usd, eur, today):
    results = []
    hist = fuel.get('history') if isinstance(fuel, dict) else []
    if not isinstance(hist, list):
        return results
    for row in hist:
        if not isinstance(row, dict):
            continue
        day = iso_day(row.get('date'))
        if day is None or day > today or (today-day).days > 240:
            continue
        p = row.get('petrol')
        value_eur = number(p.get('value_eur_per_l') if isinstance(p, dict) else None, .25, 5)
        if value_eur is None:
            continue
        pair = latest_before(eur, day, 7)
        crude = daily_crude_proxy(brent, usd, day)
        if not pair or not crude:
            continue
        pump_sek = value_eur * pair[1]
        if not 5 <= pump_sek <= 45:
            continue
        results.append({'date':day, 'observed_price':pump_sek,
                        'crude_proxy':crude['proxy'], 'residual':pump_sek-crude['proxy']})
    # one observation per official weekly date
    return list({q['date']:q for q in results}.values())


def rolling_errors(weekly, window=6, count=8):
    errors = []
    # Held-out week's actual is not used when forecasting that week.
    for i in range(max(window, len(weekly)-count), len(weekly)):
        prev = weekly[max(0, i-window):i]
        if len(prev)<window:
            continue
        offset = statistics.median(p['residual'] for p in prev)
        forecast = offset + weekly[i]['crude_proxy']
        errors.append(abs(forecast-weekly[i]['observed_price']))
    return errors


def build(market, commodities, fuel, now=None):
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        raise ValueError('now must have time zone')
    today=now.date()
    history = market.get('history', {}) if isinstance(market, dict) else {}
    comhist = commodities.get('history', {}) if isinstance(commodities, dict) else {}
    usd = points(history.get('SEKUSDPMI'), 4, 20)
    eur = points(history.get('SEKEURPMI'), 4, 20)
    brent = points(comhist.get('brent'), 15, 250)
    if not usd or not eur or not brent:
        raise ValueError('Daily Brent, USD/SEK and EUR/SEK history required')
    current_brent = latest_before(brent, today, 7)
    current_usd = latest_before(usd, today, 7)
    current_eur = latest_before(eur, today, 7)
    if not (current_brent and current_usd and current_eur):
        raise ValueError('Current oil or currency data too old (>7 days)')
    crude = daily_crude_proxy(brent, usd, current_brent[0])
    if not crude:
        raise ValueError('Not enough recent Brent observations')
    # The historical official observations are the only price anchors.
    weekly = sorted(weekly_observations(fuel, brent, usd, eur, today),key=lambda r:r['date'])
    if len(weekly) < 10:
        raise ValueError(f'Need >=10 aligned official weeks (got {len(weekly)})')
    if (today-weekly[-1]['date']).days > 21:
        raise ValueError('Latest official price >21 days old')
    calibration = weekly[-10:]
    offset = statistics.median(p['residual'] for p in calibration)
    estimate = offset+crude['proxy']
    if not 7<=estimate<=45:
        raise ValueError('Implausible model output')
    errors = rolling_errors(weekly,window=6,count=8)
    if len(errors)<4:
        raise ValueError('Not enough weekly data for retrospective error analysis')
    mae = statistics.mean(errors)
    # At minimum 0.50 kr and generous scaling; descriptive not 95% probability.
    band = min(4.0, max(0.5, round(1.5*mae,2)))
    timeline=[]
    for d, _ in brent:
        if not 0<=(today-d).days<=35:
            continue
        v=daily_crude_proxy(brent,usd,d)
        if v:
            timeline.append({'date':d.isoformat(),'value':round(offset+v['proxy'],2)})
    latest_week = weekly[-1]
    return {
        'generated_at':now.isoformat(timespec='seconds'),
        'kind':'scenario_model_not_observed_pump_price',
        'fuel':'petrol_95', 'unit':'SEK/l', 'includes_taxes':'via weekly reference prices',
        'estimate_sek_per_l':round(estimate,2),
        'indicative_lower_sek_per_l':round(max(0,estimate-band),2),
        'indicative_upper_sek_per_l':round(estimate+band,2),
        'indicative_band_sek_per_l':band,
        'rolling_backtest_mae_sek_per_l':round(mae,2),
        'backtest_weeks':len(errors),
        'last_official_observation':latest_week['date'].isoformat(),
        'latest_official_sek_per_l_approx':round(latest_week['observed_price'],2),
        'reference_brent_usd_per_barrel':round(crude['oil_usd_per_barrel'],3),
        'brent_latest_date':crude['oil_latest_date'].isoformat(),
        'reference_usdsek':round(crude['fx_usdsek'],5),
        'usdsek_latest_date':crude['fx_latest_date'].isoformat(),
        'eursek_latest_date':current_eur[0].isoformat(),
        'calibration_weeks':len(calibration),
        'calibration_offset_sek_per_l':round(offset,5),
        'crude_pass_through_multiplier':PASS_THROUGH,
        'litres_per_barrel':BARREL_LITRES,
        'recent_history':timeline[-35:],
        'sources':[
            {'name':'EU Oil Bulletin via EU EnergyPrices','url':'https://www.euenergyprices.eu/en/data'},
            {'name':'Brent / EIA via FRED','url':'https://fred.stlouisfed.org/series/DCOILBRENTEU'},
            {'name':'Valutor / Sveriges riksbank','url':'https://www.riksbank.se/sv/statistik/rantor-och-valutakurser/hamta-rantor-och-valutakurser-via-api/'},
        ],
        'method': 'rullande median av senaste 10 officiella veckopriser minus råoljeproxy; aktuell råoljeproxy adderas; oljeproxy = 1,25 × Brent × USD/SEK ÷ 158,9873',
        'disclaimer': 'Modellestimat, inte uppmätt pumppris eller statistiskt konfidensintervall. Förändrad beskattning, raffinaderimarginaler, biokomponenter och tidsförskjutningar fångas inte i realtid.',
    }


def run(market_path=DATA/'market.json', commodities_path=DATA/'commodities.json',
        fuel_path=DATA/'fuel.json', output=OUT, now=None):
    market, com, fuel = (read_json(p) for p in (market_path, commodities_path, fuel_path))
    try:
        result = build(market, com, fuel, now=now)
        result['status']='ok'
        LOG.info('Modelled petrol95 = %.2f SEK/l',result['estimate_sek_per_l'])
    except (ValueError, TypeError, KeyError, ZeroDivisionError) as exc:
        # Explicitly clear stale model output instead of leaving a misleading price.
        result={'status':'unavailable', 'generated_at':(now or datetime.now(timezone.utc)).isoformat(timespec='seconds'),
                'kind':'scenario_model_not_observed_pump_price','reason':str(exc)}
        LOG.warning('No model available: %s',exc)
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return result


if __name__=='__main__':
    logging.basicConfig(level=logging.INFO)
    run()
