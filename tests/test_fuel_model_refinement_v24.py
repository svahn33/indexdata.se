"""Additional synthetic regression tests; not evidence about current Swedish prices."""
import importlib.util
import math
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('fuelmodel24',ROOT/'scripts/update_fuel_model.py')
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def synthetic(today=date(2026,11,16),beta_petrol=1.78,beta_diesel=.84):
    first=today-timedelta(days=320)
    days=[first+timedelta(days=i) for i in range(321)]
    oil=[{'date':d.isoformat(),'value':78+9*math.sin(i/14)+6*math.sin(i/36)}
         for i,d in enumerate(days) if d.weekday()<5]
    dollar=[{'date':d.isoformat(),'value':9.6+.18*math.sin(i/22)+.001*i}
            for i,d in enumerate(days) if d.weekday()<5]
    euro=[{'date':d.isoformat(),'value':11.0+.1*math.sin(i/19)}
          for i,d in enumerate(days) if d.weekday()<5]
    o,u,e=(mod.points(a,15,250) if j==0 else mod.points(a,4,20) for j,a in enumerate([oil,dollar,euro]))
    fuel=[]
    for d in days:
        if d.weekday():continue
        p=mod.market_base(o,u,d)
        fx=mod.latest_before(e,d)
        if not p or not fx:continue
        k=(d-first).days
        petrol=8.2+beta_petrol*p['value']+.06*math.sin(k/8)
        diesel=15.5+beta_diesel*p['value']+.06*math.sin(k/8)
        fuel.append({'date':d.isoformat(),'petrol':{'value_eur_per_l':petrol/fx[1]},
                     'diesel':{'value_eur_per_l':diesel/fx[1]}})
    return {'history':{'SEKUSDPMI':dollar,'SEKEURPMI':euro}}, {'history':{'brent':oil}}, {'history':fuel}

class ModelV24Tests(unittest.TestCase):
    def test_independent_sensitivity_and_backtests(self):
        market,com,fuel=synthetic()
        out=mod.build(market,com,fuel,datetime(2026,11,16,12,tzinfo=timezone.utc))
        gas=out
        diesel=out['diesel_model']
        self.assertEqual(gas['model_version'],2)
        self.assertEqual(diesel['status'],'ok')
        self.assertGreater(gas['crude_pass_through_multiplier'],diesel['crude_pass_through_multiplier'])
        self.assertGreaterEqual(gas['backtest_weeks'],4)
        self.assertIn(gas['model_selection'],('anchored','legacy'))
        self.assertIn(diesel['model_selection'],('anchored','legacy'))
        for row in (gas,diesel):
            self.assertGreater(row['estimate_sek_per_l'],7)
            self.assertGreater(row['indicative_upper_sek_per_l'],row['estimate_sek_per_l'])
            self.assertLess(row['estimate_sek_per_l'],45)

    def test_next_official_week_does_not_leak_into_current_estimate(self):
        m,c,f=synthetic()
        now=datetime(2026,11,16,12,tzinfo=timezone.utc)
        old=mod.build(m,c,f,now)['estimate_sek_per_l']
        f['history'].append({'date':'2026-11-23','petrol':{'value_eur_per_l':3.5},
                             'diesel':{'value_eur_per_l':3.7}})
        new=mod.build(m,c,f,now)['estimate_sek_per_l']
        self.assertEqual(old,new)

    def test_ten_official_weeks_still_works(self):
        m,c,f=synthetic()
        f['history']=f['history'][-10:]
        out=mod.build(m,c,f,datetime(2026,11,16,12,tzinfo=timezone.utc))
        self.assertEqual(out['status'] if 'status' in out else out['model_version'],2)
        self.assertGreaterEqual(out['backtest_weeks'],4)

    def test_model_reacts_to_latest_fx_without_new_oil(self):
        m,c,f=synthetic()
        now=datetime(2026,11,16,12,tzinfo=timezone.utc)
        baseline=mod.build(m,c,f,now)['estimate_sek_per_l']
        # The last USD fixing is Monday; oil price history remains unchanged.
        m['history']['SEKUSDPMI'][-1]['value']+=.25
        after=mod.build(m,c,f,now)['estimate_sek_per_l']
        self.assertGreater(after,baseline)

if __name__=='__main__':unittest.main()
