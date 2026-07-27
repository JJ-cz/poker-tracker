# data/

Tady žijí **generovaná** data. Ručně sem nic nepiš – workflow
`.github/workflows/sync-data.yml` obsah přepisuje.

| soubor | co v něm je |
|---|---|
| `index.json` | seznam sezón, čas generování, případná upozornění ze syncu |
| `vysledky-<rok>.json` | večery daného roku, každý se seznamem hráčů (finish, prize, buy-in, rebuys, add-ons, profit) |
| `vysledky-stare.json` | volitelně list „staré“ (jen když sync běží s `INCLUDE_LEGACY=true`) |
| `kredit.json` | dopočítané zůstatky kreditu + CUT celkem |

Body se tady **neukládají** – appka si je počítá sama podle jednotného systému
(`počet hráčů ten večer − pořadí hráče`), aby existovalo jediné místo pravdy.

Dokud sync neproběhl, je složka prázdná a appka zobrazí vysvětlující chybu.
