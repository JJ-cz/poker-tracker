# Poker Tracker

Statická webová appka nad výsledky domácího pokeru. Nahrazuje Looker Studio
dashboard. Žádný backend, žádná databáze – frontend čte jen JSON soubory, které
do repa generuje GitHub Actions ze dvou privátních Google Sheets.

Specifikace: [poker-tracker-SPEC.md](poker-tracker-SPEC.md) ·
původní návod na napojení: [poker-tracker-SETUP.md](poker-tracker-SETUP.md)

## Jak to funguje

```
Google Sheets (privátní)
   │  service account, jen pro čtení
   ▼
GitHub Actions (denně / na tlačítko)
   │  scripts/sync-sheets.mjs → data/*.json → commit
   ▼
GitHub Pages (main /root)
   │  fetch('data/*.json')
   ▼
appka v prohlížeči  ← heslový zámek (SHA-256 v js/auth.js)
```

Frontend se Google Sheets API **nikdy nedotýká** a žádný klíč v klientském kódu
není. Sešity zůstávají privátní.

## Co je potřeba dokončit ručně

### 1. GitHub Secrets

`Settings → Secrets and variables → Actions → New repository secret`:

| secret | hodnota |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_KEY` | celý obsah JSON klíče service accountu |
| `POKER_SHEET_ID` | ID sešitu s listy „Výsledky \[rok\]“ |
| `KREDIT_SHEET_ID` | ID sešitu „kredit“ |

ID sešitu je ta dlouhá část URL:
`https://docs.google.com/spreadsheets/d/`**`1AbC…xyz`**`/edit`

ID jsou schválně v secrets (ne v kódu) – repo je public a nemá smysl zveřejňovat
přímé odkazy na privátní sešity.

Oba sešity musí být nasdílené e-mailu service accountu jako **Prohlížitel** a
v Google Cloud projektu musí být zapnuté **Google Sheets API**.

### 2. Heslo

V [js/auth.js](js/auth.js) je `PASSWORD_SHA256 = 'CHANGE_ME'`. Vygeneruj si hash:

```bash
printf '%s' 'tvojeheslo' | shasum -a 256
```

Výsledný 64znakový hex vlož do proměnné (samotné heslo se tak do repa nedostane).

Dokud tam je `CHANGE_ME`, appka na localhostu pustí dovnitř bez hesla
(„lokální náhled“) a na ostrém hostingu naopak **nepustí nikoho** a napíše, že
heslo chybí – aby se omylem nenasadila odemčená.

⚠️ Je to zámek proti náhodným kolemjdoucím, ne bezpečnostní opatření. Soubory
`data/*.json` jsou na public hostingu čitelné pro kohokoli, kdo zná URL. Nic
citlivějšího než výsledky pokeru sem nedávej.

### 3. GitHub Pages

`Settings → Pages → Source: Deploy from a branch → main / (root)`.

Appka je vanilla HTML/CSS/JS bez buildu, takže se publikuje rovnou z rootu.
Chart.js je vendorovaný v `vendor/`, takže stránka nenačítá nic z CDN.

### 4. První běh workflow

`Actions → Sync dat z Google Sheets → Run workflow`. Workflow:

1. spustí testy parseru (`node --test tests/`),
2. přihlásí se ke Sheets API přes service account,
3. najde všechny listy `Výsledky <rok>` (dynamicky, nic není hardcoded),
4. vygeneruje `data/*.json` a commitne je zpět do `main`.

Dál běží sám každý den ve 04:15 UTC a taky po každé změně parseru.

V souhrnu běhu (`Summary`) je obsah `data/index.json` včetně případných
upozornění – tam se pozná, jestli parser něco nepochopil.

## Funkce appky

| sekce | co ukazuje |
|---|---|
| **Žebříček** | účasti, výhry, Ø umístění, prize, buy-in, rebuys, add-ons, body, profit, TOP efektivita; řaditelné kliknutím na hlavičku |
| **Vývoj v čase** | kumulativní profit / body po turnajích, přepínač metriky, tabulkový twin |
| **Umístění** | distribuce umístění absolutně i v % z odehraných turnajů hráče |
| **Hráči** | profil hráče (série, nejlepší/nejhorší turnaj, historie) + head-to-head |
| **Kredit** | aktuální zůstatky dopočítané z celé historie transakcí |

Sezóna se přepíná v horní liště, `Vše` je souhrn přes všechny roky. Filtr hráčů
platí pro všechny sekce naráz (kredit je na sezóně nezávislý).

**Jednotka = jeden turnaj, ne celý večer.** Za jednu noc se hraje víc turnajů
(běžně 2–5) a v sešitu je každý svým blokem řádků mezi prázdnými řádky. Sync je
drží oddělené – sloučit je podle data by nafouklo počet hráčů u stolu a rozbilo
body. „Účasti“ v žebříčku = počet odehraných turnajů.

**Bodovací systém** (jediný, staré sloupce `body`/`body 2`/`body 3` se ignorují):

```
body_za_turnaj = počet hráčů u stolu − pořadí hráče
```

**TOP efektivita** = `body / počet účastí × 100 %` (dle specifikace).

Seznam hráčů se odvozuje z dat – nová přezdívka se objeví všude sama. Barva
patří hráči (ne jeho pořadí), takže filtrování nepřebarví zbytek; hráči nad 8.
místem v abecedě dostanou stejný odstín s jiným vzorem čáry.

## Lokální vývoj

```bash
python3 scripts/serve.py
```

Pak [http://127.0.0.1:4173](http://127.0.0.1:4173). Přes `file://` to nepojede –
appka potřebuje `fetch()` a Web Crypto API.

Dokud neproběhl sync, je `data/` prázdné a appka to řekne. Pro práci na UI si
můžeš data doplnit ručně ve stejném formátu (viz [data/README.md](data/README.md)).

Testy parseru (potřebují Node 18+):

```bash
node --test tests/
```

## Struktura

```
index.html              shell appky
css/styles.css          styly + barevné tokeny (světlý i tmavý režim)
js/auth.js              heslový zámek (SHA-256)
js/data.js              načtení data/*.json + dopočet bodů
js/stats.js             výpočty (žebříček, kumulativy, distribuce, profily)
js/charts.js            grafy nad Chart.js
js/palette.js           barevné tokeny a přiřazení barvy hráči
js/format.js            formátování čísel a dat (cs-CZ)
js/app.js               propojení stavu a UI
scripts/parse-sheets.mjs  parser tabulek (čistá logika, bez Node API)
scripts/sync-sheets.mjs   Sheets API + zápis JSON (běží v Actions)
scripts/serve.py          lokální dev server
tests/                  testy parseru
data/                   generovaná data (nepsat ručně)
vendor/chart.umd.min.js Chart.js 4.4.7
```

## Kontrola kvality dat

Sync data nejen stahuje, ale i kontroluje. Co najde, vypíše do `data/index.json`
(pole `issues`) a do Summary běhu workflow:

- profit z tabulky ≠ dopočet `prize − buy-in − rebuys − add-ons`
- turnaj, kde pořadí není souvislé 1..n (v sešitu chybí řádek, nebo prázdný řádek
  rozsekl jeden turnaj na dva)
- turnaj, kde je stejný hráč dvakrát (nejspíš chybí oddělující prázdný řádek)
- zůstatek kreditu, který nesouhlasí s řádkem „Kredit“ v sešitu
- nehráčské (čistě číselné) sloupce v kreditu, které se vynechaly

Nic z toho sync nezastaví – data se vygenerují a upozornění jsou vodítko, kde
v sešitu něco doladit. Profit appka vždy počítá sama, hodnota z tabulky slouží
jen na tuhle kontrolu.

## Známé mezery

- List „staré“ (roky před 2021) se zpracuje jen při ručním běhu workflow
  se zapnutým `include_legacy` – struktura toho listu není ověřená.
- Typo-detekci jmen appka nemá (`Lůďa` vs `Luďa` = dva hráči), řeší se při
  zápisu do sešitu.
- Částky se zobrazují jako čísla bez jednotky.
