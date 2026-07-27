/**
 * Barevné tokeny a přiřazení barvy hráči.
 *
 * Tokeny se čtou z CSS custom properties, takže světlý/tmavý režim má vlastní
 * (validované) kroky a grafy se po přepnutí jen překreslí.
 *
 * Pravidla, která tu držíme:
 *  - kategoriální paleta má 8 slotů a jejich pořadí se nemění (CVD bezpečnost)
 *  - barva patří hráči, ne jeho aktuálnímu pořadí – filtrování nikdy nepřebarví
 *    zbylé hráče
 *  - 9. a další hráč nedostane vygenerovaný odstín, ale stejný odstín + jiný
 *    vzor čáry (druhotné kódování)
 */

const SERIES_SLOTS = 8;
const LINE_STYLES = ['solid', 'dashed', 'dotted'];

/** Vzor čáry pro Chart.js (borderDash). */
export const DASH_PATTERNS = {
  solid: [],
  dashed: [7, 4],
  dotted: [2, 3],
};

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Aktuální tokeny podle platného režimu. */
export function tokens() {
  return {
    surface: cssVar('--surface-1'),
    plane: cssVar('--plane'),
    textPrimary: cssVar('--text-primary'),
    textSecondary: cssVar('--text-secondary'),
    textMuted: cssVar('--text-muted'),
    grid: cssVar('--grid'),
    axis: cssVar('--axis'),
    series: Array.from({ length: SERIES_SLOTS }, (_, i) => cssVar(`--series-${i + 1}`)),
    ordinal: Array.from({ length: 7 }, (_, i) => cssVar(`--ord-${i + 1}`)),
    positive: cssVar('--pos'),
    negative: cssVar('--neg'),
  };
}

/**
 * Stabilní přiřazení slotu hráčům. Vstupem je celý roster (napříč všemi
 * sezónami, deterministicky setřídený), takže hráč má stejnou barvu ve všech
 * sekcích i po přepnutí sezóny.
 */
export function buildPlayerStyles(roster) {
  const map = new Map();
  roster.forEach((name, index) => {
    map.set(name, {
      slot: index % SERIES_SLOTS,
      style: LINE_STYLES[Math.min(Math.floor(index / SERIES_SLOTS), LINE_STYLES.length - 1)],
    });
  });
  return map;
}

/** Barva hráče v aktuálním režimu. */
export function playerColor(styles, name, palette) {
  const entry = styles.get(name);
  return palette.series[entry ? entry.slot : 0];
}

/** Vzor čáry hráče ('solid' | 'dashed' | 'dotted'). */
export function playerLineStyle(styles, name) {
  return styles.get(name)?.style ?? 'solid';
}

/**
 * Ordinální řada pro umístění. Přesně `count` kroků z modré řady –
 * jedna barva na jedno místo, nikdy víc než 7 tříd (nad to se ocas slučuje).
 */
export function ordinalSteps(count, palette) {
  const ramp = palette.ordinal;
  if (count <= 1) return [ramp[3]];
  if (count >= ramp.length) return ramp.slice(0, ramp.length);
  // rovnoměrně rozprostřít od nejtmavšího ke světlejšímu
  const step = (ramp.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, i) => ramp[Math.round(i * step)]);
}
