/**
 * Načítání dat.
 *
 * Frontend čte VÝHRADNĚ statické JSON soubory z data/, které generuje
 * GitHub Actions workflow (scripts/sync-sheets.mjs). Google Sheets API se odsud
 * nikdy nevolá a žádný klíč tu není.
 */

const DATA_DIR = 'data';

async function fetchJson(url) {
  const res = await fetch(`${url}?v=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Nepovedlo se načíst ${url} (HTTP ${res.status})`);
  return res.json();
}

/**
 * Dopočte metadata turnaje a body hráčů podle nového jednotného systému.
 *
 * Jeden záznam = jeden turnaj (za jednu noc se jich hraje víc, `seq` je číslo
 * turnaje v rámci dne).
 */
function decorateSessions(sessions) {
  return (sessions ?? [])
    .map((session, index) => {
      const players = (session.players ?? []).map((p) => ({
        name: p.name,
        finish: typeof p.finish === 'number' ? p.finish : null,
        prize: Number(p.prize) || 0,
        buyin: Number(p.buyin) || 0,
        rebuys: Number(p.rebuys) || 0,
        addons: Number(p.addons) || 0,
        profit: Number(p.profit) || 0,
      }));

      // Kolik hráčů u stolu skutečně bylo. Když v sešitu chybí řádek, je
      // nejvyšší pořadí věrnější než počet řádků – jinak by body vyšly nízko.
      const finishes = players.map((p) => p.finish).filter((f) => f !== null);
      const playerCount = Math.max(players.length, finishes.length ? Math.max(...finishes) : 0);

      players.forEach((p) => {
        // body_za_turnaj = (počet hráčů u stolu) − (finish pořadí hráče)
        p.points = p.finish === null ? 0 : Math.max(0, playerCount - p.finish);
      });

      return {
        id: `${session.date}#${session.seq ?? index + 1}`,
        date: session.date,
        seq: session.seq ?? index + 1,
        playerCount,
        players,
      };
    })
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.seq - b.seq);
}

/**
 * Načte index + všechny sezóny + kredit.
 * Sezóny stahujeme všechny najednou – soubory jsou malé a díky tomu můžeme
 * postavit globální roster hráčů (stabilní barvy) a souhrn „Vše“.
 */
export async function loadAll() {
  const index = await fetchJson(`${DATA_DIR}/index.json`);
  const seasonMeta = (index.seasons ?? []).filter((s) => s && s.file);

  const seasons = [];
  await Promise.all(
    seasonMeta.map(async (meta, order) => {
      try {
        const payload = await fetchJson(meta.file);
        seasons[order] = {
          id: String(meta.id ?? payload.season ?? order),
          label: String(meta.label ?? payload.season ?? order),
          year: meta.year ?? payload.year ?? null,
          sessions: decorateSessions(payload.sessions),
        };
      } catch (error) {
        console.error(`Sezóna ${meta.id}: ${error.message}`);
        seasons[order] = null;
      }
    })
  );

  const loaded = seasons.filter(Boolean).filter((s) => s.sessions.length);
  if (!loaded.length) {
    throw new Error('Žádná sezóna neobsahuje data. Proběhl už sync workflow?');
  }

  let kredit = null;
  try {
    kredit = await fetchJson(index.kredit?.file ?? `${DATA_DIR}/kredit.json`);
  } catch (error) {
    console.warn(`Kredit se nepovedlo načíst: ${error.message}`);
  }

  // souhrnná „sezóna“ přes všechny roky
  const allSessions = loaded
    .flatMap((s) => s.sessions)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.seq - b.seq);

  const roster = [...new Set(allSessions.flatMap((s) => s.players.map((p) => p.name)))].sort((a, b) =>
    a.localeCompare(b, 'cs')
  );

  return {
    generatedAt: index.generatedAt ?? null,
    issues: index.issues ?? [],
    seasons: [
      ...loaded,
      { id: '__all__', label: 'Vše', year: null, sessions: allSessions },
    ],
    roster,
    kredit,
  };
}
