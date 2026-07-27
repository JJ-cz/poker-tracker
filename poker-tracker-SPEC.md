# Poker Tracker - Specifikace projektu

## Cíl
Statická webová aplikace, která nahradí Looker Studio dashboard. Data čte přímo z Google Sheets (žádný backend, žádná databáze), appka je jen prezentační vrstva nad existujícími tabulkami. Nasazení na GitHub Pages (nebo jiný statický hosting). Jednoduchá heslová ochrana vstupu.

## Datové zdroje

### 1. Sešit "poker" (hlavní výsledky)
- Relevantní listy: `Výsledky 2021`, `Výsledky 2022`, `Výsledky 2023`, `Výsledky 2024`, `Výsledky 2025`, `Výsledky 2026` (roky 2021+ jsou priorita, starší roky/list "staré" jako bonus pokud čas dovolí)
- Listy `Přehledy [rok]` appka NEPOUŽÍVÁ - byly to jen pomocné vizualizace nad Výsledky, appka si postaví vlastní.
- Sloupce v `Výsledky [rok]` (jeden řádek = jeden hráč v jednom večeru):
  - `jméno` - hráč (text, může se objevit nová přezdívka kdykoli, appka musí seznam hráčů odvozovat dynamicky z dat, ne hardcodovat)
  - `datum` - datum večera (formát v tabulce: D.M.RRRR)
  - `finish` - pořadí, kterým hráč ten večer skončil (1 = vítěz)
  - `prize` - výhra z rozdělovaného pot
  - `buy-in` - vstupní poplatek
  - `rebuys` - kolik hráč dokoupil žetonů (částka, ne počet)
  - `add-ons` - add-on částka
  - `profit` - čistý zisk/ztráta (= prize - buy-in - rebuys - add-ons), appka si to může dopočítat sama pro jistotu
  - `body`, `body 2`, `body 3` - staré bodovací systémy, appka je IGNORUJE a počítá si vlastní (viz níže)
- Prázdné řádky oddělují jednotlivé večery (jeden blok řádků = jeden turnaj daný den)

### 2. Sešit "kredit"
- Jeden list, sloupce: `Datum`, jednotliví hráči (jméno = název sloupce), `CUT`, `SUM`
- Řádek 2 (popisek "Kredit") = aktuální celkový zůstatek každého hráče - appka si tuto hodnotu DOPOČÍTÁ sama (suma příslušného sloupce), nespoléhá na hodnotu v tabulce
- Datové řádky dvou typů:
  - **Tučné řádky s datem** = výsledek jednoho pokerového večera přepočítaný na změnu kreditu. Hodnota u hráče = jeho profit tu noc. Sloupec `CUT` = společné náklady (jídlo/pití/chipy) stržené ze společného "banku" - NEPŘIČÍTAJÍ SE ani NEODEČÍTAJÍ se žádnému konkrétnímu hráči, jsou jen pro audit/zobrazení. Součet všech hráčských hodnot v řádku + CUT = 0.
  - **Netučné řádky** = manuální dobití kreditu. Používá se, když se hráč dostal do minusu a doplatil cash do klubu. Jedna hodnota u jednoho hráče, žádný CUT.
- `SUM` sloupec = kontrolní součet celého řádku (mělo by být 0 kromě prvního/opening řádku)
- **Výpočet aktuálního zůstatku hráče** = kumulativní součet všech hodnot v jeho sloupci (bez ohledu na typ řádku), CUT se do toho nepočítá (nemá vlastní hráčský sloupec). Ověřeno křížově s buňkou "celkem na účtu" v tabulce - sedí přesně.
- Některé řádky mají navíc textovou poznámku (např. "výběr" pro hotovostní výběr, nebo příležitostné sázkové kolo mimo poker jako "Hokej"/"volby"). Appka tyto řádky NEMUSÍ kategorizovat ani zobrazovat samostatně - jen se započítají do celkového zůstatku jako každá jiná transakce.

## Bodovací systém (nový, jednotný)
```
body_za_vecer = (počet hráčů ten večer) - (finish pořadí hráče)
```
Např. 7 hráčů: vítěz získá 6 bodů, poslední 0 bodů. Sezónní žebříček = suma bodů za všechny večery v daném roce.

## Napojení na data
Sheety zůstávají privátní (NEPUBLIKUJÍ se na web) - appka je nikdy nečte přímo.

- Založí se Google Cloud service account (robotí účet), se kterým se oba sešity nasdílí jen jako "Prohlížitel" (Viewer) - žádný veřejný přístup
- GitHub Actions workflow (spouští se na schedule, např. denně, nebo manuálně po zápisu nových výsledků) se přihlásí přes service account credentials (uložené jako GitHub Secret) a stáhne data přes Google Sheets API v4
- Workflow vygeneruje statické JSON soubory (např. `data/vysledky-2021.json`, `data/kredit.json`) a zkomituje je do repozitáře
- Appka na frontendu čte jen tyto JSON soubory přes `fetch()` - nikdy se nedotýká Google Sheets API přímo, žádný klíč není nikde v klientském kódu
- Appka musí být tolerantní k drobným odchylkám v datech mezi roky (např. chybějící sloupec, jiné pořadí sloupců - parsovat podle názvu hlavičky, ne podle pozice)

### Setup kroky před vývojem (na JJ)
1. Vytvořit Google Cloud projekt + service account, zapnout Google Sheets API
2. Vygenerovat JSON klíč service accountu
3. Nasdílet oba sešity (poker + kredit) emailu service accountu jako "Prohlížitel"
4. Uložit JSON klíč jako GitHub Secret v repozitáři projektu

## Funkce aplikace

1. **Season leaderboard** (výběr roku) - tabulka hráčů: počet účastí, celkový prize, buy-in, rebuys, add-ons, body (nový systém), profit, "top" efektivita (vzorec: `body / počet_účastí * 100%` - průměrný počet bodů na odehraný večer v procentech, ověřeno na historických datech, sedí přesně)
2. **Graf vývoje v čase** - kumulativní profit a kumulativní body po jednotlivých večerech, per hráč, s možností vybrat/schovat hráče v grafu
3. **Distribuce umístění** - bar chart i tabulka: kolikrát který hráč skončil na 1., 2., 3. atd. místě (absolutní počty)
4. **Relativní úspěšnost umístění** - stejné jako výše, ale v procentech vůči odehraným hrám daného hráče (fér srovnání hráčů s různým počtem účastí)
5. **Player profil** - detail jednoho hráče: celková historie, nejlepší/nejhorší večer, streaky, případně head-to-head srovnání dvou hráčů
6. **Kredit dashboard** - aktuální zůstatek všech hráčů (bar chart). Jednotlivé transakce se na webu nezobrazují, appka jen sečte historii do aktuálního zůstatku.
7. **Přepínání roku/sezóny** v navigaci (podobně jako záložky v Looker Studiu)
8. Dynamický seznam hráčů odvozený z dat - žádný hardcoded seznam, nová přezdívka se objeví automaticky všude

## Projekt / umístění
- Název projektu: `poker-tracker`
- Umístění: lokálně na ploše (Desktop), NENÍ součástí OneDrive struktury s ostatními projekty (ap-design, client-map, sales-knowledge)

## Bezpečnost
- Jednoduchá JS heslová ochrana před zobrazením obsahu - kdokoli má odkaz a heslo, dostane se dovnitř. Vědomě NE bezpečnostní opatření v pravém slova smyslu (chrání jen zobrazení v appce, ne přímý přístup k datovým souborům, kdyby si je někdo dokázal dohledat), jen zámek proti náhodným kolemjdoucím a vyhledávačům.
- Heslo se do kódu doplní později ručně (placeholder proměnná v JS, např. `const PASSWORD = "CHANGE_ME"`)

## Tech stack
- Vanilla HTML/CSS/JS, žádný build proces (nebo lehký framework, pokud to zjednoduší vývoj)
- Chart.js pro grafy
- Hosting: GitHub Pages
- GitHub Actions + Google service account pro pravidelný/manuální sync dat ze Sheets do JSON (viz sekce "Napojení na data")

## Otevřené body k doladění při vývoji
- Provedení setup kroků service accountu (viz sekce "Napojení na data")
- Ošetření překlepů/variant jmen (např. "Lůďa" vs "Luďa") - zatím řešeno manuálně při zápisu, appka nemá typo-detekci (lze doplnit později)
- Přesný formát CSV po publikování (ověřit až budou listy publikované)
