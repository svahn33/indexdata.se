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
from html.parser import HTMLParser
from html import unescape
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data' / 'fuel.json'
URL = 'https://www.euenergyprices.eu/api/data/fuel.csv'
LOGGER = logging.getLogger('fuel')
# Public business list prices, not the local retail price at the pump.
# Fetch at most twice per day, matching the current GitHub Actions schedule.
DAILY_SOURCES = (
    ('OKQ8', 'https://www.okq8.se/foretag/priser'),
    ('Circle K', 'https://www.circlek.se/foretag/drivmedel/priser'),
)


class VisibleText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.hidden = 0
        self.chunks = []

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style', 'svg', 'noscript'):
            self.hidden += 1

    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'svg', 'noscript'):
            self.hidden = max(0, self.hidden - 1)

    def handle_data(self, data):
        if not self.hidden and data.strip():
            self.chunks.append(data.strip())


def visible_text(content):
    parser = VisibleText()
    parser.feed(content.decode('utf-8-sig') if isinstance(content, bytes) else content)
    return re.sub(r'\s+', ' ', unescape(' '.join(parser.chunks)))


def extract_price(text, pattern):
    for match in re.finditer(pattern, text, flags=re.I):
        following = text[match.end():match.end()+210]
        num_match = re.search(r'(?<![0-9])([0-9]{1,2}[,.][0-9]{2})(?![0-9])', following)
        date_match = re.search(r'20[0-9]{2}-[0-9]{2}-[0-9]{2}', following)
        if not num_match or not date_match or date_match.start() < num_match.start():
            continue
        price = float(num_match.group(1).replace(',', '.'))
        when = date_match.group(0)
        try: date_value = date.fromisoformat(when)
        except ValueError: continue
        if 5 <= price <= 45 and date_value <= date.today():
            return {'value_sek_per_l': round(price, 2), 'date': when}
    return None


def parse_daily_prices(content, brand):
    text = visible_text(content)
    if brand == 'OKQ8':
        start = text.lower().find('drivmedel på station')
        end = text.lower().find('titta inte på prisskyltarna')
        if start >= 0:
            text = text[start:end if end > start else start + 4000]
        petrol = extract_price(text, r'OKQ8\s+GoEasy\s+95\b')
        diesel = extract_price(text, r'OKQ8\s+GoEasy\s+Diesel\b(?!\s+Extra)')
    elif brand == 'Circle K':
        start = text.lower().find('aktuella listpriser företagskund')
        end = text.lower().find('för drivmedel som betalas')
        if start >= 0:
            text = text[start:end if end > start else start + 4000]
        petrol = extract_price(text, r'miles\s+95\b')
        diesel = extract_price(text, r'miles\s+diesel\b(?!\s+plus)')
    else:
        raise ValueError('Unknown source')
    if petrol is None or diesel is None:
        raise ValueError(f'Missing business fuel prices on {brand}; no assumptions allowed')
    return {'petrol': petrol, 'diesel': diesel}


def update_daily(fetch_html=None, output=OUT, now=None):
    try:
        obj = json.loads(output.read_text(encoding='utf-8')) if output.exists() else {}
    except (ValueError, OSError):
        obj = {}
    for name, url in DAILY_SOURCES:
        try:
            if fetch_html is None:
                req = Request(url, headers={
                    'User-Agent': 'Mozilla/5.0 (compatible; IndexdataPriceCheck/1.0)',
                    'Accept': 'text/html',
                })
                with urlopen(req, timeout=25) as response:
                    html = response.read(2_000_001)
                    if len(html)>2_000_000:raise ValueError('Oversized supplier page')
            else:
                html=fetch_html(url)
            prices = parse_daily_prices(html, name)
            obj['daily_reference'] = {
                **prices,
                'checked_at': (now or datetime.now(timezone.utc)).isoformat(),
                'source': name,
                'source_url': url,
                'price_type': 'published_business_list_including_vat',
            }
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(json.dumps(obj, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
            return True
        except Exception as exc:
            LOGGER.warning('Daily prices from %s unavailable: %s', name, exc)
    # Keep older reference with its original checked_at (not considered fresh by UI).
    return False



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


def parse_csv(content):
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
            if kind not in found or when>found[kind]['date']:
                found[kind]={'value_eur_per_l':round(price,5),'date':when}
    if not all(x in found for x in ('petrol','diesel')):
        raise ValueError('No matched Sweden petrol + diesel weekly prices; CSV schema may have changed')
    return found


def update(fetch=None, output=OUT):
    old={}
    if output.exists():
        try: old=json.loads(output.read_text('utf-8'))
        except (ValueError, OSError): pass
    if fetch is None:
        def fetch():
            req=Request(URL,headers={'User-Agent':'Indexdata/1.0 public market dashboard','Accept':'text/csv'})
            with urlopen(req,timeout=30) as r:
                raw=r.read(4_000_001)
                if len(raw)>4_000_000:raise ValueError('Fuel file exceeds size limit')
                return raw
    try:
        parsed=parse_csv(fetch())
        result={
            'generated_at':datetime.now(timezone.utc).isoformat(),
            'source':'EU EnergyPrices / EU Commission Weekly Oil Bulletin',
            'source_url':'https://www.euenergyprices.eu/en/data',
            'license':'CC BY 4.0',
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
    daily_success=update_daily()
    print('EU weekly updated' if success else 'EU weekly unchanged')
    print('Daily business prices verified' if daily_success else 'Daily prices unavailable; dated fallback kept')
