# Poker Tracker - Návod na nastavení napojení dat a GitHubu

Tohle je potřeba udělat ručně jednou na začátku, než na projekt pustíš Claude Code. Claude Code pak napíše skript/workflow, který tohle nastavení využije.

## Část 1 - Google Cloud service account

1. Jdi na **console.cloud.google.com** a přihlas se svým Google účtem (stejným, pod kterým máš tabulky).
2. Vytvoř nový projekt (nahoře v liště "Select a project" → "New Project"), pojmenuj ho třeba `poker-tracker`.
3. V levém menu jdi na **APIs & Services → Library**, vyhledej **Google Sheets API** a klikni **Enable**.
4. Jdi na **APIs & Services → Credentials** (nebo **IAM & Admin → Service Accounts**).
5. Klikni **Create Service Account**. Pojmenuj ho třeba `poker-tracker-reader`. Roli nemusíš přiřazovat (appka potřebuje jen přístup, který dostane přes sdílení sheetu, ne přes Google Cloud roli).
6. Až je service account vytvořený, otevři ho a jdi na záložku **Keys** → **Add Key** → **Create new key** → typ **JSON**. Stáhne se ti soubor s klíčem - **ulož si ho, ale nikdy ho nikam nenahrávej veřejně** (ani do GitHub repa napřímo).
7. Zkopíruj si email service accountu - vypadá nějak takhle: `poker-tracker-reader@poker-tracker-123456.iam.gserviceaccount.com`

## Část 2 - Nasdílení tabulek

1. Otevři sešit **poker** (hlavní výsledky) → **Sdílet** (Share) → vlož email service accountu z kroku 7 výše → nastav práva na **Prohlížitel (Viewer)** → Odeslat.
2. Udělej totéž se sešitem **kredit**.
3. Tím zůstávají oba sešity privátní pro všechny ostatní - jen tenhle "robotí" účet k nim má přístup, a jen ke čtení.

## Část 3 - GitHub repozitář

1. Na **github.com** vytvoř nový repozitář, např. `poker-tracker`.
   - Může být private i public - GitHub Pages z free účtu potřebuje public repo. Vzhledem k tomu, že appka bude mít vlastní heslo (viz Část 4) a repo/appka nejsou nijak propagované, je to pro tento účel v pořádku.
2. V repozitáři jdi na **Settings → Secrets and variables → Actions → New repository secret**.
   - Název: např. `GOOGLE_SERVICE_ACCOUNT_KEY`
   - Hodnota: celý obsah staženého JSON klíče (otevři soubor v textovém editoru, zkopíruj vše, vlož sem)
3. Jdi na **Settings → Pages** → jako Source vyber branch, ze které se má appka publikovat (Claude Code ti řekne, jestli `main`, `gh-pages`, nebo `main /docs`, podle toho, jak appku postaví).

## Část 4 - Co bude dělat GitHub Actions (Claude Code toto naimplementuje)

Claude Code vytvoří soubor `.github/workflows/sync-data.yml`, který:
- se spustí buď automaticky podle času (např. jednou denně), nebo manuálně tlačítkem na GitHubu ("Run workflow")
- přihlásí se ke Google Sheets API pomocí `GOOGLE_SERVICE_ACCOUNT_KEY` ze secrets
- stáhne data z listů `Výsledky [rok]` a z kredit sešitu
- vygeneruje/aktualizuje JSON soubory ve složce `data/`
- commitne a pushne tyto změny zpět do repozitáře

Appka na frontendu pak čte jen tyhle JSON soubory - nikdy se nedotýká Google Sheets API napřímo.

## Shrnutí, co si připravit před Claude Code

- [ ] Stažený JSON klíč service accountu
- [ ] Email service accountu nasdílený k oběma sešitům jako Viewer
- [ ] Založený GitHub repozitář `poker-tracker`
- [ ] JSON klíč vložený jako GitHub Secret

Až tohle budeš mít, dej Claude Code obě specifikace (`poker-tracker-SPEC.md` a tenhle návod) a může začít stavět.
