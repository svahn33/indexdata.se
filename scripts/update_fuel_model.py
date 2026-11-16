#!/usr/bin/env python3
"""Create Indexdata's transparent *modelled* Swedish petrol 95 and diesel prices.

Data dependencies, all already collected by this site's GitHub Actions:
- EU EnergyPrices (source: EU Commission weekly retail petrol 95 with tax)
- EIA/FRED DCOILBRENTEU Brent spot (USD/barrel)
- Riksbank SEKUSDPMI and SEKEURPMI daily SEK per currency unit

Method v2: weekly EU EUR/l quotes are converted to SEK using historical FX.
Market input = USD Brent × USD/SEK / 158.9873 (75% latest Brent +
25% median of its last 3 fixings). Estimate is anchored to the latest EU
weekly retail quote, blended with a 10-week median residual; petrol and
diesel get their own shrinkage-constrained sensitivity coefficient.
An older fixed 1.25 median-offset model is kept as a benchmark. 12 recent
rolling one-week-ahead predictions (each trained on strictly earlier weeks)
select the newer model only if it is no worse within 5% tolerance.
The reported band is an indicative retrospective absolute-error range, not
a probabilistic confidence interval.
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
LITRE_FACTOR = 1.0 / BARREL_LITRES
MIN_SENSITIVITY = 0.55
MAX_SENSITIVITY = 2.10
ANCHOR_SHARE = 0.70
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
    """Latest eligible published Brent and USD/SEK values as of `when`.

    Brent and FX publish independently. A new USD/SEK observation must affect
    the estimate even when the latest Brent fixing was several days earlier.
    No synthetic intraday oil prices are made up.
    """
    oil=latest_before(brent,when,7)
    fx=latest_before(usd,when,7)
    if not oil or not fx:
        return None
    if require_oil_today and oil[0]!=when:
        return None
    oil_day,oil_value=oil
    fx_day,fx_value=fx
    return {'date':max(oil_day,fx_day), 'oil_usd_per_barrel':oil_value,
            'oil_latest_date':oil_day, 'fx_usdsek':fx_value,
            'fx_latest_date':fx_day,
            'proxy':PASS_THROUGH*oil_value*fx_value/BARREL_LITRES}


def market_base(brent, usd, when):
    """SEK/l of crude input, from published Brent and SEK/USD only.

    A small three-fixing oil median component dampens isolated spot spikes,
    while the freshest independent USD/SEK fixing still applies immediately.
    """
    latest_oil = latest_before(brent, when, 7)
    latest_usd = latest_before(usd, when, 7)
    if not latest_oil or not latest_usd:
        return None
    recent_oil = [v for d, v in brent if d <= latest_oil[0]][-3:]
    smooth_oil = 0.75 * latest_oil[1] + 0.25 * statistics.median(recent_oil)
    return {
        'value': smooth_oil * latest_usd[1] * LITRE_FACTOR,
        'oil_day': latest_oil[0], 'oil': latest_oil[1], 'oil_smoothed': smooth_oil,
        'usd_day': latest_usd[0], 'usd': latest_usd[1],
        'market_day': max(latest_oil[0], latest_usd[0]),
    }


def weekly_observations(fuel, brent, usd, eur, today, fuel_kind='petrol'):
    """Align EU's national weekly quote with market observations *at that date*."""
    results = []
    hist = fuel.get('history') if isinstance(fuel, dict) else []
    if not isinstance(hist, list):
        return results
    for row in hist:
        if not isinstance(row, dict):
            continue
        day = iso_day(row.get('date'))
        if day is None or day > today or (today-day).days > 370:
            continue
        p = row.get(fuel_kind)
        value_eur = number(p.get('value_eur_per_l') if isinstance(p, dict) else None, .25, 5)
        if value_eur is None:
            continue
        eur_fixing = latest_before(eur, day, 7)
        market = market_base(brent, usd, day)
        if not eur_fixing or not market:
            continue
        sek = value_eur * eur_fixing[1]
        if not 5 <= sek <= 45:
            continue
        results.append({'date': day, 'observed_price': sek,
                        'market_base': market['value'],
                        # Keep the legacy residual for old-model comparison.
                        'crude_proxy': PASS_THROUGH * market['value'],
                        'residual': sek - PASS_THROUGH * market['value']})
    return sorted({r['date']: r for r in results}.values(), key=lambda r: r['date'])


def fitted_sensitivity(weekly):
    """Regularized, capped relationship between weekly price and crude changes.

    No free multi-parameter fit: fit only one sensitivity on up to 30 weeks,
    strongly shrink to the existing 1.25 assumption if data are weak.
    """
    recent = weekly[-30:]
    if len(recent) < 14:
        return PASS_THROUGH
    pairs = []
    for a, b in zip(recent, recent[1:]):
        if (b['date'] - a['date']).days > 15:
            continue
        x = b['market_base'] - a['market_base']
        y = b['observed_price'] - a['observed_price']
        # Winsorize the influence of outsized retail shifts (taxes/promos).
        y = max(-2.0, min(2.0, y))
        pairs.append((x, y))
    if len(pairs) < 12:
        return PASS_THROUGH
    # 5 SEK² of prior strength: with fewer/lower-movement weeks the coefficient
    # remains close to 1.25. Do not pretend this identifies a causal effect.
    prior_strength = 5.0
    numerator = prior_strength * PASS_THROUGH + sum(x * y for x, y in pairs)
    denominator = prior_strength + sum(x * x for x, _ in pairs)
    return max(MIN_SENSITIVITY, min(MAX_SENSITIVITY, numerator / denominator))


def estimate_from_history(weekly, target_base, mode='anchored'):
    """Predict using only earlier official weekly observations.

    anchored: newest EU week + oil/FX movement since then, blended with a
    robust 10-week residual estimate to reduce sensitivity to one report.
    legacy: old fixed-sensitivity median-offset model, used as a benchmark.
    """
    if len(weekly) < 6:
        raise ValueError('Need six previous official weeks for rolling comparison')
    beta = fitted_sensitivity(weekly) if mode == 'anchored' else PASS_THROUGH
    recent = weekly[-10:]
    reference = recent[-1]
    residual = statistics.median(r['observed_price'] - beta * r['market_base'] for r in recent)
    history_estimate = residual + beta * target_base
    if mode == 'legacy':
        return history_estimate, beta
    anchor_estimate = reference['observed_price'] + beta * (target_base - reference['market_base'])
    return ANCHOR_SHARE * anchor_estimate + (1 - ANCHOR_SHARE) * history_estimate, beta


def rolling_backtest(weekly, count=12):
    """Rolling-origin one-week-ahead tests for both candidates, no target leak."""
    results = {'anchored': [], 'legacy': []}
    for i in range(max(6, len(weekly) - count), len(weekly)):
        train = weekly[:i]
        actual = weekly[i]
        if len(train) < 6 or (actual['date'] - train[-1]['date']).days > 15:
            continue
        for method in results:
            guess, _ = estimate_from_history(train, actual['market_base'], method)
            results[method].append(abs(guess - actual['observed_price']))
    return results


def rolling_errors(weekly, window=10, count=12):
    """Compatibility helper returning anchored rolling absolute errors."""
    return rolling_backtest(weekly, count=count)['anchored']


def build_single(market, commodities, fuel, now=None, fuel_kind='petrol'):
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        raise ValueError('now must have time zone')
    today = now.date()
    history = market.get('history', {}) if isinstance(market, dict) else {}
    comhist = commodities.get('history', {}) if isinstance(commodities, dict) else {}
    usd = points(history.get('SEKUSDPMI'), 4, 20)
    eur = points(history.get('SEKEURPMI'), 4, 20)
    brent = points(comhist.get('brent'), 15, 250)
    if not usd or not eur or not brent:
        raise ValueError('Daily Brent, USD/SEK and EUR/SEK history required')
    current_market = market_base(brent, usd, today)
    current_eur = latest_before(eur, today, 7)
    if not current_market or not current_eur:
        raise ValueError('Current oil or currency data too old (>7 days)')
    weekly = weekly_observations(fuel, brent, usd, eur, today, fuel_kind=fuel_kind)
    if len(weekly) < 10:
        raise ValueError(f'Need >=10 aligned official weeks (got {len(weekly)})')
    if (today - weekly[-1]['date']).days > 21:
        raise ValueError('Latest official price >21 days old')

    tested = rolling_backtest(weekly)
    if min(len(tested['anchored']), len(tested['legacy'])) < 4:
        raise ValueError('Not enough weeks for one-week-ahead validation')
    anchored_mae = statistics.mean(tested['anchored'])
    baseline_mae = statistics.mean(tested['legacy'])
    # Conservative automatic safeguard: only adopt the more elaborate model
    # if recent held-out weeks do not show meaningfully worse error.
    use_anchored = anchored_mae <= 1.05 * baseline_mae
    chosen_mode = 'anchored' if use_anchored else 'legacy'
    estimate, beta = estimate_from_history(weekly, current_market['value'], chosen_mode)
    if not 7 <= estimate <= 45:
        raise ValueError('Implausible model output')
    errors = tested[chosen_mode]
    mae = statistics.mean(errors)
    band = min(5.0, max(0.5, round(1.5 * mae, 2)))

    # Scenario history uses the current calibration (not historical predictions).
    timeline = []
    observation_days = sorted({d for d, _ in brent if 0 <= (today-d).days <= 35} |
                              {d for d, _ in usd if 0 <= (today-d).days <= 35})
    for day in observation_days:
        v = market_base(brent, usd, day)
        if v:
            y, _ = estimate_from_history(weekly, v['value'], chosen_mode)
            timeline.append({'date': day.isoformat(), 'value': round(y, 4)})
    prior = timeline[-2] if len(timeline) >= 2 else None
    change = ((estimate / prior['value']) - 1) * 100 if prior and prior['value'] > 0 else None
    latest_week = weekly[-1]
    return {
        'generated_at': now.isoformat(timespec='seconds'),
        'kind': 'scenario_model_not_observed_pump_price',
        'model_version': 2,
        'model_selection': chosen_mode,
        'fuel': 'petrol_95' if fuel_kind == 'petrol' else 'diesel',
        'unit': 'SEK/l', 'includes_taxes': 'via weekly reference prices',
        'estimate_sek_per_l': round(estimate, 2),
        'change_percent': round(change, 3) if change is not None else None,
        'change_reference_date': prior['date'] if prior else None,
        'market_observation_date': current_market['market_day'].isoformat(),
        'brent_source': 'EIA via FRED (dagligt spotpris)',
        'fx_source': market.get('indicators', {}).get('SEKUSDPMI', {}).get('source', 'Riksbanken/ECB'),
        'indicative_lower_sek_per_l': round(max(0, estimate - band), 2),
        'indicative_upper_sek_per_l': round(estimate + band, 2),
        'indicative_band_sek_per_l': band,
        'rolling_backtest_mae_sek_per_l': round(mae, 2),
        'rolling_backtest_mae_refined_sek_per_l': round(anchored_mae, 2),
        'rolling_backtest_mae_baseline_sek_per_l': round(baseline_mae, 2),
        'backtest_weeks': len(errors),
        'last_official_observation': latest_week['date'].isoformat(),
        'latest_official_sek_per_l_approx': round(latest_week['observed_price'], 2),
        'reference_brent_usd_per_barrel': round(current_market['oil'], 3),
        'reference_smoothed_brent_usd_per_barrel': round(current_market['oil_smoothed'], 6),
        'brent_latest_date': current_market['oil_day'].isoformat(),
        'reference_usdsek': round(current_market['usd'], 5),
        'usdsek_latest_date': current_market['usd_day'].isoformat(),
        'eursek_latest_date': current_eur[0].isoformat(),
        'calibration_weeks': min(10, len(weekly)),
        'sensitivity_training_weeks': min(30, len(weekly)),
        'calibration_offset_sek_per_l': round(statistics.median(
            w['observed_price'] - beta * w['market_base'] for w in weekly[-10:]), 5),
        'crude_pass_through_multiplier': round(beta, 5),
        'litres_per_barrel': BARREL_LITRES,
        'market_oil_smoothing': '75 % senaste publicerade Brent + 25 % median av tre publicerade Brent-noteringar',
        'recent_history': [{'date': x['date'], 'value': round(x['value'], 2)} for x in timeline[-35:]],
        'sources': [
            {'name': 'EU-kommissionen / Oil Bulletin', 'url': 'https://energy.ec.europa.eu/data-and-analysis/weekly-oil-bulletin_en'},
            {'name': 'Brent / EIA via FRED', 'url': 'https://fred.stlouisfed.org/series/DCOILBRENTEU'},
            {'name': 'Valutor / Sveriges riksbank och ECB', 'url': 'https://www.riksbank.se/sv/statistik/rantor-och-valutakurser/hamta-rantor-och-valutakurser-via-api/'},
        ],
        'method': ('Ankrar till senaste officiella svenska EU-veckopriset och väger samman med '
                   '10-veckors medianavvikelse; beräknar separat, regulariserad Brent/SEK-känslighet '
                   'för bensin och diesel. Jämför mot äldre medianmodell på tidigare, ej använda EU-veckor '
                   'och väljer den enklare om den nya visar mer än 5 procent högre historiskt fel.'),
        'disclaimer': ('Modellestimat, inte uppmätt stationspris eller ett statistiskt konfidensintervall. '
                       'Oljepriset och valutor kan vara fördröjda. Lokal konkurrens, skatter, raffineringsmarginaler, '
                       'biodrivmedelsinblandning och prissättningsfördröjningar modelleras inte fullständigt.'),
    }


def build(market, commodities, fuel, now=None):
    """Produce the established petrol fields plus an independent diesel model.

    Diesel does not overwrite the petrol model if its official series is sparse.
    Both calibrations use their own EU weekly retail price observations.
    """
    petrol = build_single(market, commodities, fuel, now, fuel_kind='petrol')
    try:
        diesel = build_single(market, commodities, fuel, now, fuel_kind='diesel')
        diesel['status'] = 'ok'
    except (ValueError, TypeError, KeyError, ZeroDivisionError) as exc:
        diesel = {'status':'unavailable', 'fuel':'diesel',
                  'kind':'scenario_model_not_observed_pump_price', 'reason':str(exc)}
    petrol['diesel_model'] = diesel
    return petrol


def run(market_path=DATA/'market.json', commodities_path=DATA/'commodities.json',
        fuel_path=DATA/'fuel.json', output=OUT, now=None):
    market, com, fuel = (read_json(p) for p in (market_path, commodities_path, fuel_path))
    try:
        result = build(market, com, fuel, now=now)
        result['status']='ok'
        LOG.info('Modelled petrol95 %.2f SEK/l, diesel %s, Brent observation %s, USD/SEK observation %s',result['estimate_sek_per_l'], result['diesel_model']['status'], result['brent_latest_date'], result['usdsek_latest_date'])
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
