#!/usr/bin/env python3
"""Fetch public commodity / Swedish power prices for static GitHub Pages.

Sources:
  EIA daily spot prices distributed as downloadable CSV by FRED (no key)
  World Bank Pink Sheet monthly historical workbook
  Spotwatts free and redistributable SE1-SE4 quarter-hour day-ahead prices

We preserve each observation date and source attribution; no fabricated backfill.
This job can safely run repeatedly, including on weekends.
"""
from __future__ import annotations

import csv
import io
import json
import logging
import re
import time
import zipfile
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'data' / 'commodities.json'
WORLD_BANK_PAGE = 'https://www.worldbank.org/en/research/commodity-markets'
WORLD_BANK_FALLBACK = ('https://thedocs.worldbank.org/en/doc/'
    '74e8be41ceb20fa0da750cda2f6b9e4e-0050012026/related/CMO-Historical-Data-Monthly.xlsx')
FRED_DOWNLOAD = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id={series}&cosd={start}'
SPOTWATTS = 'https://spotwatts.com/api/v1/{zone}/today.json'
LOG = logging.getLogger('commodities')
NS = {'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
      'r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
      'p':'http://schemas.openxmlformats.org/package/2006/relationships'}

EIA_SERIES = {
    'brent': ('DCOILBRENTEU', 'USD/fat'),
    'wti': ('DCOILWTICO', 'USD/fat'),
    'gas_us': ('DHHNGSP', 'USD/MMBtu'),
}
# World Bank column names change occasionally; normalize and match EXACT aliases.
WB_COLUMNS = {
    'gold': ('GOLD',), 'silver': ('SILVER',),
    'copper': ('COPPER',), 'aluminum': ('ALUMINUM', 'ALUMINIUM'),
    'wheat': ('WHEAT_US_HRW', 'IWHEAT_US_HRW', 'WHEATUSHRW'),
    'maize': ('MAIZE',), 'coffee': ('COFFEE_ARABIC', 'ICOFFEE_ARABIC'),
    'sugar': ('SUGAR_WORLD', 'SUGAR', 'ISUGAR_WORLD'),
    'brent_month': ('CRUDE_BRENT', 'OIL_BRENT'),
    'wti_month': ('CRUDE_WTI', 'OIL_WTI'),
    'gas_us_month': ('NATURAL_GAS_US', 'NGAS_US'),
}
WB_UNITS = {
    'gold':'USD/troy oz','silver':'USD/troy oz','copper':'USD/ton',
    'aluminum':'USD/ton','wheat':'USD/ton','maize':'USD/ton',
    'coffee':'USD/kg','sugar':'USD/kg',
    'brent_month':'USD/fat','wti_month':'USD/fat','gas_us_month':'USD/MMBtu'
}


def download(url, *, limit=9_000_000, attempts=2, pause=2):
    for attempt in range(attempts):
        try:
            req = Request(url, headers={
                'User-Agent':'Indexdata/1.0 (public economics dashboard; data source attribution)',
                'Accept':'application/json,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/html,*/*',
            })
            with urlopen(req, timeout=35) as resp:
                raw = resp.read(limit + 1)
                if len(raw) > limit:
                    raise ValueError('Source too large for safe import')
                return raw
        except (HTTPError, URLError, TimeoutError) as exc:
            if attempt == attempts - 1 or (isinstance(exc, HTTPError) and exc.code not in (429, 500, 502, 503, 504)):
                raise
            time.sleep(pause)


def to_num(value):
    try:
        if value is None or isinstance(value, bool): return None
        v = float(str(value).replace(',', '.').strip())
        return v if abs(v) < 1e15 and v == v and v not in (float('inf'), float('-inf')) else None
    except (ValueError, TypeError):
        return None


def parse_csv_series(data, series):
    rows = csv.DictReader(io.StringIO(data.decode('utf-8-sig')))
    if not rows.fieldnames or series not in rows.fieldnames:
        raise ValueError(f'Invalid FRED CSV headers for {series}: {rows.fieldnames}')
    date_col = rows.fieldnames[0]
    out = {}
    for row in rows:
        date, value = row.get(date_col, ''), to_num(row.get(series, ''))
        if re.fullmatch(r'\d{4}-\d{2}-\d{2}', date or '') and value is not None:
            out[date] = value
    if not out: raise ValueError(f'No valid FRED observations: {series}')
    return [{'date':d, 'value':v} for d,v in sorted(out.items())][-400:]


def parse_spotwatts_day(obj, expected_zone, now=None):
    """Convert 15-minute day-ahead spot prices from SEK/kWh to öre/kWh.

    Important: the quote is the *active interval*, not the day's average.
    Interval start/end include their UTC offset (DST-safe).
    """
    if not isinstance(obj, dict) or obj.get('zone', '').upper() != expected_zone.upper():
        raise ValueError('Power area mismatch')
    day = obj.get('date', '')
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', day):
        raise ValueError('Power price day missing')
    if obj.get('currency') != 'SEK' or obj.get('unit') != 'SEK/kWh':
        raise ValueError('Unexpected power price units')
    intervals=[]
    for item in obj.get('intervals', []):
        try:
            start=datetime.fromisoformat(item['start'])
            end=datetime.fromisoformat(item['end'])
            price=to_num(item['price'])
            if not price is not None or start.tzinfo is None or end.tzinfo is None or start >= end:
                continue
            if start.date().isoformat()!=day:
                continue
            intervals.append({'start':item['start'], 'end':item['end'], 'value':round(price*100, 3)})
        except (TypeError, ValueError, KeyError):
            continue
    if not intervals:
        raise ValueError('Missing quarter-hour power prices')
    intervals.sort(key=lambda row: datetime.fromisoformat(row['start']))
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        raise ValueError('Current time requires timezone')
    current=next((item for item in intervals
                  if datetime.fromisoformat(item['start']) <= now < datetime.fromisoformat(item['end'])), None)
    return {'date':day,'intervals':intervals,'current':current,
            'source':'Spotwatts / ENTSO-E','frequency':'quarter','unit':'öre/kWh',
            'description':'Aktuellt kvartpris exkl. moms och avgifter'}


class WorkbookLinkParser(HTMLParser):
    def __init__(self):
        super().__init__(); self.links=[]
    def handle_starttag(self, tag, attrs):
        if tag == 'a':
            href = dict(attrs).get('href','')
            if href.lower().split('?')[0].endswith('/cmo-historical-data-monthly.xlsx'):
                self.links.append(href)


def wb_url(html):
    from urllib.parse import urljoin
    p=WorkbookLinkParser(); p.feed(html)
    return urljoin(WORLD_BANK_PAGE, p.links[0]) if p.links else WORLD_BANK_FALLBACK


def col_number(cell_ref):
    letters = re.match(r'^([A-Z]+)', cell_ref or '')
    if not letters:return None
    n=0
    for c in letters.group(1):n=n*26+ord(c)-64
    return n-1


def read_xlsx_monthly(content):
    """Read 2D cell values of World Bank's 'Monthly Prices' sheet using stdlib XML.
    Supports shared strings, inline strings, cached formula values, sparse rows.
    """
    with zipfile.ZipFile(io.BytesIO(content)) as z:
        names=set(z.namelist())
        book=ET.fromstring(z.read('xl/workbook.xml'))
        rels=ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
        relmap={e.attrib['Id']: e.attrib['Target'] for e in rels}
        ref=None
        for sh in book.findall('s:sheets/s:sheet',NS):
            if sh.attrib.get('name')=='Monthly Prices':
                target=relmap.get(sh.attrib['{%s}id'%NS['r']])
                if target:
                    # Targets can be /xl/worksheets/sheet2.xml or worksheets/sheet2.xml.
                    import posixpath
                    ref=target.lstrip('/') if target.startswith('/') else posixpath.normpath('xl/'+target)
                break
        if not ref or ref not in names:
            raise ValueError('World Bank Monthly Prices sheet not found')
        shared=[]
        if 'xl/sharedStrings.xml' in names:
            root=ET.fromstring(z.read('xl/sharedStrings.xml'))
            for si in root.findall('s:si',NS):
                shared.append(''.join(x.text or '' for x in si.iter('{%s}t'%NS['s'])))
        root=ET.fromstring(z.read(ref))
        rows=[]
        for row in root.findall('.//s:sheetData/s:row',NS):
            out={}
            for c in row.findall('s:c',NS):
                n=col_number(c.attrib.get('r',''))
                if n is None:continue
                t=c.attrib.get('t')
                if t=='inlineStr':
                    val=''.join(e.text or '' for e in c.iter('{%s}t'%NS['s']))
                else:
                    el=c.find('s:v',NS)
                    val=el.text if el is not None else None
                    if t=='s' and val is not None:
                        try: val=shared[int(val)]
                        except (ValueError,IndexError):val=None
                if val is not None:out[n]=val
            if out:rows.append(out)
        if not rows:raise ValueError('Empty World Bank workbook')
        return rows


def normalize_wb_header(value):
    return re.sub(r'[^A-Z0-9]', '', str(value).upper())


def month_date(value):
    """Typical World Bank labels: 2026M10, 2026-Oct, 2026-Oct; no conversion of daily values."""
    s=str(value).strip()
    m=re.fullmatch(r'(\d{4})M(\d{1,2})',s,flags=re.I)
    if m and 1<=int(m[2])<=12:return f'{m[1]}-{int(m[2]):02d}-01'
    m=re.fullmatch(r'(\d{4})[- ]([a-zA-Z]{3})',s)
    months={name:i+1 for i,name in enumerate('Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split())}
    if m and m[2].title() in months:return f'{m[1]}-{months[m[2].title()]:02d}-01'
    m=re.fullmatch(r'(\d{4})-(\d{2})(?:-\d{2})?',s)
    if m and 1<=int(m[2])<=12:return f'{m[1]}-{m[2]}-01'
    return None


def parse_worldbank_prices(content):
    rows = read_xlsx_monthly(content)
    # Find actual header row from the code-name intersection, not hard-coded offsets.
    best=(0,None,{})
    for idx,row in enumerate(rows[:16]):
        found={}
        for field, aliases in WB_COLUMNS.items():
            allowed={normalize_wb_header(x) for x in aliases}
            found_cols=[col for col,val in row.items() if normalize_wb_header(val) in allowed]
            if found_cols: found[field]=found_cols[0]
        if len(found)>best[0]:best=(len(found),idx,found)
    if best[0]<4:raise ValueError(f'World Bank header not recognized: {best[0]} commodities')
    _,hdr_idx,cols=best
    out={key:[] for key in cols}
    for row in rows[hdr_idx+1:]:
        d=month_date(row.get(0))
        if not d:continue
        for field,col in cols.items():
            v=to_num(row.get(col))
            if v is not None:out[field].append({'date':d,'value':v})
    return {k:v[-84:] for k,v in out.items() if v}


def store_series(result,key,points,unit,source,frequency):
    if not points:raise ValueError('No observations')
    clean=sorted(({'date':p['date'],'value':float(p['value'])} for p in points),key=lambda p:p['date'])
    unique={p['date']:p for p in clean}
    current=sorted(unique.values(),key=lambda p:p['date'])
    existing=result['quotes'].get(key)
    # Protect against older data overwriting newer observations on delayed updates.
    last=current[-1]
    if existing and existing.get('date','')>last['date']:
        LOG.warning('Ignoring stale update for %s (%s older than %s)',key,last['date'],existing['date'])
        return False
    result['history'][key]=current[-400:]
    result['quotes'][key]={**last,'unit':unit,'source':source,'frequency':frequency}
    return True


def update_eia(client,result):
    count=0; errors=[]
    start=(datetime.now(timezone.utc)-timedelta(days=440)).date().isoformat()
    for key,(series,unit) in EIA_SERIES.items():
        try:
            raw=client(FRED_DOWNLOAD.format(series=series,start=start),limit=400000)
            points=parse_csv_series(raw,series)
            if store_series(result,key,points,unit,'EIA via FRED','day'):count+=1
        except Exception as e:
            LOG.warning('EIA/FRED %s failed: %s',key,e)
            errors.append(f'{series}: {str(e)[:100]}')
    return count,errors


def update_worldbank(client,result):
    errors=[]
    try: url=wb_url(client(WORLD_BANK_PAGE,limit=1500000).decode('utf-8'))
    except Exception as e:
        LOG.warning('World Bank landing page failed (%s); using previously validated URL',e)
        url=WORLD_BANK_FALLBACK
    try:
        raw=client(url,limit=9000000)
        parsed=parse_worldbank_prices(raw)
        count=0
        for key,pts in parsed.items():
            try:
                # World Bank monthlies are used as explicitly labelled fallback
                # ONLY if an EIA daily series is completely unavailable.
                if key.endswith('_month'):
                    target=key[:-6]
                    if target in result['quotes']:
                        continue
                    unit=WB_UNITS[key]
                    key=target
                else:
                    unit=WB_UNITS[key]
                if store_series(result,key,pts,unit,'Världsbanken','month'):count+=1
            except Exception as e:
                errors.append(f'{key}: {str(e)[:100]}')
        if not count:raise ValueError('No usable monthly observations')
        return count,errors
    except Exception as e:
        LOG.warning('World Bank failed: %s',e)
        return 0,[f'Pink Sheet: {str(e)[:150]}']


def update_power(client,result):
    errors=[];count=0
    result.setdefault('power_intervals',{})
    for i in range(1,5):
        zone=f'se{i}';key=f'power_{zone}'
        try:
            obj=json.loads(client(SPOTWATTS.format(zone=zone),limit=280000))
            day=parse_spotwatts_day(obj,zone)
            # Do not replace today's data with an older day (rare stale cache).
            stored=result['power_intervals'].get(key,{}).get('date','')
            if stored > day['date']:
                errors.append(f'{zone}: old day ignored')
                continue
            result['power_intervals'][key]={
                'date':day['date'], 'unit':'öre/kWh', 'intervals':day['intervals']
            }
            current=day['current']
            if current:
                result['quotes'][key]={
                    'date':day['date'], 'start':current['start'], 'end':current['end'],
                    'value':current['value'], 'unit':'öre/kWh',
                    'frequency':'quarter', 'source':day['source']
                }
            else:
                # No currently active interval: do not expose yesterday's price as today's.
                result['quotes'].pop(key,None)
            # Old day-average history must not masquerade as quarter-hour observations.
            result['history'].pop(key,None)
            count+=1
        except Exception as e:
            LOG.warning('Spotwatts %s failed: %s',zone,e)
            errors.append(f'{zone}: {str(e)[:100]}')
    return count,errors


def run(client=download,output=OUTPUT):
    if output.exists():
        try:result=json.loads(output.read_text(encoding='utf-8'))
        except (ValueError, OSError):result={}
    else:result={}
    for key in ('quotes','history','sources','power_intervals'):result.setdefault(key,{})
    result['generated_at']=datetime.now(timezone.utc).isoformat(timespec='seconds')
    for name,func in [('eia',update_eia),('worldbank',update_worldbank),('power',update_power)]:
        try:count,errors=func(client,result)
        except Exception as exc:count,errors=0,[str(exc)[:180]]
        previous=result['sources'].get(name,{})
        result['sources'][name]={
            'status':'ok' if count and not errors else 'partial' if count else 'error',
            'count':count,
            'last_success':result['generated_at'] if count else previous.get('last_success'),
            'message':'Alla tillgängliga serier uppdaterades' if not errors else '; '.join(errors)[:440],
        }
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(result,ensure_ascii=False,indent=2,sort_keys=True)+'\n',encoding='utf-8')
    return result


if __name__=='__main__':
    logging.basicConfig(level=logging.INFO,format='%(levelname)s %(message)s')
    d=run()
    LOG.info('Saved %d commodity quotes to %s',len(d['quotes']),OUTPUT)
