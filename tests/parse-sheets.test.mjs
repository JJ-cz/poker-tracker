/**
 * Testy parseru tabulek: node --test tests/
 *
 * Pokrývají věci, na kterých se sync nejspíš rozbije, když se v sešitu něco
 * posune: pořadí a názvy sloupců, český formát data vs. serial number, prázdné
 * řádky mezi večery, souhrnný řádek „Kredit“ a sloupce CUT/SUM/poznámka.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeHeader,
  normalizeSheetId,
  parseKreditSheet,
  parseResultsSheet,
  parseServiceAccountKey,
  toIsoDate,
  toNumber,
} from '../scripts/parse-sheets.mjs';

test('normalizace hlaviček je odolná proti diakritice a oddělovačům', () => {
  assert.equal(normalizeHeader('Jméno'), 'jmeno');
  assert.equal(normalizeHeader(' Buy-In '), 'buyin');
  assert.equal(normalizeHeader('body 2'), 'body2');
  assert.equal(normalizeHeader('add-ons'), 'addons');
});

test('čísla se čtou i z textových buněk', () => {
  assert.equal(toNumber('1 200 Kč'), 1200);
  assert.equal(toNumber('-1,5'), -1.5);
  assert.equal(toNumber('1 200'), 1200);
  assert.equal(toNumber(''), 0);
  assert.equal(toNumber('—'), 0);
  assert.equal(toNumber(1234), 1234);
});

test('datum se čte ze serial numberu i z D.M.RRRR', () => {
  assert.equal(toIsoDate(44561), '2021-12-31');
  assert.equal(toIsoDate(44240), '2021-02-13');
  assert.equal(toIsoDate('14.5.2021'), '2021-05-14');
  assert.equal(toIsoDate('1. 2. 2022'), '2022-02-01');
  assert.equal(toIsoDate('2023-03-04'), '2023-03-04');
  assert.equal(toIsoDate(''), null);
});

test('list Výsledky: večery, dědění data v bloku, dopočet profitu', () => {
  const rows = [
    ['Výsledky 2021', '', '', '', '', '', '', ''],
    ['datum', 'jméno', 'finish', 'prize', 'buy-in', 'rebuys', 'add-ons', 'body 2'],
    ['1.2.2021', 'JJ', 1, 1500, 200, 200, 0, 99],
    ['', 'Luďa', 2, 500, 200, 0, 0, 50],
    ['', 'Pepa', 3, 0, 200, 400, 200, 10],
    ['', '', '', '', '', '', '', ''],
    [44240, 'JJ', 2, 400, 200, 0, 0, 20],
    [44240, 'Pepa', 1, 1200, 200, 200, 0, 80],
    ['', '', '', '', '', '', '', ''],
    ['celkem', '', '', 3600, 1000, 800, 200, ''],
  ];

  const { sessions, issues } = parseResultsSheet('Výsledky 2021', rows);

  assert.equal(sessions.length, 2, 'dva večery');
  assert.equal(sessions[0].date, '2021-02-01');
  assert.equal(sessions[1].date, '2021-02-13', 'serial number');
  assert.deepEqual(
    sessions[0].players.map((p) => p.name),
    ['JJ', 'Luďa', 'Pepa'],
    'datum se dědí přes prázdné buňky v rámci bloku'
  );
  assert.equal(sessions[1].players.length, 2);
  assert.equal(sessions[0].players[0].profit, 1500 - 200 - 200 - 0);
  assert.equal(sessions[0].players[2].profit, 0 - 200 - 400 - 200);
  assert.equal('points' in sessions[0].players[0], false, 'body počítá až frontend');
  assert.deepEqual(issues, []);
});

test('víc turnajů v jednu noc zůstane oddělených (jinak se rozbijí body)', () => {
  const rows = [
    ['datum', 'jméno', 'finish', 'prize', 'buy-in', 'rebuys', 'add-ons'],
    // 1. turnaj
    ['5.3.2022', 'JJ', 1, 600, 100, 0, 0],
    ['5.3.2022', 'Luďa', 2, 0, 100, 0, 0],
    ['5.3.2022', 'Pepa', 3, 0, 100, 0, 0],
    ['', '', '', '', '', '', ''],
    // 2. turnaj tentýž den – datum je v sešitu jen u prvního řádku bloku
    ['5.3.2022', 'Luďa', 1, 400, 100, 0, 0],
    ['', 'JJ', 2, 0, 100, 0, 0],
    ['', '', '', '', '', '', ''],
    // 3. turnaj tentýž den – datum už v sešitu vůbec není, dědí se
    ['', 'Pepa', 1, 200, 100, 0, 0],
    ['', 'JJ', 2, 0, 100, 0, 0],
  ];

  const { sessions, issues } = parseResultsSheet('Výsledky 2022', rows);

  assert.equal(sessions.length, 3, 'tři samostatné turnaje, ne jeden slepenec');
  assert.deepEqual(sessions.map((s) => s.seq), [1, 2, 3]);
  assert.deepEqual(sessions.map((s) => s.date), ['2022-03-05', '2022-03-05', '2022-03-05']);
  assert.deepEqual(sessions.map((s) => s.players.length), [3, 2, 2]);
  assert.deepEqual(
    sessions[1].players.map((p) => `${p.name}:${p.finish}`),
    ['Luďa:1', 'JJ:2'],
    'datum se dědí přes prázdný řádek, hráči zůstanou u svého turnaje'
  );
  assert.deepEqual(issues, [], 'čistá data → žádná upozornění');
});

test('podezřelý turnaj se nahlásí, ale data se nezahodí', () => {
  const chybiVitez = parseResultsSheet('Výsledky 2024', [
    ['datum', 'jméno', 'finish'],
    ['19.1.2024', 'Anička', 2],
    ['19.1.2024', 'Martin', 3],
  ]);
  assert.equal(chybiVitez.sessions.length, 1);
  assert.equal(chybiVitez.sessions[0].players.length, 2);
  assert.match(chybiVitez.issues.join(' '), /nesouvislým pořadím/);

  const dvakratTyz = parseResultsSheet('Výsledky 2026', [
    ['datum', 'jméno', 'finish'],
    ['13.2.2026', 'Aťourek', 1],
    ['13.2.2026', 'Pumča', 2],
    ['13.2.2026', 'Aťourek', 3],
  ]);
  assert.equal(dvakratTyz.sessions.length, 1);
  assert.match(dvakratTyz.issues.join(' '), /opakovaným jménem/);
});

test('řádky před prvním datem se ignorují, nespadne to', () => {
  const { sessions } = parseResultsSheet('Výsledky 2023', [
    ['datum', 'jméno', 'finish'],
    ['', 'Kdosi', 1], // ještě není žádné datum, ze kterého by se dědilo
    ['', '', ''],
    ['4.4.2023', 'JJ', 1],
  ]);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].date, '2023-04-04');
  assert.deepEqual(sessions[0].players.map((p) => p.name), ['JJ']);
});

test('list Výsledky: jiné pořadí sloupců a chybějící add-ons', () => {
  const rows = [
    ['jméno', 'pořadí', 'Datum', 'Prize', 'Buy-in', 'Rebuys'],
    ['Karel', 1, '3.4.2022', '2 000 Kč', '200', '0'],
    ['Míra', 2, '3.4.2022', '0', '200', '200'],
  ];

  const { sessions } = parseResultsSheet('Výsledky 2022', rows);

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].players[0].addons, 0);
  assert.equal(sessions[0].players[0].profit, 1800);
  assert.equal(sessions[0].players[1].finish, 2);
});

test('list bez rozpoznatelné hlavičky se přeskočí, nespadne', () => {
  const { sessions, issues } = parseResultsSheet('Výsledky 2019', [['a', 'b'], [1, 2]]);
  assert.equal(sessions.length, 0);
  assert.equal(issues.length, 1);
});

test('profit z tabulky se hlásí, když nesouhlasí s dopočtem', () => {
  const rows = [
    ['datum', 'jméno', 'finish', 'prize', 'buy-in', 'rebuys', 'add-ons', 'profit'],
    ['1.2.2021', 'JJ', 1, 1000, 200, 0, 0, 777],
  ];
  const { sessions, issues } = parseResultsSheet('Výsledky 2021', rows);
  assert.equal(sessions[0].players[0].profit, 800, 'platí vlastní dopočet');
  assert.equal(sessions[0].players[0].sheetProfit, 777);
  assert.equal(sessions[0].players[0].profitMismatch, true);
  assert.equal(issues.length, 1);
});

test('kredit: zůstatky, CUT mimo hráče, souhrnný řádek se nesčítá', () => {
  const rows = [
    ['Datum', 'JJ', 'Luďa', 'Pepa', 'CUT', 'SUM', 'poznámka'],
    ['Kredit', 1000, -200, 700, '', '', ''],
    ['1.1.2021', 500, 300, 200, 0, 1000, 'opening'],
    ['5.2.2021', 900, -700, -500, 300, 0, ''],
    ['', '', '', '', '', '', ''],
    ['10.2.2021', '', 200, '', '', 200, 'dobití'],
    ['1.3.2021', -400, '', 1000, 200, 800, 'Hokej'],
  ];

  const kredit = parseKreditSheet('kredit', rows);
  const balance = Object.fromEntries(kredit.players.map((p) => [p.name, p.balance]));

  assert.deepEqual(kredit.players.map((p) => p.name).sort(), ['JJ', 'Luďa', 'Pepa']);
  assert.equal(balance.JJ, 1000);
  assert.equal(balance['Luďa'], -200);
  assert.equal(balance.Pepa, 700);
  assert.equal(kredit.cutTotal, 500, 'CUT jen pro audit, ne do zůstatků');
  assert.equal(kredit.rowsCounted, 4, 'souhrnný řádek „Kredit“ se nepočítá');
  assert.equal(kredit.players.find((p) => p.name === 'JJ').reportedBalance, 1000);
  assert.deepEqual(kredit.mismatches, [], 'dopočet souhlasí s řádkem „Kredit“');
});

test('kredit: rozdíl proti tabulce se nahlásí, prázdný hráč se vynechá', () => {
  const rozdil = parseKreditSheet('kredit', [
    ['Datum', 'JJ', 'CUT', 'SUM'],
    ['Kredit', 999, '', ''],
    ['1.1.2021', 500, 0, 500],
  ]);
  assert.equal(rozdil.mismatches.length, 1);

  const prazdny = parseKreditSheet('kredit', [
    ['Datum', 'JJ', 'Nikdo', 'CUT', 'SUM'],
    ['1.1.2021', 500, '', 0, 500],
  ]);
  assert.deepEqual(prazdny.players.map((p) => p.name), ['JJ']);
});

test('kredit: čistě číselný sloupec není hráč', () => {
  const kredit = parseKreditSheet('kredit', [
    ['Datum', 'JJ', 1541, 'CUT', 'SUM'],
    ['1.1.2021', 500, 8012, 0, 500],
  ]);
  assert.deepEqual(kredit.players.map((p) => p.name), ['JJ'], 'sloupec 1541 se do hráčů nepočítá');
  assert.deepEqual(kredit.ignoredColumns, ['1541']);
});

test('kredit: hráč bez jediné transakce a s nulou se nezobrazuje', () => {
  const kredit = parseKreditSheet('kredit', [
    ['Datum', 'JJ', 'Lordik', 'CUT', 'SUM'],
    ['Kredit', 500, 0, '', ''],
    ['1.1.2021', 500, '', 0, 500],
  ]);
  assert.deepEqual(kredit.players.map((p) => p.name), ['JJ']);
});

test('kredit bez sloupce Datum je chyba, ne tichý průchod', () => {
  assert.throws(() => parseKreditSheet('kredit', [['A', 'B'], [1, 2]]), /Datum/);
});

test('ID sešitu se vezme i z celého odkazu', () => {
  const id = '1AbC-dEf_2GhI3jKlMnOpQrStUvWxYz';
  assert.equal(normalizeSheetId(id, 'POKER_SHEET_ID'), id);
  assert.equal(normalizeSheetId(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=0`, 'X'), id);
  assert.equal(normalizeSheetId(`https://docs.google.com/spreadsheets/d/${id}`, 'X'), id);
  assert.throws(() => normalizeSheetId('tohle není id!', 'POKER_SHEET_ID'), /nevypadá jako ID/);
});

test('klíč service accountu: konkrétní hláška místo kryptické chyby', () => {
  const key = {
    type: 'service_account',
    client_email: 'a@b.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----\n',
  };

  assert.equal(parseServiceAccountKey(JSON.stringify(key)).client_email, key.client_email);
  assert.throws(() => parseServiceAccountKey('{neplatny'), /není platný JSON/);
  assert.throws(
    () => parseServiceAccountKey(`"${JSON.stringify(key).replace(/"/g, '\\"')}"`),
    /musí být JSON objekt/,
    'klíč obalený uvozovkami'
  );
  assert.throws(
    () => parseServiceAccountKey(JSON.stringify({ type: 'authorized_user', client_email: 'x', private_key: 'y' })),
    /service_account/
  );
  assert.throws(
    () => parseServiceAccountKey(JSON.stringify({ type: 'service_account', client_email: 'x' })),
    /client_email nebo private_key/
  );
  assert.throws(() => parseServiceAccountKey(JSON.stringify({ ...key, private_key: 'MIIE...' })), /PEM/);
});
