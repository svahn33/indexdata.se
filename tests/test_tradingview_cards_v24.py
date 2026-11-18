"""Offline checks: same instrument IDs in new quote cards and legacy ticker."""
import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).parents[1]
HTML = (ROOT / 'index.html').read_text()
JS = (ROOT / 'assets/home.js').read_text()
CSS = (ROOT / 'assets/styles.css').read_text()


class QuotesShareSourceTests(unittest.TestCase):
    def test_one_widget_per_requested_symbol(self):
        for symbol in ('OMXSTO:OMXS30', 'FX_IDC:USDSEK', 'FX_IDC:EURSEK'):
            self.assertEqual(HTML.count(f'<tv-single-ticker symbol="{symbol}"'), 1)
            self.assertIn(f"proName:'{symbol}'", JS)

    def test_no_static_overwrite_of_live_quotes(self):
        for name in ('homeUSD', 'homeEUR', 'homeOmxChange'):
            self.assertNotIn(f"set('{name}'", JS)
            self.assertNotIn(f"$('{name}'", JS)
        self.assertNotIn('omxLastVerified', JS)
        self.assertNotIn('fxDailyChange', JS)

    def test_status_and_essentials_untouched(self):
        self.assertIn('homeOmxStatusLine', HTML)
        self.assertIn('homePetrol', HTML)
        self.assertIn('homeDiesel', HTML)
        self.assertIn('homePowerSE3', HTML)
        self.assertIn('paintFuel()', JS)
        self.assertIn('paintPower()', JS)
        self.assertIn('homeCompactTicker', JS)

    def test_tradingview_widget_module_and_semantics(self):
        self.assertIn('https://www.tradingview-widget.com/w/en/tv-single-ticker.js', HTML)
        self.assertIn('tv-single-ticker{', CSS)
        self.assertIn('TradingView · marknadskurser', HTML)
        self.assertIn('Officiella dagsdata uppdaterade', HTML)


if __name__ == '__main__':
    unittest.main()
