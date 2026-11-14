"""Model tests with synthetic input only: no invented live prices."""
import importlib.util
import json
import math
import tempfile
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('fuel_model',ROOT/'scripts'/'update_fuel_model.py')
model=importlib.util.module_from_spec(spec)
spec.loader.exec_module(model)


def fixture(today=date(2026,11,13)):
    first=today-timedelta(days=220)
    dates=[first+timedelta(days=i) for i in range(221)]
    usd=[{'date':d.isoformat(),'value':9.0+0.001*i} for i,d in enumerate(dates) if d.weekday()<5]
    eur=[{'date':d.isoformat(),'value':10.5+0.001*i} for i,d in enumerate(dates) if d.weekday()<5]
    brent=[{'date':d.isoformat(),'value':70.0+0.05*i} for i,d in enumerate(dates) if d.weekday()<5]
    fuel=[]
    # Weekly reports, on a Monday; derive price from oil proxy + 10 kr baseline.
    for d in dates:
        if d.weekday()!=0:continue
        p=model.daily_crude_proxy(model.points(brent,15,250),model.points(usd,4,20),d)
        fx=model.latest_before(model.points(eur,4,20),d)
        if p and fx:
            actual=10.0+p['proxy']+0.10*math.sin(d.toordinal())
            fuel.append({'date':d.isoformat(),'petrol':{'value_eur_per_l':actual/fx[1]},'diesel':{'value_eur_per_l':1.6}})
    return ({'history':{'SEKUSDPMI':usd,'SEKEURPMI':eur}},
            {'history':{'brent':brent}}, {'history':fuel})


class FuelModelTests(unittest.TestCase):
    def test_model_output_with_history(self):
        m,c,f=fixture()
        out=model.build(m,c,f,datetime(2026,11,14,tzinfo=timezone.utc))
        self.assertEqual(out['kind'],'scenario_model_not_observed_pump_price')
        self.assertGreater(out['estimate_sek_per_l'],15)
        self.assertLess(out['estimate_sek_per_l'],20)
        self.assertGreaterEqual(out['calibration_weeks'],10)
        self.assertGreaterEqual(out['backtest_weeks'],4)
        self.assertLess(out['rolling_backtest_mae_sek_per_l'],1)
        self.assertTrue(len(out['recent_history'])>=15)
        self.assertGreater(out['indicative_upper_sek_per_l'],out['estimate_sek_per_l'])

    def test_rising_oil_raises_estimate(self):
        m,c,f=fixture()
        now=datetime(2026,11,14,tzinfo=timezone.utc)
        base=model.build(m,c,f,now)
        # Modify only recent 5 Brent observations; the local calibration remains unchanged.
        modified=json.loads(json.dumps(c))
        for pt in modified['history']['brent'][-5:]:pt['value']+=10
        higher=model.build(m,modified,f,now)
        self.assertGreater(higher['estimate_sek_per_l'],base['estimate_sek_per_l'])

    def test_insufficient_or_stale_data_fail_closed(self):
        m,c,f=fixture()
        f['history']=f['history'][-3:]
        with self.assertRaises(ValueError):model.build(m,c,f,datetime(2026,11,14,tzinfo=timezone.utc))
        m,c,f=fixture()
        with self.assertRaises(ValueError):model.build(m,c,f,datetime(2027,1,1,tzinfo=timezone.utc))

    def test_missing_files_write_no_price(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp=Path(tmp)
            dst=tmp/'model.json'
            result=model.run(tmp/'missing_market',tmp/'missing_commodity',tmp/'missing_fuel',dst,
                             now=datetime(2026,11,14,tzinfo=timezone.utc))
            self.assertEqual(result['status'],'unavailable')
            self.assertNotIn('estimate_sek_per_l',json.loads(dst.read_text()))

if __name__=='__main__':unittest.main()
