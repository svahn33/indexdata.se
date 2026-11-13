# Svensk Makropuls 🇸🇪

En responsiv svensk makro-dashboard som samlar officiella räntor, valutakurser och inflation tillsammans med inbäddade marknadswidgets. **Inga API-nycklar, inga betalda ramverk, ingen databas.**

## Kom igång på 5 steg

1. Skapa ett **publikt** repository på [GitHub](https://github.com/new), exempelvis `svensk-makropuls`.
2. Ladda upp **alla filer och mappar** ur projektet till repositoryts rot. Glöm inte den dolda mappen `.github/workflows`, `assets`, `data`, `scripts` och filen `.nojekyll`. Det är enklast med Git: `git init`, `git add .`, `git commit -m "Start"`, `git branch -M main`, `git remote add origin <din-repo-url>`, `git push -u origin main`.
3. I GitHub → **Settings → Pages**, välj källan **GitHub Actions** (inte ”Deploy from a branch”). Din webbadress blir normalt `https://DITT-NAMN.github.io/svensk-makropuls/`.
4. I GitHub → **Settings → Actions → General** ge workflow **Read and write permissions** om de inte redan är aktiverade. Detta behövs för att uppdaterade data ska kunna sparas i repositoryt. En organisationspolicy kan förhindra detta.
5. Gå till **Actions → Uppdatera makrodata → Run workflow** och starta den första körningen. Därefter körs den automatiskt måndag–fredag kl. 17:30 UTC. GitHub Actions schemalagda jobb kan ibland försenas eller pausas om repositoryt är inaktivt under längre tid.

**Sedan krävs inget dagligt manuellt arbete.** Sidan läser JSON som workflow uppdaterar. Historik och datum syns alltid så att gamla noteringar inte misstas för nya.

## Visa sidan lokalt

Kör från projektmappen:

```bash
python -m http.server 8000
```

Öppna `http://localhost:8000`. (Att dubbelklicka på `index.html` kan blockera inläsning av `data/market.json` i vissa webbläsare.)

Om du har internetåtkomst kan du köra en manuell uppdatering:

```bash
python scripts/update_data.py
```

**Ingen installation av tredjepartsbibliotek behövs.** Första körningen kan ta ett par minuter: Riksbanken begränsar antalet anrop och skriptet pausar därför mellan anrop.

## Vad uppdateras automatiskt?

| Källa | Data | Metod | Hur ofta |
| --- | --- | --- | --- |
| **Sveriges riksbank** | Styrränta, svenska statsräntor 2/5/7/10 år, statsskuldväxel, svenska bostadsobligationsräntor, amerikanska/tyska/norska/brittiska/japanska räntor, USD/EUR/NOK/DKK/GBP/CHF mot SEK, KIX-index | Officiellt SWEA REST API | Hämtas vardagar, publiceringstakt varierar |
| **SCB** | Inflationstakt KPIF och KPI (12 månader) samt historik | PxWebApi v2, tabeller `TAB6590` och `TAB6596` | Kontrolleras varje vardag; nya värden publiceras månadsvis |
| **TradingView** | OMXS30, S&P 500, Nasdaq 100, DAX, VIX, Brent, WTI, guld, koppar, utvalda valutapar | Officiell inbäddad marknadswidget | Hanteras separat av TradingView; ofta fördröjda noteringar |

**Viktiga reservationer:** Värdena är senaste *publicerade noteringar* – inte nödvändigtvis realtid. Marknadswidgetens innehåll och tillgänglighet styrs av TradingView. Börsdata kan vara licensierade/fördröjda. Riksbankens växelkurser är indikativa och inte för transaktioner.

## Felhantering och underhåll

- En misslyckad hämtning **raderar inte** tidigare observationer; ursprungsdatumet behålls. `data/market.json` innehåller datakällans `status`, `last_success` och felinformation.
- Historiken sparas för de viktigaste serierna och kan utökas i `HISTORY_SERIES` i `scripts/update_data.py`.
- Jobbet respekterar Riksbankens anonyma hastighetsgräns, som normalt är fem API-anrop per minut. Vill du lägga till många serier är en API-nyckel ett alternativ.
- Använd GitHubs flik **Actions** om datumet i sidhuvudet inte uppdateras. Någon enstaka justering kan bli nödvändig om SCB eller Riksbanken ändrar sitt API.
- De öppna källorna kräver normalt ingen betalning. Hostingens och körningarnas framtida kostnader/kvoter styrs av din GitHub-plan.
- Sajten kräver ingen cookie-samtyckesbanner för sin egen kod (ingen analys eller lokal lagring implementerad). TradingView-widgeten kan ha egen databehandling och villkor; granska dessa om webbplatsen publiceras publikt.

## Tekniska detaljer

- Frontend: ren HTML/CSS/JavaScript, mobilanpassad och utan byggsteg.
- Backend/schemaläggning: Python 3 standardbibliotek + GitHub Actions + GitHub Pages.
- Data: `data/market.json` sparas direkt i Git och läses av webbläsaren vid sidladdning.
- Säkerhet: inga privata API-nycklar i webbplatsens källkod.
- JSON-stat2 och Riksbankens API-svar valideras före visning; en saknad indikator visas som `—` istället för ett påhittat värde.

### Officiella källor och dokumentation

- [Riksbankens SWEA API](https://www.riksbank.se/sv/statistik/rantor-och-valutakurser/hamta-rantor-och-valutakurser-via-api/)
- [Riksbankens serie-ID:n](https://www.riksbank.se/sv/statistik/rantor-och-valutakurser/hamta-rantor-och-valutakurser-via-api/serier-for-apiet/)
- [SCB:s PxWebApi v2](https://www.scb.se/vara-tjanster/oppna-data/pxwebapi/)
- [TradingViews widgetar](https://www.tradingview.com/widget/)

## Utveckling

För att testa normalisering utan internet:

```bash
python -m unittest discover -s tests -v
```

Projektet är en första funktionell version. Det inkluderar inte användarkonton, mejlnotiser, betalning eller direktsänd realtidsdata med betald licens.
