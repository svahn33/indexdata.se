import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from update_data import normalize_riksbank_latest, normalize_riksbank_history, json_stat_slice, choose_measure, normalize_date

class TestMakropuls(unittest.TestCase):
    def test_riksbank_group(self):
        data=[{'seriesId':'SEGVB10YC','date':'2026-11-13','value':2.42},{'seriesId':'OBSOLETE','date':'2009-01-01','value':12}]
        r=normalize_riksbank_latest(data,{'SEGVB10YC'})
        self.assertEqual(r['SEGVB10YC']['value'],2.42)
        self.assertEqual(len(r),1)
    def test_history_deduplication(self):
        p=normalize_riksbank_history([{'date':'2026-11-12','value':2.1},{'date':'2026-11-12','value':2.2},{'date':'2026-11-13','value':2.3}])
        self.assertEqual(p,[{'date':'2026-11-12','value':2.2},{'date':'2026-11-13','value':2.3}])
    def test_scb_json_stat(self):
        j={'id':['ContentsCode','Tid'],'size':[2,2], 'dimension':{
         'ContentsCode':{'category':{'index':{'index':0,'yoy':1},'label':{'index':'KPIF, index','yoy':'KPIF, 12-månadsförändring'}}},
         'Tid':{'category':{'index':{'2026M09':0,'2026M10':1},'label':{'2026M09':'Sep','2026M10':'Okt'}}}},
         'value':[110.2,110.3,2.1,2.4]}
        self.assertEqual(choose_measure(j,'KPIF'),'yoy')
        self.assertEqual(json_stat_slice(j,'yoy'),[{'date':'2026-09-01','value':2.1},{'date':'2026-10-01','value':2.4}])
    def test_scb_other_dimension_order(self):
        j={'id':['Tid','ContentsCode'],'size':[2,2], 'dimension':{
         'ContentsCode':{'category':{'index':{'idx':0,'yoy':1},'label':{'idx':'Index','yoy':'Årsförändring'}}},
         'Tid':{'category':{'index':{'2026M09':0,'2026M10':1},'label':{}}}},
         'value':[100,2.1,101,2.4]}
        self.assertEqual(json_stat_slice(j,'yoy'),[{'date':'2026-09-01','value':2.1},{'date':'2026-10-01','value':2.4}])
    def test_date(self):
        self.assertEqual(normalize_date('2026M10'),'2026-10-01')
        self.assertIsNone(normalize_date('bad'))

if __name__=='__main__':unittest.main()
