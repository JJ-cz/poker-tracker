/**
 * Výpočty nad daty. Čisté funkce, žádný DOM.
 *
 * Zásada: statistiky se vždy počítají z PLNÝCH dat večera (kvůli bodům, které
 * závisí na počtu hráčů ten večer). Filtr hráčů je jen zobrazovací – nikdy
 * nevstupuje do výpočtu.
 */

const round2 = (n) => Math.round(n * 100) / 100;

/** Seznam hráčů, kteří v daných večerech vůbec hráli. */
export function playersIn(sessions) {
  return [...new Set(sessions.flatMap((s) => s.players.map((p) => p.name)))].sort((a, b) =>
    a.localeCompare(b, 'cs')
  );
}

/** Sezónní žebříček – jeden řádek na hráče. */
export function leaderboard(sessions) {
  const rows = new Map();

  for (const session of sessions) {
    for (const p of session.players) {
      if (!rows.has(p.name)) {
        rows.set(p.name, {
          name: p.name,
          games: 0,
          prize: 0,
          buyin: 0,
          rebuys: 0,
          addons: 0,
          points: 0,
          profit: 0,
          wins: 0,
          top3: 0,
          finishSum: 0,
          finishCount: 0,
          bestFinish: null,
        });
      }
      const row = rows.get(p.name);
      row.games += 1;
      row.prize += p.prize;
      row.buyin += p.buyin;
      row.rebuys += p.rebuys;
      row.addons += p.addons;
      row.points += p.points;
      row.profit += p.profit;
      if (p.finish !== null) {
        row.finishSum += p.finish;
        row.finishCount += 1;
        if (row.bestFinish === null || p.finish < row.bestFinish) row.bestFinish = p.finish;
        if (p.finish === 1) row.wins += 1;
        if (p.finish <= 3) row.top3 += 1;
      }
    }
  }

  return [...rows.values()]
    .map((row) => ({
      ...row,
      prize: round2(row.prize),
      buyin: round2(row.buyin),
      rebuys: round2(row.rebuys),
      addons: round2(row.addons),
      profit: round2(row.profit),
      // TOP efektivita dle SPECu: body / počet účastí × 100 %
      efficiency: row.games ? round2((row.points / row.games) * 100) : 0,
      avgFinish: row.finishCount ? round2(row.finishSum / row.finishCount) : null,
    }))
    .sort((a, b) => b.points - a.points || b.profit - a.profit || a.name.localeCompare(b.name, 'cs'));
}

/** Souhrn sezóny pro stat tiles. */
export function summary(sessions) {
  const board = leaderboard(sessions);
  const dates = sessions.map((s) => s.date).filter(Boolean);
  const seats = sessions.reduce((sum, s) => sum + s.playerCount, 0);

  let biggestWin = null;
  let biggestLoss = null;
  for (const session of sessions) {
    for (const p of session.players) {
      if (!biggestWin || p.profit > biggestWin.profit) biggestWin = { ...p, date: session.date };
      if (!biggestLoss || p.profit < biggestLoss.profit) biggestLoss = { ...p, date: session.date };
    }
  }

  return {
    sessionCount: sessions.length,
    playerCount: board.length,
    seats,
    avgPlayers: sessions.length ? round2(seats / sessions.length) : 0,
    totalPot: round2(sessions.reduce(
      (sum, s) => sum + s.players.reduce((a, p) => a + p.buyin + p.rebuys + p.addons, 0),
      0
    )),
    firstDate: dates.length ? dates[0] : null,
    lastDate: dates.length ? dates[dates.length - 1] : null,
    leader: board[0] ?? null,
    biggestWin,
    biggestLoss,
  };
}

/**
 * Kumulativní řady po večerech.
 * Před prvním večerem hráče je hodnota null (čára začne až tam, kde hráč
 * poprvé hrál), po posledním se drží poslední hodnota.
 */
export function cumulativeSeries(sessions, metric, names) {
  const labels = sessions.map((s) => s.date);
  const series = names.map((name) => {
    let running = 0;
    let started = false;
    const data = sessions.map((session) => {
      const entry = session.players.find((p) => p.name === name);
      if (entry) {
        started = true;
        running += metric === 'points' ? entry.points : entry.profit;
      }
      return started ? round2(running) : null;
    });
    return { name, data };
  });
  return { labels, series };
}

/**
 * Distribuce umístění.
 * `counts[i]` = kolikrát hráč skončil na (i+1). místě.
 */
export function finishDistribution(sessions) {
  const rows = new Map();
  let maxFinish = 0;

  for (const session of sessions) {
    for (const p of session.players) {
      if (!rows.has(p.name)) rows.set(p.name, { name: p.name, games: 0, counts: [] });
      const row = rows.get(p.name);
      row.games += 1;
      if (p.finish !== null && p.finish >= 1) {
        row.counts[p.finish - 1] = (row.counts[p.finish - 1] ?? 0) + 1;
        if (p.finish > maxFinish) maxFinish = p.finish;
      }
    }
  }

  const out = [...rows.values()].map((row) => ({
    ...row,
    counts: Array.from({ length: maxFinish }, (_, i) => row.counts[i] ?? 0),
  }));

  out.sort((a, b) => (b.counts[0] ?? 0) - (a.counts[0] ?? 0) || b.games - a.games || a.name.localeCompare(b.name, 'cs'));
  return { maxFinish, rows: out };
}

/** Detailní profil jednoho hráče. */
export function playerProfile(sessions, name) {
  const evenings = [];
  let profit = 0;
  let points = 0;

  for (const session of sessions) {
    const entry = session.players.find((p) => p.name === name);
    if (!entry) continue;
    profit += entry.profit;
    points += entry.points;
    evenings.push({
      date: session.date,
      playerCount: session.playerCount,
      finish: entry.finish,
      points: entry.points,
      profit: entry.profit,
      prize: entry.prize,
      buyin: entry.buyin,
      rebuys: entry.rebuys,
      addons: entry.addons,
      cumulativeProfit: round2(profit),
      cumulativePoints: points,
    });
  }

  if (!evenings.length) return null;

  const finishes = evenings.map((e) => e.finish).filter((f) => f !== null);
  const best = evenings.reduce((a, b) => (b.profit > a.profit ? b : a));
  const worst = evenings.reduce((a, b) => (b.profit < a.profit ? b : a));

  // série po sobě jdoucích odehraných večerů s kladným / záporným profitem
  let longestUp = 0;
  let longestDown = 0;
  let runUp = 0;
  let runDown = 0;
  for (const e of evenings) {
    if (e.profit > 0) {
      runUp += 1;
      runDown = 0;
    } else if (e.profit < 0) {
      runDown += 1;
      runUp = 0;
    } else {
      runUp = 0;
      runDown = 0;
    }
    longestUp = Math.max(longestUp, runUp);
    longestDown = Math.max(longestDown, runDown);
  }
  const currentStreak = runUp > 0 ? runUp : runDown > 0 ? -runDown : 0;

  return {
    name,
    games: evenings.length,
    profit: round2(profit),
    points,
    efficiency: round2((points / evenings.length) * 100),
    wins: finishes.filter((f) => f === 1).length,
    top3: finishes.filter((f) => f <= 3).length,
    cashes: evenings.filter((e) => e.prize > 0).length,
    bestFinish: finishes.length ? Math.min(...finishes) : null,
    worstFinish: finishes.length ? Math.max(...finishes) : null,
    avgFinish: finishes.length ? round2(finishes.reduce((a, b) => a + b, 0) / finishes.length) : null,
    bestEvening: best,
    worstEvening: worst,
    longestUpStreak: longestUp,
    longestDownStreak: longestDown,
    currentStreak,
    firstDate: evenings[0].date,
    lastDate: evenings[evenings.length - 1].date,
    evenings,
  };
}

/** Head-to-head dvou hráčů – jen večery, kde hráli oba. */
export function headToHead(sessions, nameA, nameB) {
  if (!nameA || !nameB || nameA === nameB) return null;

  let shared = 0;
  let winsA = 0;
  let winsB = 0;
  let ties = 0;
  let profitA = 0;
  let profitB = 0;
  let pointsA = 0;
  let pointsB = 0;

  for (const session of sessions) {
    const a = session.players.find((p) => p.name === nameA);
    const b = session.players.find((p) => p.name === nameB);
    if (!a || !b) continue;
    shared += 1;
    profitA += a.profit;
    profitB += b.profit;
    pointsA += a.points;
    pointsB += b.points;
    if (a.finish === null || b.finish === null) ties += 1;
    else if (a.finish < b.finish) winsA += 1;
    else if (b.finish < a.finish) winsB += 1;
    else ties += 1;
  }

  if (!shared) return { nameA, nameB, shared: 0 };

  return {
    nameA,
    nameB,
    shared,
    winsA,
    winsB,
    ties,
    profitA: round2(profitA),
    profitB: round2(profitB),
    pointsA,
    pointsB,
  };
}
