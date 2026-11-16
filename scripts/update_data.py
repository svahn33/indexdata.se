#!/usr/bin/env python3
"""Update Svensk Makropuls official indicators, run weekdays via GitHub Actions.

No API key. Standard library only. Per-source failures keep previously published
observations with their ORIGINAL observation dates, and mark source degraded.
"""
from __future__ import annotations

import json
import logging
import math
import os
from pathlib import Path
import time
from datetime import datetime, timedelta, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, quote
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'data' / 'market.json'
RIKSBANK = 'https://api.riksbank.se/swea/v1'
SCB = 'https://statistikdatabasen.scb.se/api/v2/tables'
ECB_FX_HISTORY = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml'
LOG = logging.getLogger('makropuls')

# These group IDs and series IDs are documented by Sveriges riksbank.
RATES_GROUPS = [2, 6, 7, 9, 100, 130, 151]  # policy, bills, government, mortgage, global, FX, KIX
SERIES = [
    'SECBREPOEFF', 'SETB3MBENCH', 'SEGVB2YC', 'SEGVB5YC',
    'SEGVB7YC', 'SEGVB10YC', 'SEMB2YCACOMB', 'SEMB5YCACOMB',
    'USGVB5Y', 'USGVB10Y', 'DEGVB10Y', 'NOGVB10Y',
    'GBGVB10Y', 'JPGVB10Y', 'SEKUSDPMI', 'SEKEURPMI',
    'SEKNOKPMI', 'SEKDKKPMI', 'SEKGBPPMI', 'SEKCHFPMI', 'SEKKIX92',
]
# History of a few important series for charts (not every series, to respect the free API limit).
HISTORY_SERIES = ['SEGVB10YC', 'SEGVB2YC', 'USGVB10Y', 'DEGVB10Y', 'SEKUSDPMI', 'SEKEURPMI', 'SECBREPOEFF']


class RateLimitedClient:
    def __init__(self, min_interval=13.0):
        self.last_riksbank_request = None
        self.min_interval = min_interval

    def get(self, url, *, riksbank=False):
        if riksbank and self.last_riksbank_request is not None:
            wait = self.min_interval - (time.monotonic() - self.last_riksbank_request)
            if wait > 0:
                LOG.info('Riksbank API pacing %.1fs', wait)
                time.sleep(wait)
        for attempt in range(3):
            if riksbank:
                self.last_riksbank_request = time.monotonic()
            request = Request(url, headers={
                'Accept': 'application/json',
                'User-Agent': 'SvenskMakropuls/1.0 (+open-data-dashboard)',
            })
            try:
                with urlopen(request, timeout=28) as response:
                    raw = response.read(7_000_000)
                return json.loads(raw)
            except HTTPError as exc:
                if exc.code not in (429, 500, 502, 503, 504) or attempt == 2:
                    raise
                wait = 65 if exc.code == 429 else 5 * (attempt + 1)
                LOG.warning('HTTP %s for %s; waiting %ss', exc.code, url, wait)
                time.sleep(wait)
            except (TimeoutError, URLError, ConnectionError):
                if attempt == 2:
                    raise
                time.sleep(4 * (attempt + 1))
        raise RuntimeError('Unreachable')


def to_float(v):
    if isinstance(v, bool) or v is None:
        return None
    try:
        n = float(str(v).replace(',', '.'))
        return n if math.isfinite(n) else None
    except (TypeError, ValueError):
        return None


def normalize_date(value):
    """Return YYYY-MM-DD or None. SCB monthly codes '2026M10'."""
    if not value:
        return None
    text = str(value)
    if len(text) >= 10 and text[4] == '-' and text[7] == '-':
        return text[:10]
    if len(text) == 7 and text[4] == 'M' and text[:4].isdigit() and text[5:].isdigit():
        return f'{text[:4]}-{text[5:]}-01'
    return None


def normalize_riksbank_latest(records, allowed):
    """Turn group observations or a single record into consistent normalized points."""
    if isinstance(records, dict):
        records = [records]
    if not isinstance(records, list):
        raise ValueError('Unexpected Riksbank observation payload')
    output = {}
    for item in records:
        if not isinstance(item, dict):
            continue
        sid = str(item.get('seriesId', '')).upper()
        val = to_float(item.get('value'))
        dt = normalize_date(item.get('date'))
        if sid in allowed and val is not None and dt:
            output[sid] = {'value': val, 'date': dt, 'source': 'Sveriges riksbank'}
    return output


def normalize_riksbank_history(items):
    if not isinstance(items, list):
        raise ValueError('Unexpected Riksbank history payload')
    points = []
    for item in items:
        if isinstance(item, dict):
            value = to_float(item.get('value'))
            dt = normalize_date(item.get('date'))
            if value is not None and dt:
                points.append({'date': dt, 'value': value})
    # Series can have revised observations for the same date: later entry wins.
    return [dict(date=d, value=v) for d, v in sorted({p['date']: p['value'] for p in points}.items())]


def get_riksbank(client, result):
    count = 0
    errors = []
    for group in RATES_GROUPS:
        url = f'{RIKSBANK}/Observations/Latest/ByGroup/{group}'
        try:
            obs = normalize_riksbank_latest(client.get(url, riksbank=True), set(SERIES))
            if not obs:
                raise ValueError('No matching series found')
            result['indicators'].update(obs)
            LOG.info('Riksbank group %s: %d series', group, len(obs))
            count += len(obs)
        except Exception as exc:
            errors.append(f'group {group}: {str(exc)[:120]}')
            LOG.warning('Riksbank group %s failed: %s', group, exc)
    # A group can fail independently. Fetch separate histories where available.
    after = (datetime.now(timezone.utc) - timedelta(days=395)).date().isoformat()
    before = datetime.now(timezone.utc).date().isoformat()
    for sid in HISTORY_SERIES:
        try:
            url = f'{RIKSBANK}/Observations/{quote(sid)}/{after}/{before}'
            points = normalize_riksbank_history(client.get(url, riksbank=True))
            if not points:
                raise ValueError('Empty history')
            result['history'][sid] = points[-300:]
            last = points[-1]
            if sid not in result['indicators'] or result['indicators'][sid]['date'] < last['date']:
                result['indicators'][sid] = {'value': last['value'], 'date': last['date'], 'source': 'Sveriges riksbank'}
            LOG.info('Riksbank history %s: %d points', sid, len(points))
            count += 1
        except Exception as exc:
            errors.append(f'history {sid}: {str(exc)[:110]}')
            LOG.warning('Riksbank history %s failed: %s', sid, exc)
    return count, errors



def parse_ecb_fx_xml(raw):
    """Parse the ECB's official EUR-base daily reference XML; return SEK per USD/EUR."""
    root=ET.fromstring(raw)
    quotes={}
    for node in root.iter():
        if node.tag.rsplit('}',1)[-1]!='Cube' or 'time' not in node.attrib:
            continue
        date=normalize_date(node.attrib['time'])
        if not date:
            continue
        rates={}
        for child in node:
            if child.tag.rsplit('}',1)[-1]!='Cube':
                continue
            code=child.attrib.get('currency')
            price=to_float(child.attrib.get('rate'))
            if code in ('SEK','USD') and price and price>0:
                rates[code]=price
        if 4<=rates.get('SEK',0)<=20 and 0.5<=rates.get('USD',0)<=2:
            quotes[date]={'SEKUSDPMI':rates['SEK']/rates['USD'],
                          'SEKEURPMI':rates['SEK']}
    if len(quotes)<3:
        raise ValueError('ECB daily FX XML lacks SEK and USD observations')
    return quotes


def update_ecb_fx(client,result):
    """ECB is an independent no-key fallback if Riksbank FX is behind.

    Keep older Riksbank history for long model backtests; ECB supplies newer
    observations, never backdate rates or mix an old USD rate with today's date.
    """
    req=Request(ECB_FX_HISTORY,headers={
        'User-Agent':'Indexdata/1.0 (public economics dashboard)',
        'Accept':'text/xml,application/xml',
    })
    with urlopen(req,timeout=25) as response:
        raw=response.read(2_500_000)
    fx=parse_ecb_fx_xml(raw)
    source='Europeiska centralbanken (ECB)'
    count=0
    for sid in ('SEKUSDPMI','SEKEURPMI'):
        existing=result['history'].get(sid,[])
        merged={row['date']:row['value'] for row in existing
                if isinstance(row,dict) and normalize_date(row.get('date')) and to_float(row.get('value')) is not None}
        # Do not override a Riksbank observation on the same date, only add missing dates.
        for day,values in fx.items():
            merged.setdefault(day,round(values[sid],6))
        combined=[{'date':day,'value':value} for day,value in sorted(merged.items())]
        result['history'][sid]=combined[-350:]
        day=max(fx)
        val=fx[day][sid]
        current=result['indicators'].get(sid,{})
        if day>current.get('date',''):
            result['indicators'][sid]={'date':day,'value':round(val,6),'source':source}
            count+=1
        elif not current.get('date'):
            result['indicators'][sid]={'date':day,'value':round(val,6),'source':source}
            count+=1
    return 2,[]  # XML hämtades; Riksbanken kan redan ha lika färska noteringar.


def dim_labels(json_stat, dim):
    category = json_stat['dimension'][dim]['category']
    idx = category.get('index', {})
    labels = category.get('label', {})
    # JSON-stat index can be a dictionary or array. Preserve order using indices.
    if isinstance(idx, list):
        return [(key, str(labels.get(key, key))) for key in idx]
    return [(key, str(labels.get(key, key))) for key, _ in sorted(idx.items(), key=lambda item: item[1])]


def json_stat_slice(json_stat, measure, time_key='Tid', metrics_key='ContentsCode'):
    """Retrieve a named ContentsCode (by code) from JSON-stat 2 with arbitrary dimension order."""
    ids = json_stat['id']
    sizes = json_stat['size']
    if metrics_key not in ids or time_key not in ids:
        raise ValueError(f'Unexpected SCB dimensions: {ids}')
    if len(ids) != 2:
        raise ValueError(f'SCB table gained dimensions (no implicit aggregation): {ids}')
    metric_keys = [x[0] for x in dim_labels(json_stat, metrics_key)]
    if measure not in metric_keys:
        raise ValueError(f'ContentsCode {measure} not present')
    metric_index = metric_keys.index(measure)
    times = [x[0] for x in dim_labels(json_stat, time_key)]
    values = json_stat.get('value', [])
    out = []
    for tpos, t in enumerate(times):
        coordinates = {metrics_key: metric_index, time_key: tpos}
        flattened = 0
        for i, dim in enumerate(ids):
            stride = math.prod(sizes[i+1:])
            flattened += coordinates[dim] * stride
        cell = values[flattened] if isinstance(values, list) and flattened < len(values) else values.get(str(flattened)) if isinstance(values, dict) else None
        number = to_float(cell)
        date = normalize_date(t)
        if number is not None and date:
            out.append({'date': date, 'value': number})
    return out


def choose_measure(metadata, target):
    """Find rate-of-change ContentsCode by clear label, never silently choose index level."""
    pairs = dim_labels(metadata, 'ContentsCode')
    if target == 'KPIF':
        found = [(code, lab) for code, lab in pairs if '12-mån' in lab.lower() or '12 mån' in lab.lower() or '12 month' in lab.lower()]
    else:
        found = [(code, lab) for code, lab in pairs if 'årsförändring' in lab.lower() or '12-mån' in lab.lower() or 'year-on-year' in lab.lower()]
    if len(found) != 1:
        raise ValueError(f'No unique year-over-year measure for {target}: {pairs}')
    return found[0][0]


def get_scb(client, result):
    count = 0
    errors = []
    for table, target, outkey in [('TAB6590','KPIF','KPIF_YOY'), ('TAB6596','KPI','KPI_YOY')]:
        try:
            metadata = client.get(f'{SCB}/{table}/metadata?lang=sv')
            measure = choose_measure(metadata, target)
            params = urlencode({'lang':'sv','valueCodes[ContentsCode]':measure,'valueCodes[Tid]':'top(36)','outputFormat':'json-stat2'})
            data = client.get(f'{SCB}/{table}/data?{params}')
            points = json_stat_slice(data, measure)
            if not points:
                raise ValueError('No monthly observations available')
            result['history'][outkey] = points[-36:]
            result['indicators'][outkey] = {'value': points[-1]['value'], 'date': points[-1]['date'], 'source':'SCB'}
            LOG.info('SCB %s: %d monthly values', target, len(points))
            count += 1
        except Exception as exc:
            errors.append(f'{target}: {str(exc)[:140]}')
            LOG.warning('SCB %s failed: %s', target, exc)
    return count, errors


def normalize_omxs30_chart(payload, now=None):
    """Read a delayed OMX Stockholm 30 quote; reject missing, implausible and old data.

    Yahoo is an *unofficial* best-effort quote feed. Keep the exchange date on
    the observation, not the date we downloaded it, so weekend values survive.
    """
    now = now or datetime.now(timezone.utc)
    entries = payload.get('chart', {}).get('result') if isinstance(payload, dict) else None
    if not isinstance(entries, list) or not entries or not isinstance(entries[0], dict):
        raise ValueError('OMXS30: chart.result missing (provider unavailable or rate-limited)')
    chart = entries[0]
    meta = chart.get('meta') or {}
    if str(meta.get('symbol', '')).upper() not in ('^OMX', '^OMXS30'):
        raise ValueError('OMXS30: unexpected index symbol')
    price = to_float(meta.get('regularMarketPrice'))
    # 'chartPreviousClose' may be the FIRST close in a multi-day range, rather
    # than the previous trading day. Use 'previousClose' or last two daily bars.
    previous = to_float(meta.get('previousClose'))
    quote_rows = (chart.get('indicators') or {}).get('quote') or []
    closes = [to_float(v) for v in (quote_rows[0].get('close') or [])] if quote_rows and isinstance(quote_rows[0], dict) else []
    closes = [v for v in closes if v is not None]
    if price is None and closes:
        price = closes[-1]
    if previous is None and len(closes) >= 2:
        previous = closes[-2]
    if previous is None:
        previous = to_float(meta.get('chartPreviousClose'))

    raw_time = meta.get('regularMarketTime')
    try:
        timestamp = int(raw_time)
    except (TypeError, ValueError):
        timestamps = chart.get('timestamp') or []
        timestamp = int(timestamps[-1]) if timestamps else 0
    if timestamp <= 0:
        raise ValueError('OMXS30: no quotation timestamp')
    stamp = datetime.fromtimestamp(timestamp, timezone.utc)
    if price is None or previous is None or not (300 < price < 20000 and 300 < previous < 20000):
        raise ValueError('OMXS30: invalid price or previous close')
    if stamp > now + timedelta(hours=1) or now - stamp > timedelta(days=8):
        raise ValueError('OMXS30: quotation older than 8 days')
    percent = (price / previous - 1) * 100
    if not math.isfinite(percent) or abs(percent) >= 50:
        raise ValueError('OMXS30: implausible daily percent change')
    return {
        'price': round(price, 2),
        'previous_close': round(previous, 2),
        'change_percent': round(percent, 4),
        'price_time': stamp.isoformat(timespec='seconds'),
        'source': 'Yahoo Finance (fördröjd; inofficiellt gränssnitt)',
        'symbol': str(meta['symbol']).upper()
    }


def update_omxs30(client, result):
    """Fetch a delayed quote server-side (avoids browser CORS). Cache valid data.

    Use ^OMX first: Yahoo identifies it as its Stockholm exchange instrument,
    while ^OMXS30 is a Nasdaq GIDS mirror. Do NOT retry or use additional
    endpoints after HTTP 429, to respect the provider's rate limit.
    """
    errors = []
    for symbol in ('%5EOMX', '%5EOMXS30'):
        url = f'https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=5d&interval=1d'
        try:
            request = Request(url, headers={
                'Accept': 'application/json',
                'User-Agent': 'Indexdata/1.0 (delayed OMX Stockholm 30 quotation)',
            })
            with urlopen(request, timeout=12) as response:
                payload = json.loads(response.read(700_000))
            quote = normalize_omxs30_chart(payload)
            previous = result.get('omxs30')
            if isinstance(previous, dict):
                prior_time = previous.get('price_time', '')
                # Do not regress the last verified session during provider lag.
                if prior_time and prior_time > quote['price_time']:
                    LOG.info('OMXS30: keeping newer existing quote %s', prior_time)
                    return 1, []
            result['omxs30'] = quote
            LOG.info('OMXS30 %s: %.2f%%, observation %s', quote['symbol'], quote['change_percent'], quote['price_time'])
            return 1, []
        except HTTPError as exc:
            errors.append(f'{symbol}: HTTP {exc.code}')
            if exc.code in (401, 403, 429):
                break  # No evasion of provider access controls/rate limits.
        except Exception as exc:
            errors.append(f'{symbol}: {str(exc)[:110]}')
    # Preserve the previous snapshot, but never change its observation date.
    LOG.warning('OMXS30 could not be refreshed: %s', '; '.join(errors))
    print('::warning title=OMXS30 quote unavailable::' + '; '.join(errors)[:350])
    return 0, ['; '.join(errors) or 'OMXS30 provider unavailable']


def main():
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    if OUTPUT.exists():
        result = json.loads(OUTPUT.read_text(encoding='utf8'))
    else:
        result = {}
    result.setdefault('indicators', {})
    result.setdefault('history', {})
    result.setdefault('sources', {})
    result['generated_at'] = datetime.now(timezone.utc).isoformat(timespec='seconds')
    client = RateLimitedClient(min_interval=float(os.environ.get('RIKSBANK_INTERVAL_SECONDS', '13')))
    for source, func in [('riksbank', get_riksbank), ('ecb', update_ecb_fx), ('scb', get_scb), ('omxs30', update_omxs30)]:
        try:
            count, errors = func(client, result)
        except Exception as exc:
            count, errors = 0, [str(exc)[:180]]
            LOG.warning('%s source failed: %s', source, exc)
        old = result['sources'].get(source, {})
        result['sources'][source] = {
            'status': 'ok' if count and not errors else 'partial' if count else 'error',
            'last_success': result['generated_at'] if count else old.get('last_success'),
            'count': count,
            'message': 'Alla anrop lyckades' if not errors else '; '.join(errors)[:500]
        }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True) + '\n', encoding='utf8')
    LOG.info('Wrote %s with %s indicators; status=%s', OUTPUT, len(result['indicators']), {s:v['status'] for s,v in result['sources'].items()})
    # The site can still serve old data if one source is down. Do not fail the entire job.
    # On a completely failed first fetch, mark the status prominently in the output.


if __name__ == '__main__':
    main()
