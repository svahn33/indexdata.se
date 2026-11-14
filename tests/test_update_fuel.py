"""Offline contract tests for source CSV parsing and safe fallbacks."""
import importlib.util
import tempfile
import unittest
from pathlib import Path

SCRIPT=Path(__file__).resolve().parents[1] / 'scripts' / 'update_fuel.py'
spec=importlib.util.spec_from_file_location('update_fuel',SCRIPT)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class FuelTests(unittest.TestCase):
    def test_long_format(self):
        csv=(b'country_code,date,fuel_type,price_eur_per_liter\n'
             b'SE,2026-11-02,Petrol 95,1.432\nSE,2026-11-02,Diesel,1.713\n'
             b'SE,2026-11-09,Petrol 95,1.441\nSE,2026-11-09,Diesel,1.728\n'
             b'DE,2026-11-09,Petrol 95,9.999\n')
        out=module.parse_csv(csv)
        self.assertEqual(out['petrol']['value_eur_per_l'],1.441)
        self.assertEqual(out['diesel']['date'],'2026-11-09')

    def test_history_preserves_weekly_records(self):
        raw=(b'country_code,date,fuel_type,price_eur_per_liter\n'
             b'SE,2026-10-26,Petrol 95,1.412\nSE,2026-10-26,Diesel,1.700\n'
             b'SE,2026-11-02,Petrol 95,1.432\nSE,2026-11-02,Diesel,1.713\n'
             b'SE,2026-11-09,Petrol 95,1.441\nSE,2026-11-09,Diesel,1.728\n')
        history=module.parse_csv_history(raw)
        self.assertEqual(len(history),3)
        self.assertEqual(history[0]['date'],'2026-10-26')
        self.assertEqual(history[-1]['petrol']['value_eur_per_l'],1.441)

    def test_wide_format(self):
        csv=(b'country,week,petrol_eur_per_litre,diesel_eur_per_litre\n'
             b'Sweden,2026-11-09,1.477,1.799\n')
        out=module.parse_csv(csv)
        self.assertEqual(out['petrol']['value_eur_per_l'],1.477)
        self.assertEqual(out['diesel']['value_eur_per_l'],1.799)

    def test_reject_unknown_schema(self):
        with self.assertRaises(ValueError):
            module.parse_csv(b'country,week,something\nSweden,2026-11-09,1.1\n')

    def test_keep_existing_on_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'fuel.json';path.write_text('{"petrol":{"date":"2026-11-09"}}')
            self.assertFalse(module.update(lambda: b'bogus',path))
            self.assertIn('2026-11-09',path.read_text())

if __name__=='__main__': unittest.main()
