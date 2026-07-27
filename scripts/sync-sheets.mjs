#!/usr/bin/env node
/**
 * Poker Tracker – sync dat z Google Sheets do statických JSON souborů.
 *
 * Spouští se z GitHub Actions (viz .github/workflows/sync-data.yml).
 * Nemá žádné npm závislosti – JWT se podepisuje přes node:crypto,
 * HTTP jde přes globální fetch (Node 18+).
 * Parsování tabulek žije v ./parse-sheets.mjs (čistá logika, bez Node API).
 *
 * Vstup (env):
 *   GOOGLE_SERVICE_ACCOUNT_KEY  – celý JSON klíč service accountu
 *   POKER_SHEET_ID              – ID sešitu s listy "Výsledky [rok]"
 *   KREDIT_SHEET_ID             – ID sešitu "kredit"
 *   INCLUDE_LEGACY              – "true" = zpracovat i list "staré" (volitelné)
 *   OUT_DIR                     – kam zapsat JSON (default: data)
 *
 * Výstup:
 *   data/index.json          – seznam sezón + metadata
 *   data/vysledky-<rok>.json – výsledky za rok, seskupené po večerech
 *   data/vysledky-stare.json – volitelně list "staré"
 *   data/kredit.json         – dopočítané zůstatky hráčů
 */

import { createSign } from 'node:crypto';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  log,
  normalizeHeader,
  normalizeSheetId,
  parseKreditSheet,
  parseResultsSheet,
  parseServiceAccountKey,
  warn,
} from './parse-sheets.mjs';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

// ---------------------------------------------------------------------------
// pomocné funkce
// ---------------------------------------------------------------------------

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(
      `Chybí povinná env proměnná ${name}. Přidej ji do Settings → Secrets and variables → Actions.`
    );
  }
  return value.trim();
}

/**
 * Vypíše, co je nastavené – bez hodnot, jen délky a tvar. Když sync spadne,
 * je z logu hned vidět, jestli je problém v secrets, nebo až v přístupu.
 */
function preflight() {
  const names = ['GOOGLE_SERVICE_ACCOUNT_KEY', 'POKER_SHEET_ID', 'KREDIT_SHEET_ID'];
  log('preflight – nastavené secrets:');
  for (const name of names) {
    const value = process.env[name] ?? '';
    log(`  ${name}: ${value.trim() ? `nastaveno (${value.trim().length} znaků)` : 'CHYBÍ'}`);
  }
}

// ---------------------------------------------------------------------------
// Google auth (service account → access token)
// ---------------------------------------------------------------------------

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function getAccessToken(credentials) {
  const { client_email: clientEmail, private_key: privateKey } = credentials;
  if (!clientEmail || !privateKey) {
    throw new Error('Service account JSON neobsahuje client_email / private_key.');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: clientEmail,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })
  );

  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(privateKey.replace(/\\n/g, '\n'), 'base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const assertion = `${header}.${claims}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!res.ok) {
    throw new Error(`Autentizace ke Google selhala (${res.status}): ${await res.text()}`);
  }
  const payload = await res.json();
  if (!payload.access_token) throw new Error('Google nevrátil access_token.');
  return payload.access_token;
}

// ---------------------------------------------------------------------------
// Sheets API
// ---------------------------------------------------------------------------

async function apiGet(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = await res.text();
    let hint = '';
    if (res.status === 403) {
      hint = ' – je sešit nasdílený service accountu jako Prohlížitel a je zapnuté Google Sheets API?';
    } else if (res.status === 404) {
      hint = ' – zkontroluj ID sešitu v GitHub Secrets.';
    }
    throw new Error(`Sheets API ${res.status}${hint}\n${body}`);
  }
  return res.json();
}

async function listSheetTitles(spreadsheetId, token) {
  const url = `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}?fields=properties.title,sheets.properties(title,index)`;
  const meta = await apiGet(url, token);
  return {
    title: meta.properties?.title ?? '(bez názvu)',
    sheets: (meta.sheets ?? []).map((s) => s.properties?.title).filter(Boolean),
  };
}

async function getSheetValues(spreadsheetId, sheetTitle, token) {
  const range = `'${String(sheetTitle).replace(/'/g, "''")}'`;
  const url =
    `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}` +
    '?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER&majorDimension=ROWS';
  const payload = await apiGet(url, token);
  return payload.values ?? [];
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  preflight();
  const credentials = parseServiceAccountKey(requireEnv('GOOGLE_SERVICE_ACCOUNT_KEY'));
  const pokerSheetId = normalizeSheetId(requireEnv('POKER_SHEET_ID'), 'POKER_SHEET_ID');
  const kreditSheetId = normalizeSheetId(requireEnv('KREDIT_SHEET_ID'), 'KREDIT_SHEET_ID');
  const includeLegacy = /^(1|true|yes|ano)$/i.test(process.env.INCLUDE_LEGACY ?? '');
  const outDir = path.resolve(process.env.OUT_DIR || 'data');
  const generatedAt = new Date().toISOString();

  await mkdir(outDir, { recursive: true });
  log(`service account: ${credentials.client_email}`);

  const token = await getAccessToken(credentials);
  log('access token OK');

  // --- výsledky ---------------------------------------------------------
  const poker = await listSheetTitles(pokerSheetId, token);
  log(`sešit "${poker.title}" – listy: ${poker.sheets.join(', ')}`);

  const yearSheets = [];
  const legacySheets = [];
  for (const title of poker.sheets) {
    const normalized = normalizeHeader(title);
    if (!normalized.startsWith('vysledky')) continue;
    const year = title.match(/(\d{4})/);
    if (year) yearSheets.push({ title, year: Number.parseInt(year[1], 10) });
    else legacySheets.push(title);
  }
  // list "staré" (bonus dle SPECu) – jen když je zapnutý INCLUDE_LEGACY
  for (const title of poker.sheets) {
    if (normalizeHeader(title) === 'stare' && !legacySheets.includes(title)) legacySheets.push(title);
  }

  if (!yearSheets.length) {
    throw new Error(
      `V sešitu "${poker.title}" nebyl nalezen žádný list "Výsledky [rok]". ` +
        `Nalezené listy: ${poker.sheets.join(', ')}`
    );
  }
  yearSheets.sort((a, b) => a.year - b.year);

  const seasons = [];
  const allIssues = [];

  for (const { title, year } of yearSheets) {
    const rows = await getSheetValues(pokerSheetId, title, token);
    const { sessions, issues } = parseResultsSheet(title, rows);
    allIssues.push(...issues);

    const players = [...new Set(sessions.flatMap((s) => s.players.map((p) => p.name)))].sort(
      (a, b) => a.localeCompare(b, 'cs')
    );
    const file = `vysledky-${year}.json`;
    await writeFile(
      path.join(outDir, file),
      `${JSON.stringify({ season: String(year), year, sheet: title, generatedAt, sessions }, null, 2)}\n`,
      'utf8'
    );
    log(`${file}: ${sessions.length} večerů, ${players.length} hráčů`);
    seasons.push({
      id: String(year),
      label: String(year),
      year,
      file: `data/${file}`,
      sessions: sessions.length,
      players: players.length,
    });
  }

  if (includeLegacy) {
    for (const title of legacySheets) {
      const rows = await getSheetValues(pokerSheetId, title, token);
      const { sessions, issues } = parseResultsSheet(title, rows);
      allIssues.push(...issues);
      if (!sessions.length) {
        warn(`list "${title}" nepřinesl žádná data – vynechávám.`);
        continue;
      }
      const file = 'vysledky-stare.json';
      await writeFile(
        path.join(outDir, file),
        `${JSON.stringify({ season: 'stare', year: null, sheet: title, generatedAt, sessions }, null, 2)}\n`,
        'utf8'
      );
      const players = new Set(sessions.flatMap((s) => s.players.map((p) => p.name)));
      log(`${file}: ${sessions.length} večerů, ${players.size} hráčů`);
      seasons.push({
        id: 'stare',
        label: 'Staré',
        year: null,
        file: `data/${file}`,
        sessions: sessions.length,
        players: players.size,
      });
    }
  } else if (legacySheets.length) {
    log(`list(y) ${legacySheets.join(', ')} vynechán(y) – zapni INCLUDE_LEGACY=true.`);
  }

  // --- kredit -----------------------------------------------------------
  const kreditBook = await listSheetTitles(kreditSheetId, token);
  const kreditSheetTitle = kreditBook.sheets[0];
  if (!kreditSheetTitle) throw new Error('Kredit sešit neobsahuje žádný list.');
  log(`sešit "${kreditBook.title}" – používám list "${kreditSheetTitle}"`);

  const kreditRows = await getSheetValues(kreditSheetId, kreditSheetTitle, token);
  const kredit = parseKreditSheet(kreditSheetTitle, kreditRows);
  await writeFile(
    path.join(outDir, 'kredit.json'),
    `${JSON.stringify({ generatedAt, sheet: kreditSheetTitle, ...kredit }, null, 2)}\n`,
    'utf8'
  );
  log(
    `kredit.json: ${kredit.players.length} hráčů, ${kredit.rowsCounted} transakčních řádků, ` +
      `celkem na účtu ${kredit.total}, CUT celkem ${kredit.cutTotal}`
  );

  // --- index ------------------------------------------------------------
  await writeFile(
    path.join(outDir, 'index.json'),
    `${JSON.stringify(
      {
        generatedAt,
        seasons,
        kredit: { file: 'data/kredit.json', players: kredit.players.length },
        issues: allIssues,
      },
      null,
      2
    )}\n`,
    'utf8'
  );
  log(`index.json: ${seasons.length} sezón`);

  if (allIssues.length) {
    warn(`sync hotový, ale s ${allIssues.length} upozorněními:`);
    allIssues.forEach((i) => warn(`  - ${i}`));
  } else {
    log('sync hotový bez upozornění.');
  }
}

main().catch(async (error) => {
  console.error('[sync] ✖ Sync selhal:', error.message);
  if (process.env.RUNNER_DEBUG) console.error(error);

  // Důvod selhání napiš i do souhrnu běhu – ten je vidět rovnou na stránce
  // workflow, bez rozklikávání logu.
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      await appendFile(
        process.env.GITHUB_STEP_SUMMARY,
        `### ❌ Sync selhal\n\n\`\`\`\n${error.message}\n\`\`\`\n\n`,
        'utf8'
      );
    } catch {
      /* souhrn je jen bonus */
    }
  }
  process.exit(1);
});
