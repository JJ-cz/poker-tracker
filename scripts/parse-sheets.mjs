/**
 * Čistý parser dat z Google Sheets → normalizovaná struktura.
 *
 * Vědomě bez jakékoli Node závislosti (žádné node:*, žádné fetch, žádné env),
 * aby se logika dala spustit a otestovat i v prohlížeči. Síťovou část a zápis
 * souborů řeší scripts/sync-sheets.mjs, který si odsud jen importuje funkce.
 */

// ---------------------------------------------------------------------------
// pomocné funkce
// ---------------------------------------------------------------------------

export const log = (...args) => console.log('[sync]', ...args);
export const warn = (...args) => console.warn('[sync] ⚠ ', ...args);

/** Normalizace názvu hlavičky: malá písmena, bez diakritiky, bez oddělovačů. */
export function normalizeHeader(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\s._\-/]+/g, '')
    .trim();
}

/** Normalizace jména hráče – zachovává diakritiku i velká písmena, jen trimuje. */
export function normalizePlayerName(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Převod hodnoty z buňky na číslo. Tolerantní k textovým zápisům
 * ("1 200 Kč", "-1,5", "", "—").
 */
export function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const cleaned = String(value)
    .replace(/\u00a0/g, ' ')
    .replace(/[^\d,.\-+eE]/g, '')
    .replace(/\s+/g, '')
    .replace(/,/g, '.');
  if (cleaned === '' || cleaned === '-' || cleaned === '+') return 0;
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Je hodnota prázdná buňka? */
export function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

/**
 * Datum z buňky na ISO (YYYY-MM-DD).
 * Podporuje Google serial number (dateTimeRenderOption=SERIAL_NUMBER),
 * český formát D.M.RRRR i ISO string.
 */
export function toIsoDate(value) {
  if (isBlank(value)) return null;

  if (typeof value === 'number' && Number.isFinite(value)) {
    // Google/Excel serial: den 0 = 1899-12-30
    const ms = Date.UTC(1899, 11, 30) + Math.round(value) * 86400000;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }

  const text = String(value).trim();

  // ISO: 2021-05-14 (případně s časem)
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  }

  // České: 14.5.2021 / 14. 5. 2021 / 14/5/2021
  const cz = text.match(/^(\d{1,2})\s*[.\/]\s*(\d{1,2})\s*[.\/]\s*(\d{2,4})/);
  if (cz) {
    let year = Number.parseInt(cz[3], 10);
    if (year < 100) year += year < 70 ? 2000 : 1900;
    return `${year}-${cz[2].padStart(2, '0')}-${cz[1].padStart(2, '0')}`;
  }

  // Poslední pokus – nechme to na Date (např. "May 14, 2021")
  const fallback = new Date(text);
  if (!Number.isNaN(fallback.getTime())) {
    return fallback.toISOString().slice(0, 10);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Parsování listu "Výsledky [rok]"
// ---------------------------------------------------------------------------

/** Aliasy hlaviček → interní klíč. Parsujeme podle názvu, nikdy podle pozice. */
const RESULT_COLUMNS = {
  name: ['jmeno', 'hrac', 'hracka', 'player', 'prezdivka', 'nick'],
  date: ['datum', 'date', 'den'],
  finish: ['finish', 'poradi', 'misto', 'place', 'pozice'],
  prize: ['prize', 'vyhra', 'vyplata', 'payout'],
  buyin: ['buyin', 'vstup', 'vstupni', 'vklad'],
  rebuys: ['rebuys', 'rebuy', 'dokup', 'dokupy'],
  addons: ['addons', 'addon', 'adon', 'adony'],
  profit: ['profit', 'zisk', 'netto', 'net'],
};

/** Hlavičky, které vědomě ignorujeme (staré bodovací systémy apod.). */
const RESULT_IGNORED = ['body', 'body2', 'body3', 'bodyold', 'poznamka', 'note', 'komentar'];

/**
 * Najde řádek hlavičky – první řádek, kde se povede identifikovat
 * alespoň jméno a finish (nebo jméno a datum).
 */
export function findHeaderRow(rows) {
  const limit = Math.min(rows.length, 15);
  for (let i = 0; i < limit; i += 1) {
    const map = mapResultHeaders(rows[i]);
    if (map.name !== undefined && (map.finish !== undefined || map.date !== undefined)) {
      return { index: i, map };
    }
  }
  return null;
}

export function mapResultHeaders(headerRow = []) {
  const map = {};
  headerRow.forEach((raw, colIndex) => {
    const key = normalizeHeader(raw);
    if (!key || RESULT_IGNORED.includes(key)) return;
    for (const [field, aliases] of Object.entries(RESULT_COLUMNS)) {
      if (map[field] !== undefined) continue;
      if (aliases.includes(key)) {
        map[field] = colIndex;
        return;
      }
    }
  });
  return map;
}

/**
 * Rozparsuje list výsledků na večery.
 *
 * Prázdné řádky v tabulce oddělují večery, ale seskupujeme primárně podle data
 * (robustnější – stray prázdný řádek uprostřed večera by jinak rozsekl počet
 * hráčů a tím i body). Prázdný řádek zároveň resetuje "fill-down" data, aby se
 * chybějící datum nedědilo přes hranici večera.
 */
export function parseResultsSheet(sheetTitle, rows) {
  const header = findHeaderRow(rows);
  if (!header) {
    warn(`list "${sheetTitle}": nepovedlo se najít hlavičku (jméno/finish) – přeskakuji.`);
    return { sessions: [], issues: [`Nenalezena hlavička v listu ${sheetTitle}`] };
  }

  const { index: headerIndex, map } = header;
  const missing = ['name', 'date', 'finish'].filter((f) => map[f] === undefined);
  const issues = [];
  if (missing.length) {
    issues.push(`list ${sheetTitle}: chybí sloupce ${missing.join(', ')}`);
    warn(`list "${sheetTitle}": chybí sloupce ${missing.join(', ')}`);
  }

  const byDate = new Map();
  let carriedDate = null;
  let skipped = 0;

  for (let r = headerIndex + 1; r < rows.length; r += 1) {
    const row = rows[r] ?? [];
    const rowIsEmpty = row.every(isBlank);
    if (rowIsEmpty) {
      carriedDate = null; // hranice večera
      continue;
    }

    const name = normalizePlayerName(row[map.name]);
    const rawDate = map.date !== undefined ? row[map.date] : null;
    const isoDate = toIsoDate(rawDate) ?? carriedDate;
    if (isoDate) carriedDate = isoDate;

    // Řádek bez jména nebo bez data neumíme zařadit (často souhrn/mezisoučet).
    if (!name || !isoDate) {
      skipped += 1;
      continue;
    }
    // Souhrnné řádky typu "celkem"
    if (/^(celkem|total|suma|sum|součet|soucet)$/i.test(name)) {
      skipped += 1;
      continue;
    }

    const prize = toNumber(map.prize !== undefined ? row[map.prize] : 0);
    const buyin = toNumber(map.buyin !== undefined ? row[map.buyin] : 0);
    const rebuys = toNumber(map.rebuys !== undefined ? row[map.rebuys] : 0);
    const addons = toNumber(map.addons !== undefined ? row[map.addons] : 0);
    const computedProfit = prize - buyin - rebuys - addons;
    const sheetProfitRaw = map.profit !== undefined ? row[map.profit] : null;
    const hasSheetProfit = !isBlank(sheetProfitRaw);
    const sheetProfit = hasSheetProfit ? toNumber(sheetProfitRaw) : null;

    const finishRaw = map.finish !== undefined ? row[map.finish] : null;
    const finish = isBlank(finishRaw) ? null : Math.round(toNumber(finishRaw));

    if (!byDate.has(isoDate)) byDate.set(isoDate, []);
    byDate.get(isoDate).push({
      name,
      finish,
      prize,
      buyin,
      rebuys,
      addons,
      // profit dopočítáváme sami (SPEC), hodnotu z tabulky si držíme na kontrolu
      profit: computedProfit,
      sheetProfit,
      profitMismatch: hasSheetProfit && Math.abs(sheetProfit - computedProfit) > 0.01,
    });
  }

  if (skipped) log(`list "${sheetTitle}": přeskočeno ${skipped} řádků bez jména/data.`);

  const mismatches = [];
  const sessions = [...byDate.entries()]
    .map(([date, players]) => {
      players.forEach((p) => {
        if (p.profitMismatch) {
          mismatches.push(`${date} / ${p.name}: tabulka ${p.sheetProfit}, dopočet ${p.profit}`);
        }
      });
      return { date, players };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  if (mismatches.length) {
    warn(
      `list "${sheetTitle}": ${mismatches.length}× se profit z tabulky liší od dopočtu ` +
        `(prize - buyin - rebuys - addons). Ukázka: ${mismatches.slice(0, 5).join(' | ')}`
    );
    issues.push(`${sheetTitle}: ${mismatches.length} rozdílů v profitu (viz log)`);
  }

  return { sessions, issues };
}

// ---------------------------------------------------------------------------
// Parsování sešitu "kredit"
// ---------------------------------------------------------------------------

/** Sloupce, které NEJSOU hráč. */
const KREDIT_NON_PLAYER = [
  'datum', 'date', 'cut', 'sum', 'suma', 'soucet', 'celkem', 'kredit',
  'poznamka', 'note', 'komentar', 'popis', 'text', 'kontrola', 'check',
  'celkemnauctu', 'nauctu', 'zustatek',
];

/**
 * Sečte historii kreditu do aktuálních zůstatků.
 *
 * - řádek 1 = hlavička (hledáme řádek obsahující "Datum")
 * - řádek s popiskem "Kredit" = souhrn v tabulce → do součtu NEVSTUPUJE,
 *   bereme ho jen na křížovou kontrolu vlastního dopočtu
 * - všechny ostatní řádky (večery i manuální dobití) se sčítají
 * - CUT nemá vlastní hráčský sloupec → do zůstatků se nepočítá, jen se reportuje
 */
export function parseKreditSheet(sheetTitle, rows) {
  let headerIndex = -1;
  for (let i = 0; i < Math.min(rows.length, 15); i += 1) {
    const normalized = (rows[i] ?? []).map(normalizeHeader);
    if (normalized.includes('datum') || normalized.includes('date')) {
      headerIndex = i;
      break;
    }
  }
  if (headerIndex === -1) {
    throw new Error(`List "${sheetTitle}" neobsahuje hlavičku se sloupcem "Datum".`);
  }

  const headerRow = rows[headerIndex] ?? [];
  const playerColumns = [];
  let cutColumn = null;
  let sumColumn = null;

  headerRow.forEach((raw, colIndex) => {
    const key = normalizeHeader(raw);
    if (!key) return;
    if (key === 'cut') { cutColumn = colIndex; return; }
    if (key === 'sum' || key === 'suma') { sumColumn = colIndex; return; }
    if (KREDIT_NON_PLAYER.includes(key)) return;
    playerColumns.push({ name: normalizePlayerName(raw), col: colIndex });
  });

  if (!playerColumns.length) {
    throw new Error(`List "${sheetTitle}": nenalezen žádný hráčský sloupec.`);
  }

  const balances = new Map(playerColumns.map((p) => [p.name, 0]));
  const txCounts = new Map(playerColumns.map((p) => [p.name, 0]));
  const reported = new Map();
  let cutTotal = 0;
  let rowsCounted = 0;
  let summaryRowIndex = null;

  for (let r = headerIndex + 1; r < rows.length; r += 1) {
    const row = rows[r] ?? [];
    if (row.every(isBlank)) continue;

    const label = String(row[0] ?? '').trim();
    const isSummaryRow =
      /^(kredit|celkem|celkem na účtu|celkem na uctu|zůstatek|zustatek|total)$/i.test(label);

    if (isSummaryRow) {
      // Souhrn z tabulky – jen na kontrolu, nesčítáme.
      if (summaryRowIndex === null) {
        summaryRowIndex = r + 1;
        playerColumns.forEach(({ name, col }) => {
          if (!isBlank(row[col])) reported.set(name, toNumber(row[col]));
        });
      }
      continue;
    }

    rowsCounted += 1;
    playerColumns.forEach(({ name, col }) => {
      const raw = row[col];
      if (isBlank(raw)) return;
      const value = toNumber(raw);
      if (value === 0) return;
      balances.set(name, balances.get(name) + value);
      txCounts.set(name, txCounts.get(name) + 1);
    });
    if (cutColumn !== null && !isBlank(row[cutColumn])) {
      cutTotal += toNumber(row[cutColumn]);
    }
  }

  const round2 = (n) => Math.round(n * 100) / 100;
  const players = playerColumns
    .map(({ name }) => ({
      name,
      balance: round2(balances.get(name)),
      transactions: txCounts.get(name),
      reportedBalance: reported.has(name) ? round2(reported.get(name)) : null,
    }))
    // Sloupce hráčů, kteří nikdy nic neměli, do dashboardu nepatří.
    .filter((p) => p.transactions > 0 || p.balance !== 0 || p.reportedBalance !== null)
    .sort((a, b) => b.balance - a.balance);

  const mismatches = players
    .filter((p) => p.reportedBalance !== null && Math.abs(p.reportedBalance - p.balance) > 0.01)
    .map((p) => `${p.name}: tabulka ${p.reportedBalance}, dopočet ${p.balance}`);

  if (mismatches.length) {
    warn(
      `kredit: dopočtený zůstatek se u ${mismatches.length} hráčů liší od řádku "Kredit" v tabulce. ` +
        mismatches.join(' | ')
    );
  } else if (reported.size) {
    log(`kredit: dopočtené zůstatky souhlasí s řádkem "Kredit" v tabulce (${reported.size} hráčů).`);
  }

  return {
    players,
    cutTotal: round2(cutTotal),
    total: round2(players.reduce((sum, p) => sum + p.balance, 0)),
    rowsCounted,
    hasSumColumn: sumColumn !== null,
    mismatches,
  };
}

// ---------------------------------------------------------------------------
// Validace konfigurace (secrets)
// ---------------------------------------------------------------------------

/**
 * Z ID sešitu vytáhne samotné ID, i když je v secretu celá URL
 * (https://docs.google.com/spreadsheets/d/<ID>/edit).
 */
export function normalizeSheetId(value, name) {
  const fromUrl = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  const id = fromUrl ? fromUrl[1] : value;
  if (!/^[a-zA-Z0-9-_]+$/.test(id)) {
    throw new Error(
      `${name} nevypadá jako ID sešitu ani jako odkaz na sešit. Očekávám tu dlouhý ` +
        'kód z URL: https://docs.google.com/spreadsheets/d/<TOHLE>/edit'
    );
  }
  if (fromUrl) log(`${name}: z odkazu vytaženo ID ${id}`);
  return id;
}

/**
 * Bezpečné rozparsování klíče service accountu. Nejčastější chyby při vkládání
 * do secretu (obalení uvozovkami, jen část souboru, prázdné znaky) tady dostanou
 * konkrétní hlášku místo kryptického „Unexpected token“.
 */
export function parseServiceAccountKey(raw) {
  let credentials;
  try {
    credentials = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_KEY není platný JSON. Do secretu patří CELÝ obsah ' +
        'staženého .json klíče včetně složených závorek, bez obalujících uvozovek ' +
        `a bez úprav. (${error.message})`
    );
  }
  if (typeof credentials !== 'object' || credentials === null) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY musí být JSON objekt klíče service accountu.');
  }
  if (credentials.type && credentials.type !== 'service_account') {
    throw new Error(
      `GOOGLE_SERVICE_ACCOUNT_KEY má type="${credentials.type}". Potřebuješ klíč typu ` +
        'service_account (Service Accounts → Keys → Add key → JSON), ne OAuth client.'
    );
  }
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_KEY neobsahuje client_email nebo private_key – ' +
        'vypadá to na jiný soubor než klíč service accountu.'
    );
  }
  if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(credentials.private_key)) {
    throw new Error(
      'private_key v GOOGLE_SERVICE_ACCOUNT_KEY nemá tvar PEM klíče – ' +
        'nejspíš se při kopírování rozbily znaky nového řádku (\\n).'
    );
  }
  return credentials;
}
