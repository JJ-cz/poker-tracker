# data/

Tady žijí **generovaná** data. Ručně sem nic nepiš – workflow
`.github/workflows/sync-data.yml` obsah přepisuje.

| soubor | co v něm je |
|---|---|
| `index.json` | seznam sezón, čas generování a `issues` – úplný seznam nálezů kontroly dat (`sheet`, `kind`, `summary`, `count`, `details`) |
| `vysledky-<rok>.json` | turnaje daného roku (`date` + `seq` = číslo turnaje v rámci dne), každý se seznamem hráčů (finish, prize, buy-in, rebuys, add-ons, profit) |
| `vysledky-stare.json` | volitelně list „staré“ (jen když sync běží s `INCLUDE_LEGACY=true`) |
| `kredit.json` | dopočítané zůstatky kreditu + CUT celkem |

Body se tady **neukládají** – appka si je počítá sama podle jednotného systému
(`počet hráčů u stolu − pořadí hráče`, za každý turnaj zvlášť), aby existovalo
jediné místo pravdy.

Dokud sync neproběhl, je složka prázdná a appka zobrazí vysvětlující chybu.
