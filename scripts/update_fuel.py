"""Fetch Sweden's weekly petrol/diesel averages from the EU Oil Bulletin
re-published as CC BY 4.0 CSV by EU EnergyPrices.

Output stays in EUR/litre; the front end explicitly applies the latest
Riksbank EUR/SEK indication to give an *approximate* kr/litre value.
If upstream fails, preserve previous dated observations (never fabricate data).
"""
from __future__ import annotations

import csv
import io
import json
import logging
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data' / 'fuel.json'
URL = 'https://www.euenergyprices.eu/api/data/fuel.csv'
LOGGER = logging.getLogger('fuel')


def normalize(text):
    return re.sub(r'[^a-z0-9]', '', str(text or '').lower())


def is_se(row):
    return any(normalize(row.get(k)) in {'se', 'swe', 'sweden', 'sverige'}
               for k in row if any(word in normalize(k) for word in ('country', 'geo', 'iso', 'code')))


def series_name(label):
    n = normalize(label)
    if any(x in n for x in ('diesel', 'gasoil')):
        return 'diesel'
    if any(x in n for x in ('petrol', 'gasoline', 'eurosuper', 'euro95', '95octane')):
        return 'petrol'
    return None


def find_number(value):
    try:
        num=float(str(value).strip().replace(',', '.'))
    except (ValueError, TypeError):
        return None
    return num if 0.25 <= num <= 5.0 else None


def find_date(row):
    for key, val in row.items():
        if any(x in normalize(key) for x in ('date','week','period','time')):
            if re.fullmatch(r'\d{4}-\d{2}-\d{2}',str(val).strip()):
                return str(val).strip()
    return None


def parse_csv_history(content):
    reader=csv.DictReader(io.StringIO(content.decode('utf-8-sig')))
    if not reader.fieldnames: raise ValueError('Empty fuel CSV')
    found={}
    for row in reader:
        if not is_se(row): continue
        when=find_date(row)
        if not when: continue
        # Support either long format (one fuel per row) or wide format
        # (petrol and diesel in two price columns). Never infer units.
        label=' '.join(str(val) for key,val in row.items()
                       if any(x in normalize(key) for x in ('fuel','product','type')))
        label_kind=series_name(label)
        proposals=[]
        if label_kind:
            candidates=[(key,val) for key,val in row.items()
                        if ('price' in normalize(key) or 'value'==normalize(key))
                        and not any(x in normalize(key) for x in ('previous','change','delta','percent'))]
            for key,val in candidates:
                n=normalize(key)
                if 'sek' in n or ('tax' in n and 'incl' not in n):continue
                price=find_number(val)
                if price is not None:
                    proposals.append((label_kind,price))
                    break
        else:
            for key,val in row.items():
                kind=series_name(key)
                if kind and not any(x in normalize(key) for x in ('previous','change','delta','percent')):
                    price=find_number(val)
                    if price is not None:proposals.append((kind,price))
        for kind,price in proposals:
            key=(when,kind)
            found[key]={'value_eur_per_l':round(price,5),'date':when}
    rows={}
    for (when,kind),entry in found.items():
        rows.setdefault(when,{'date':when})[kind]={'value_eur_per_l':entry['value_eur_per_l']}
    complete=[r for r in rows.values() if 'petrol' in r and 'diesel' in r]
    if not complete:
        raise ValueError('No matched Sweden petrol + diesel weekly prices; CSV schema may have changed')
    return sorted(complete,key=lambda r:r['date'])[-80:]

def parse_csv(content):
    latest=parse_csv_history(content)[-1]
    return {kind:{'date':latest['date'],**latest[kind]} for kind in ('petrol','diesel')}


def update(fetch=None, output=OUT):
    old={}
    if output.exists():
        try: old=json.loads(output.read_text('utf-8'))
        except (ValueError, OSError): pass
    old.pop('daily_reference', None)  # Legacy business prices are no longer used.
    if fetch is None:
        def fetch():
            req=Request(URL,headers={'User-Agent':'Indexdata/1.0 public market dashboard','Accept':'text/csv'})
            with urlopen(req,timeout=30) as r:
                raw=r.read(12_000_001)
                if len(raw)>12_000_000:raise ValueError('Fuel file exceeds size limit')
                return raw
    try:
        raw=fetch()
        parsed=parse_csv(raw)
        history=parse_csv_history(raw)
        result={
            **old,
            'generated_at':datetime.now(timezone.utc).isoformat(),
            'source':'EU EnergyPrices / EU Commission Weekly Oil Bulletin',
            'source_url':'https://www.euenergyprices.eu/en/data',
            'license':'CC BY 4.0',
            'history':history,
            **parsed,
        }
        output.parent.mkdir(parents=True,exist_ok=True)
        output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        return True
    except Exception as exc:
        LOGGER.warning('Fuel update failed; retaining dated previous data: %s',exc)
        if not output.exists():
            output.parent.mkdir(parents=True,exist_ok=True)
            output.write_text(json.dumps(old,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        return False


if __name__=='__main__':
    logging.basicConfig(level=logging.INFO)
    # Do not fail entire site publishing when one auxiliary source is down.
    success=update()
    print('Fuel updated' if success else 'Fuel not updated; prior values retained')
