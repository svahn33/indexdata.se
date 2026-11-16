"""Regression tests for v22 spot/FX updates and daily change indicators.
Fixtures are synthetic; no invented live prices are published.
"""
import importlib.util
import io
import json
import unittest
from datetime import datetime, date, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
def module(filename, name):
    spec=importlib.util.spec_from_file_location(name, ROOT/'scripts'/filename)
    out=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(out)
    return out

model=module('update_fuel_model.py','fuelmodel_v22')
market=module('update_data.py','market_v22')

class ECBTests(unittest.TestCase):
    def test_parse_ecb_and_derive_usd_sek(self):
        payload=b'''<?xml version="1.0"?><Envelope xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref"><Cube><Cube time="2026-11-13"><Cube currency="USD" rate="1.1052"/><Cube currency="SEK" rate="11.1075"/></Cube><Cube time="2026-11-16"><Cube currency="USD" rate="1.1014"/><Cube currency="SEK" rate="11.0950"/></Cube><Cube time="2026-11-17"><Cube currency="USD" rate="1.12"/><Cube currency="SEK" rate="11.0"/></Cube></Cube></Envelope>'''
        fx=market.parse_ecb_fx_xml(payload)
        self.assertEqual(fx['2026-11-16']['SEKEURPMI'],11.095)
        self.assertAlmostEqual(fx['2026-11-16']['SEKUSDPMI'],11.095/1.1014)
    def test_bad_ecb_xml_fails(self):
        with self.assertRaises(ValueError):
            market.parse_ecb_fx_xml(b'<root/>')
    def test_ecb_uses_newer_day_without_deleting_riksbank_history(self):
        payload=b'<Envelope><Cube><Cube time="2026-11-12"><Cube currency="USD" rate="1.1"/><Cube currency="SEK" rate="11.0"/></Cube><Cube time="2026-11-13"><Cube currency="USD" rate="1.1"/><Cube currency="SEK" rate="11.1"/></Cube><Cube time="2026-11-16"><Cube currency="USD" rate="1.1"/><Cube currency="SEK" rate="11.2"/></Cube></Cube></Envelope>'
        class MockResponse:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,*args):return payload
        result={'indicators':{'SEKUSDPMI':{'date':'2026-11-13','value':10.05,'source':'Sveriges riksbank'},'SEKEURPMI':{'date':'2026-11-13','value':11.1,'source':'Sveriges riksbank'}},
                'history':{'SEKUSDPMI':[{'date':'2026-10-10','value':10.01},{'date':'2026-11-13','value':10.05}],
                           'SEKEURPMI':[{'date':'2026-10-10','value':11.01},{'date':'2026-11-13','value':11.1}]}}
        with patch.object(market,'urlopen',return_value=MockResponse()):
            count,_=market.update_ecb_fx(None,result)
        self.assertEqual(count,2)
        self.assertEqual(result['indicators']['SEKUSDPMI']['date'],'2026-11-16')
        self.assertEqual(result['history']['SEKUSDPMI'][0]['date'],'2026-10-10')
        self.assertEqual(next(r for r in result['history']['SEKUSDPMI'] if r['date']=='2026-11-13')['value'],10.05)


def synthetic_market(today=date(2026,11,13)):
    import math
    first=today-timedelta(days=220)
    days=[first+timedelta(days=i) for i in range(221)]
    usd=[{'date':d.isoformat(),'value':9.0+0.001*i} for i,d in enumerate(days) if d.weekday()<5]
    eur=[{'date':d.isoformat(),'value':10.5+0.001*i} for i,d in enumerate(days) if d.weekday()<5]
    brent=[{'date':d.isoformat(),'value':70.0+0.05*i} for i,d in enumerate(days) if d.weekday()<5]
    prices=[]
    brent_points=model.points(brent,15,250)
    usd_points=model.points(usd,4,20)
    eur_points=model.points(eur,4,20)
    for d in days:
        if d.weekday()!=0:continue
        crude=model.daily_crude_proxy(brent_points,usd_points,d)
        eur_fx=model.latest_before(eur_points,d)
        if crude and eur_fx:
            p=10+crude['proxy']+.10*math.sin(d.toordinal())
            prices.append({'date':d.isoformat(),'petrol':{'value_eur_per_l':p/eur_fx[1]},
                           'diesel':{'value_eur_per_l':(p+3)/eur_fx[1]}})
    return ({'history':{'SEKUSDPMI':usd,'SEKEURPMI':eur},'indicators':{'SEKUSDPMI':{'source':'Sveriges riksbank'}}},
            {'history':{'brent':brent}}, {'history':prices})

class ModelRefreshTests(unittest.TestCase):
    def test_new_monday_fx_moves_estimate_even_when_last_oil_from_friday(self):
        m,c,f=synthetic_market()
        now=datetime(2026,11,16,17,tzinfo=timezone.utc)
        baseline=model.build(m,c,f,now)
        m2=json.loads(json.dumps(m))
        m2['history']['SEKUSDPMI'].append({'date':'2026-11-16','value':12})
        with_fx=model.build(m2,c,f,now)
        self.assertGreater(with_fx['estimate_sek_per_l'],baseline['estimate_sek_per_l'])
        self.assertGreater(with_fx['diesel_model']['estimate_sek_per_l'],baseline['diesel_model']['estimate_sek_per_l'])
        self.assertEqual(with_fx['usdsek_latest_date'],'2026-11-16')
        self.assertEqual(with_fx['brent_latest_date'],'2026-11-13')
        self.assertGreater(with_fx['change_percent'],0)
        self.assertEqual(with_fx['change_reference_date'],'2026-11-13')
        self.assertEqual(with_fx['diesel_model']['market_observation_date'],'2026-11-16')
    def test_new_oil_spot_moves_model(self):
        m,c,f=synthetic_market()
        now=datetime(2026,11,16,17,tzinfo=timezone.utc)
        baseline=model.build(m,c,f,now)
        c2=json.loads(json.dumps(c))
        c2['history']['brent'].append({'date':'2026-11-16','value':120})
        higher=model.build(m,c2,f,now)
        self.assertGreater(higher['estimate_sek_per_l'],baseline['estimate_sek_per_l'])
        self.assertEqual(higher['brent_latest_date'],'2026-11-16')
    def test_stale_source_fails_closed(self):
        m,c,f=synthetic_market()
        with self.assertRaisesRegex(ValueError,'too old'):
            model.build(m,c,f,datetime(2026,12,1,tzinfo=timezone.utc))

if __name__=='__main__':unittest.main()
