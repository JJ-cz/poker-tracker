/**
 * Poker Tracker – propojení dat, výpočtů a UI.
 */

import { initGate } from './auth.js';
import { loadAll } from './data.js';
import * as S from './stats.js';
import * as C from './charts.js';
import * as F from './format.js';
import { buildPlayerStyles, playerColor, playerLineStyle, tokens } from './palette.js';

const THEME_KEY = 'poker-tracker:theme';

const state = {
  data: null,
  styles: new Map(),
  seasonId: null,
  selected: new Set(),
  section: 'leaderboard',
  trendMetric: 'profit',
  finishMode: 'absolute',
  profilePlayer: null,
  h2h: { a: null, b: null },
  sort: { key: 'points', dir: 'desc' },
  charts: { trend: null, finishes: null, kredit: null },
  // sekce, jejichž graf čeká na zviditelnění (Chart.js si v display:none
  // neumí změřit plochu a nakreslil by bary mimo osu)
  dirty: new Set(),
};

/* ── pomůcky ──────────────────────────────────────────────────────────── */

const $ = (selector) => document.querySelector(selector);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Jméno hráče s barevným čtverečkem – identita nikdy nestojí jen na barvě. */
function playerCell(name) {
  const wrap = el('span', 'cell-player');
  const swatch = el('span', 'swatch');
  swatch.style.setProperty('--swatch', playerColor(state.styles, name, tokens()));
  const lineStyle = playerLineStyle(state.styles, name);
  if (lineStyle !== 'solid') swatch.dataset.style = lineStyle;
  wrap.append(swatch, el('span', null, name));
  return wrap;
}

function currentSeason() {
  return state.data.seasons.find((s) => s.id === state.seasonId) ?? state.data.seasons[0];
}

/** Turnaje aktuální sezóny (plná data – filtr hráčů se do výpočtů nepromítá). */
function currentSessions() {
  return currentSeason().sessions;
}

/** Hráči, kteří jsou vybraní ve filtru a zároveň hráli v aktuální sezóně. */
function visiblePlayers() {
  return S.playersIn(currentSessions()).filter((name) => state.selected.has(name));
}

function destroyChart(key) {
  state.charts[key]?.destroy();
  state.charts[key] = null;
}

/**
 * Graf smí vzniknout jen v aktivní sekci. Když sekce vidět není, jen si ji
 * poznačíme a graf se dokreslí při přepnutí (showSection).
 */
function canDrawChart(section) {
  if (state.section === section) {
    state.dirty.delete(section);
    return true;
  }
  state.dirty.add(section);
  return false;
}

function chartEmpty(canvas, message) {
  const box = canvas.parentElement;
  box.querySelector('.chart-empty')?.remove();
  canvas.hidden = true;
  box.append(el('div', 'chart-empty', message));
}

function chartReady(canvas) {
  canvas.parentElement.querySelector('.chart-empty')?.remove();
  canvas.hidden = false;
}

/** Výška boxu ať zahrnuje i pás osy – jinak karta scrolluje. */
function sizeChartBox(canvas, rowCount) {
  canvas.parentElement.style.height = `${Math.max(240, rowCount * 34 + 96)}px`;
}

function fillTable(table, headers, rows, footer) {
  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');
  thead.innerHTML = '';
  tbody.innerHTML = '';
  table.querySelector('tfoot')?.remove();

  const headRow = el('tr');
  headers.forEach((h) => {
    const th = el('th', null, typeof h === 'string' ? h : h.label);
    if (typeof h === 'object' && h.title) th.title = h.title;
    headRow.append(th);
  });
  thead.append(headRow);

  rows.forEach((cells) => {
    const tr = el('tr');
    cells.forEach((cell) => {
      const td = el('td');
      if (cell instanceof Node) td.append(cell);
      else if (cell && typeof cell === 'object') {
        td.textContent = cell.text;
        if (cell.className) td.className = cell.className;
      } else td.textContent = cell ?? '—';
      tr.append(td);
    });
    tbody.append(tr);
  });

  if (footer) {
    const tfoot = el('tfoot');
    const tr = el('tr');
    footer.forEach((cell) => {
      const td = el('td');
      if (cell && typeof cell === 'object' && !(cell instanceof Node)) {
        td.textContent = cell.text;
        if (cell.className) td.className = cell.className;
      } else td.textContent = cell ?? '';
      tr.append(td);
    });
    tfoot.append(tr);
    table.append(tfoot);
  }
}

/* ── filtry ───────────────────────────────────────────────────────────── */

function renderSeasonSelect() {
  const select = $('#season-select');
  select.innerHTML = '';
  state.data.seasons.forEach((season) => {
    const option = el('option', null, season.label);
    option.value = season.id;
    select.append(option);
  });
  select.value = state.seasonId;
}

function renderPlayerChips() {
  const container = $('#player-chips');
  const players = S.playersIn(currentSessions());
  container.innerHTML = '';

  players.forEach((name) => {
    const chip = el('button', 'chip');
    chip.type = 'button';
    chip.setAttribute('aria-pressed', String(state.selected.has(name)));
    const swatch = el('span', 'chip__swatch');
    swatch.style.setProperty('--swatch', playerColor(state.styles, name, tokens()));
    const lineStyle = playerLineStyle(state.styles, name);
    if (lineStyle !== 'solid') swatch.dataset.style = lineStyle;
    chip.append(swatch, el('span', null, name));
    chip.addEventListener('click', () => {
      if (state.selected.has(name)) state.selected.delete(name);
      else state.selected.add(name);
      renderPlayerChips();
      renderAll();
    });
    container.append(chip);
  });

  $('#player-count-note').textContent = `· vybráno ${visiblePlayers().length} z ${players.length}`;
}

function selectAllPlayers() {
  state.selected = new Set(S.playersIn(currentSessions()));
}

function selectTopPlayers(count = 8) {
  const board = S.leaderboard(currentSessions());
  state.selected = new Set(board.slice(0, count).map((r) => r.name));
}

/* ── sekce: žebříček ──────────────────────────────────────────────────── */

const LEADERBOARD_COLUMNS = [
  { key: 'name', label: 'Hráč', type: 'text' },
  { key: 'games', label: 'Účasti' },
  { key: 'wins', label: 'Výhry' },
  { key: 'avgFinish', label: 'Ø umístění', decimals: 1, lowerIsBetter: true },
  { key: 'prize', label: 'Prize' },
  { key: 'buyin', label: 'Buy-in' },
  { key: 'rebuys', label: 'Rebuys' },
  { key: 'addons', label: 'Add-ons' },
  { key: 'points', label: 'Body' },
  { key: 'profit', label: 'Profit', signed: true },
  { key: 'efficiency', label: 'TOP efektivita', percent: true, title: 'body / počet účastí × 100 %' },
];

function renderTiles() {
  const sum = S.summary(currentSessions());
  const container = $('#season-tiles');
  container.innerHTML = '';

  const tiles = [
    {
      label: 'Turnajů',
      value: F.num(sum.sessionCount),
      note: [
        sum.dayCount ? `${F.num(sum.dayCount)} hracích dnů` : '',
        sum.firstDate ? `${F.date(sum.firstDate)} – ${F.date(sum.lastDate)}` : '',
      ]
        .filter(Boolean)
        .join(' · '),
    },
    { label: 'Hráčů', value: F.num(sum.playerCount), note: `Ø ${F.num1(sum.avgPlayers)} u stolu` },
    { label: 'Vedoucí žebříčku', value: sum.leader ? sum.leader.name : '—', note: sum.leader ? `${F.num(sum.leader.points)} bodů` : '' },
    {
      label: 'Nejlepší turnaj',
      value: sum.biggestWin ? F.signed(sum.biggestWin.profit) : '—',
      note: sum.biggestWin ? `${sum.biggestWin.name} · ${F.tournamentLong(sum.biggestWin)}` : '',
      className: sum.biggestWin ? F.signClass(sum.biggestWin.profit) : '',
    },
    {
      label: 'Nejhorší turnaj',
      value: sum.biggestLoss ? F.signed(sum.biggestLoss.profit) : '—',
      note: sum.biggestLoss ? `${sum.biggestLoss.name} · ${F.tournamentLong(sum.biggestLoss)}` : '',
      className: sum.biggestLoss ? F.signClass(sum.biggestLoss.profit) : '',
    },
    { label: 'Vloženo do hry', value: F.num(sum.totalPot), note: 'buy-in + rebuys + add-ons' },
  ];

  tiles.forEach((tile) => {
    const node = el('div', 'tile');
    node.append(el('div', 'tile__label', tile.label));
    const value = el('div', `tile__value ${tile.className ?? ''}`.trim(), tile.value);
    node.append(value);
    if (tile.note) node.append(el('div', 'tile__note', tile.note));
    container.append(node);
  });
}

function formatLeaderboardCell(column, row) {
  const value = row[column.key];
  if (column.type === 'text') return playerCell(value);
  if (value === null || value === undefined) return { text: '—', className: 'num-muted' };
  if (column.signed) return { text: F.signed(value), className: F.signClass(value) };
  if (column.percent) return { text: F.percent(value, 1) };
  if (column.decimals) return { text: F.num1(value) };
  return { text: F.num(value) };
}

function renderLeaderboard() {
  const table = $('#leaderboard-table');
  const visible = new Set(visiblePlayers());
  const rows = S.leaderboard(currentSessions()).filter((r) => visible.has(r.name));

  const { key, dir } = state.sort;
  rows.sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    let cmp;
    if (typeof av === 'string' || typeof bv === 'string') cmp = String(av).localeCompare(String(bv), 'cs');
    else if (av === null) cmp = 1;
    else if (bv === null) cmp = -1;
    else cmp = av - bv;
    return dir === 'asc' ? cmp : -cmp;
  });

  fillTable(
    table,
    LEADERBOARD_COLUMNS.map((c) => ({ label: c.label, title: c.title })),
    rows.map((row) => LEADERBOARD_COLUMNS.map((column) => formatLeaderboardCell(column, row))),
    rows.length
      ? [
          { text: `Celkem (${rows.length})` },
          { text: F.num(rows.reduce((s, r) => s + r.games, 0)) },
          { text: F.num(rows.reduce((s, r) => s + r.wins, 0)) },
          { text: '' },
          { text: F.num(rows.reduce((s, r) => s + r.prize, 0)) },
          { text: F.num(rows.reduce((s, r) => s + r.buyin, 0)) },
          { text: F.num(rows.reduce((s, r) => s + r.rebuys, 0)) },
          { text: F.num(rows.reduce((s, r) => s + r.addons, 0)) },
          { text: F.num(rows.reduce((s, r) => s + r.points, 0)) },
          (() => {
            const total = rows.reduce((s, r) => s + r.profit, 0);
            return { text: F.signed(total), className: F.signClass(total) };
          })(),
          { text: '' },
        ]
      : null
  );

  // hlavičky: řazení
  const headers = [...table.querySelectorAll('thead th')];
  headers.forEach((th, index) => {
    const column = LEADERBOARD_COLUMNS[index];
    th.setAttribute('aria-sort', column.key === key ? (dir === 'asc' ? 'ascending' : 'descending') : 'none');
    th.tabIndex = 0;
    const activate = () => {
      if (state.sort.key === column.key) {
        state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sort.key = column.key;
        state.sort.dir = column.type === 'text' || column.lowerIsBetter ? 'asc' : 'desc';
      }
      renderLeaderboard();
    };
    th.addEventListener('click', activate);
    th.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activate();
      }
    });
  });

  if (!rows.length) {
    table.querySelector('tbody').append(
      (() => {
        const tr = el('tr');
        const td = el('td', 'empty', 'Ve filtru není vybraný žádný hráč.');
        td.colSpan = LEADERBOARD_COLUMNS.length;
        tr.append(td);
        return tr;
      })()
    );
  }
}

/* ── sekce: vývoj v čase ──────────────────────────────────────────────── */

function renderTrend() {
  destroyChart('trend');
  const canvas = $('#trend-chart');
  const sessions = currentSessions();
  const names = visiblePlayers();
  const metric = state.trendMetric;

  $('#trend-sub').textContent =
    metric === 'profit'
      ? 'Kumulativní profit po jednotlivých turnajích. Čára hráče začíná jeho prvním odehraným turnajem.'
      : 'Kumulativní body po jednotlivých turnajích (body = počet hráčů u stolu − pořadí).';

  const table = $('#trend-table');

  if (!names.length || !sessions.length) {
    chartEmpty(canvas, 'Vyber ve filtru alespoň jednoho hráče.');
    fillTable(table, ['Datum'], []);
    return;
  }

  const { labels, series } = S.cumulativeSeries(sessions, metric, names);

  fillTable(
    table,
    ['Turnaj', ...names],
    labels.map((label, index) => [
      F.tournamentLong(label),
      ...series.map((s) => {
        const value = s.data[index];
        if (value === null) return { text: '—', className: 'num-muted' };
        return metric === 'profit'
          ? { text: F.signed(value), className: F.signClass(value) }
          : { text: F.num(value) };
      }),
    ])
  );

  if (!canDrawChart('trend')) return;
  chartReady(canvas);
  state.charts.trend = C.trendChart(canvas, { labels, series, metric, styles: state.styles, palette: tokens() });
}

/* ── sekce: umístění ──────────────────────────────────────────────────── */

function renderFinishes() {
  destroyChart('finishes');
  const canvas = $('#finishes-chart');
  const relative = state.finishMode === 'relative';
  const { maxFinish, rows: allRows } = S.finishDistribution(currentSessions());
  const visible = new Set(visiblePlayers());
  const rows = allRows.filter((r) => visible.has(r.name));
  const table = $('#finishes-table');

  $('#finishes-sub').textContent = relative
    ? 'Podíl umístění na odehraných turnajích daného hráče – fér srovnání hráčů s různým počtem účastí.'
    : 'Kolikrát který hráč skončil na 1., 2., 3. … místě (absolutní počty).';

  if (!rows.length || !maxFinish) {
    chartEmpty(canvas, 'Vyber ve filtru alespoň jednoho hráče.');
    fillTable(table, ['Hráč'], []);
    return;
  }

  const buckets = C.finishBuckets(maxFinish);
  const grouped = buckets.length < maxFinish;

  // tabulka drží plný rozpad, i když graf slučuje ocas
  const headers = [
    'Hráč',
    'Účasti',
    ...Array.from({ length: maxFinish }, (_, i) => `${i + 1}.`),
  ];

  fillTable(
    table,
    headers,
    rows.map((row) => [
      playerCell(row.name),
      { text: F.num(row.games) },
      ...row.counts.map((count) => {
        if (!count) return { text: '—', className: 'num-muted' };
        return relative
          ? { text: F.percent(row.games ? (count / row.games) * 100 : 0, 1) }
          : { text: F.num(count) };
      }),
    ])
  );

  if (grouped) {
    $('#finishes-sub').textContent +=
      ` Graf slučuje místa ${buckets.length}.+ do jedné třídy (víc než 7 barevných tříd už se plete); tabulka níž má plný rozpad.`;
  }

  if (!canDrawChart('finishes')) return;
  chartReady(canvas);
  sizeChartBox(canvas, rows.length);
  state.charts.finishes = C.finishChart(canvas, { rows, maxFinish, mode: state.finishMode, palette: tokens() });
}

/* ── sekce: hráči ─────────────────────────────────────────────────────── */

function renderProfileSelects() {
  const players = S.playersIn(currentSessions());
  const board = S.leaderboard(currentSessions());

  const fill = (select, value) => {
    select.innerHTML = '';
    players.forEach((name) => {
      const option = el('option', null, name);
      option.value = name;
      select.append(option);
    });
    if (players.includes(value)) select.value = value;
    else select.selectedIndex = 0;
    return select.value;
  };

  state.profilePlayer = fill($('#profile-select'), state.profilePlayer ?? board[0]?.name);
  state.h2h.a = fill($('#h2h-a'), state.h2h.a ?? board[0]?.name);
  state.h2h.b = fill($('#h2h-b'), state.h2h.b ?? board[1]?.name ?? board[0]?.name);
}

function statGrid(items) {
  const grid = el('div', 'profile__grid');
  items.forEach((item) => {
    const tile = el('div', 'tile');
    tile.append(el('div', 'tile__label', item.label));
    tile.append(el('div', `tile__value ${item.className ?? ''}`.trim(), item.value));
    if (item.note) tile.append(el('div', 'tile__note', item.note));
    grid.append(tile);
  });
  return grid;
}

function renderProfile() {
  const body = $('#profile-body');
  body.innerHTML = '';
  const profile = S.playerProfile(currentSessions(), state.profilePlayer);

  if (!profile) {
    body.append(el('p', 'empty', 'Pro tohoto hráče nejsou v aktuální sezóně data.'));
    return;
  }

  const streakText =
    profile.currentStreak === 0
      ? '—'
      : `${Math.abs(profile.currentStreak)}× ${profile.currentStreak > 0 ? 'v plusu' : 'v minusu'}`;

  body.append(
    statGrid([
      { label: 'Účasti', value: F.num(profile.games), note: `${F.date(profile.firstDate)} – ${F.date(profile.lastDate)}` },
      { label: 'Profit', value: F.signed(profile.profit), className: F.signClass(profile.profit) },
      { label: 'Body', value: F.num(profile.points), note: `TOP efektivita ${F.percent(profile.efficiency, 1)}` },
      { label: 'Výhry', value: F.num(profile.wins), note: `TOP 3: ${F.num(profile.top3)}×` },
      { label: 'Ø umístění', value: F.num1(profile.avgFinish), note: `nejlépe ${profile.bestFinish ?? '—'}.` },
      { label: 'Aktuální série', value: streakText, note: `nejdelší +${profile.longestUpStreak} / −${profile.longestDownStreak}` },
    ])
  );

  const highlights = el('div', 'profile__block');
  highlights.append(el('h3', 'profile__block-title', 'Nejlepší a nejhorší turnaj'));
  const hlTable = el('table', 'table');
  hlTable.append(el('thead'), el('tbody'));
  highlights.append((() => {
    const wrap = el('div', 'table-wrap');
    wrap.append(hlTable);
    return wrap;
  })());
  body.append(highlights);

  fillTable(
    hlTable,
    ['', 'Turnaj', 'Hráčů', 'Umístění', 'Body', 'Profit'],
    [
      ['Nejlepší', F.tournamentLong(profile.bestEvening), F.num(profile.bestEvening.playerCount),
        profile.bestEvening.finish ?? '—', F.num(profile.bestEvening.points),
        { text: F.signed(profile.bestEvening.profit), className: F.signClass(profile.bestEvening.profit) }],
      ['Nejhorší', F.tournamentLong(profile.worstEvening), F.num(profile.worstEvening.playerCount),
        profile.worstEvening.finish ?? '—', F.num(profile.worstEvening.points),
        { text: F.signed(profile.worstEvening.profit), className: F.signClass(profile.worstEvening.profit) }],
    ]
  );

  const history = el('div', 'profile__block');
  history.append(el('h3', 'profile__block-title', `Historie turnajů (${profile.games})`));
  const histTable = el('table', 'table');
  histTable.append(el('thead'), el('tbody'));
  const wrap = el('div', 'table-wrap table-wrap--scroll');
  wrap.append(histTable);
  history.append(wrap);
  body.append(history);

  fillTable(
    histTable,
    ['Turnaj', 'Hráčů', 'Umístění', 'Body', 'Prize', 'Buy-in', 'Rebuys', 'Add-ons', 'Profit', 'Profit kumul.'],
    [...profile.evenings].reverse().map((e) => [
      F.tournamentLong(e),
      F.num(e.playerCount),
      e.finish ?? '—',
      F.num(e.points),
      F.num(e.prize),
      F.num(e.buyin),
      F.num(e.rebuys),
      F.num(e.addons),
      { text: F.signed(e.profit), className: F.signClass(e.profit) },
      { text: F.signed(e.cumulativeProfit), className: F.signClass(e.cumulativeProfit) },
    ])
  );
}

/**
 * Zrcadlený proužek A vs. B. Barva vždy patří hráči (stejná jako v grafech),
 * znaménko nese textová hodnota nad proužkem.
 */
function meterRow(label, names, aValue, bValue, aText, bText) {
  const total = Math.abs(aValue) + Math.abs(bValue);
  const share = (value) => (total ? (Math.abs(value) / total) * 100 : 0);
  const palette = tokens();

  const side = (name, value, text, alignRight) => {
    const wrap = el('div');
    wrap.append(el('div', 'tile__note', text));
    const meter = el('div', `h2h__meter${alignRight ? ' h2h__meter--left' : ''}`);
    const fill = el('div', 'h2h__meter-fill');
    fill.style.width = `${share(value)}%`;
    fill.style.background = playerColor(state.styles, name, palette);
    meter.append(fill);
    wrap.append(meter);
    return wrap;
  };

  const row = el('div', 'h2h__row');
  row.append(
    side(names[0], aValue, aText, true),
    el('div', 'h2h__label', label),
    side(names[1], bValue, bText, false)
  );
  return row;
}

function renderH2H() {
  const body = $('#h2h-body');
  body.innerHTML = '';
  const result = S.headToHead(currentSessions(), state.h2h.a, state.h2h.b);

  if (!result) {
    body.append(el('p', 'empty', 'Vyber dva různé hráče.'));
    return;
  }
  if (!result.shared) {
    body.append(el('p', 'empty', `${result.nameA} a ${result.nameB} nehráli v této sezóně žádný turnaj společně.`));
    return;
  }

  const head = el('p', 'card__sub', `Společných turnajů: ${F.num(result.shared)} · remízy/bez pořadí: ${F.num(result.ties)}`);
  body.append(head);

  const names = [result.nameA, result.nameB];
  const bars = el('div', 'h2h__bars');
  bars.append(
    meterRow(
      'Lepší umístění',
      names,
      result.winsA,
      result.winsB,
      `${result.nameA} · ${F.num(result.winsA)}×`,
      `${result.nameB} · ${F.num(result.winsB)}×`
    ),
    meterRow(
      'Body',
      names,
      result.pointsA,
      result.pointsB,
      `${result.nameA} · ${F.num(result.pointsA)}`,
      `${result.nameB} · ${F.num(result.pointsB)}`
    ),
    meterRow(
      'Profit',
      names,
      result.profitA,
      result.profitB,
      `${result.nameA} · ${F.signed(result.profitA)}`,
      `${result.nameB} · ${F.signed(result.profitB)}`
    )
  );
  body.append(bars);
}

/* ── sekce: kredit ────────────────────────────────────────────────────── */

function renderKredit() {
  destroyChart('kredit');
  const canvas = $('#kredit-chart');
  const table = $('#kredit-table');
  const kredit = state.data.kredit;

  if (!kredit || !kredit.players?.length) {
    chartEmpty(canvas, 'Data kreditu nejsou k dispozici (data/kredit.json).');
    fillTable(table, ['Hráč'], []);
    return;
  }

  const players = [...kredit.players].sort((a, b) => b.balance - a.balance);
  const hasReported = players.some((p) => p.reportedBalance !== null && p.reportedBalance !== undefined);

  fillTable(
    table,
    [
      'Hráč',
      'Zůstatek',
      'Transakcí',
      ...(hasReported ? [{ label: 'Kontrola vs. tabulka', title: 'Řádek „Kredit“ v sešitu – appka si zůstatek počítá sama' }] : []),
    ],
    players.map((p) => [
      p.name,
      { text: F.signed(p.balance), className: F.signClass(p.balance) },
      { text: F.num(p.transactions) },
      ...(hasReported
        ? [
            p.reportedBalance === null || p.reportedBalance === undefined
              ? { text: '—', className: 'num-muted' }
              : Math.abs(p.reportedBalance - p.balance) < 0.01
                ? { text: 'souhlasí', className: 'num-muted' }
                : { text: `tabulka ${F.signed(p.reportedBalance)}`, className: 'num-neg' },
          ]
        : []),
    ]),
    [
      { text: 'Celkem na účtu' },
      (() => {
        const total = players.reduce((s, p) => s + p.balance, 0);
        return { text: F.signed(total), className: F.signClass(total) };
      })(),
      { text: F.num(kredit.rowsCounted ?? 0) },
      ...(hasReported ? [{ text: '' }] : []),
    ]
  );

  $('#kredit-sub').textContent =
    'Dopočítáno jako kumulativní součet celé historie transakcí (hrací dny i manuální dobití). ' +
    'Nezávisí na výběru sezóny ani na filtru hráčů. ' +
    `CUT (společné náklady) se do zůstatků nepočítá – celkem ${F.num(kredit.cutTotal ?? 0)}.`;

  if (!canDrawChart('kredit')) return;
  chartReady(canvas);
  sizeChartBox(canvas, players.length);
  state.charts.kredit = C.kreditChart(canvas, { players, palette: tokens() });
}

/* ── render / eventy ──────────────────────────────────────────────────── */

function renderAll() {
  $('#player-count-note').textContent = `· vybráno ${visiblePlayers().length} z ${S.playersIn(currentSessions()).length}`;
  renderTiles();
  renderLeaderboard();
  renderTrend();
  renderFinishes();
  renderProfile();
  renderH2H();
  renderKredit();
}

function showSection(name) {
  state.section = name;
  document.querySelectorAll('#section-tabs .tab').forEach((tab) => {
    tab.classList.toggle('is-active', tab.dataset.section === name);
  });
  document.querySelectorAll('.section').forEach((section) => {
    section.classList.toggle('is-active', section.dataset.section === name);
  });

  // graf sekce se kreslí teprve teď, když má canvas skutečné rozměry
  const renderers = { trend: renderTrend, finishes: renderFinishes, kredit: renderKredit };
  if (state.dirty.has(name) && renderers[name]) renderers[name]();
  state.charts[name]?.resize();
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* nic */
  }
  if (state.data) {
    renderAll();
    renderPlayerChips();
  }
}

function bindEvents() {
  document.querySelectorAll('#section-tabs .tab').forEach((tab) => {
    tab.addEventListener('click', () => showSection(tab.dataset.section));
  });

  $('#season-select').addEventListener('change', (event) => {
    state.seasonId = event.target.value;
    selectAllPlayers();
    renderPlayerChips();
    renderProfileSelects();
    renderAll();
  });

  $('#players-all').addEventListener('click', () => {
    selectAllPlayers();
    renderPlayerChips();
    renderAll();
  });
  $('#players-top').addEventListener('click', () => {
    selectTopPlayers(8);
    renderPlayerChips();
    renderAll();
  });
  $('#players-none').addEventListener('click', () => {
    state.selected = new Set();
    renderPlayerChips();
    renderAll();
  });

  $('#trend-metric').addEventListener('click', (event) => {
    const button = event.target.closest('.seg__btn');
    if (!button) return;
    state.trendMetric = button.dataset.metric;
    $('#trend-metric').querySelectorAll('.seg__btn').forEach((b) => b.classList.toggle('is-active', b === button));
    renderTrend();
  });

  $('#finishes-mode').addEventListener('click', (event) => {
    const button = event.target.closest('.seg__btn');
    if (!button) return;
    state.finishMode = button.dataset.mode;
    $('#finishes-mode').querySelectorAll('.seg__btn').forEach((b) => b.classList.toggle('is-active', b === button));
    renderFinishes();
  });

  $('#profile-select').addEventListener('change', (event) => {
    state.profilePlayer = event.target.value;
    renderProfile();
  });
  $('#h2h-a').addEventListener('change', (event) => {
    state.h2h.a = event.target.value;
    renderH2H();
  });
  $('#h2h-b').addEventListener('change', (event) => {
    state.h2h.b = event.target.value;
    renderH2H();
  });

  $('#theme-toggle').addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });
}

function showBootError(message) {
  const box = $('#boot-error');
  box.innerHTML = '';
  box.append(el('h2', null, 'Data se nepodařilo načíst'));
  box.append(
    el(
      'p',
      null,
      'Appka čte jen statické JSON soubory z data/. Ty generuje GitHub Actions workflow ' +
        '„Sync dat z Google Sheets“ – zkontroluj, jestli už proběhl.'
    )
  );
  box.append(el('pre', null, message));
  box.hidden = false;
  $('#main').hidden = true;
  $('#filters').hidden = true;
}

async function boot() {
  bindEvents();

  try {
    state.data = await loadAll();
  } catch (error) {
    console.error(error);
    showBootError(error.message);
    return;
  }

  state.styles = buildPlayerStyles(state.data.roster);
  // default = poslední skutečná sezóna (před souhrnem „Vše“)
  const real = state.data.seasons.filter((s) => s.id !== '__all__');
  state.seasonId = real[real.length - 1]?.id ?? state.data.seasons[0].id;

  renderSeasonSelect();
  selectAllPlayers();
  renderPlayerChips();
  renderProfileSelects();
  renderAll();
  showSection(state.section);

  $('#data-stamp').textContent = state.data.generatedAt
    ? `Data vygenerována ${F.dateTime(state.data.generatedAt)}`
    : 'Datum generování dat není známé';

  if (state.data.issues?.length) {
    console.warn('Sync hlásil upozornění:', state.data.issues);
  }
}

// téma se aplikuje ještě před odemčením, ať zámek nebliká
(() => {
  let saved = null;
  try {
    saved = window.localStorage.getItem(THEME_KEY);
  } catch {
    /* nic */
  }
  const prefersLight = window.matchMedia?.('(prefers-color-scheme: light)').matches;
  document.documentElement.dataset.theme = saved ?? (prefersLight ? 'light' : 'dark');
})();

initGate(boot);
