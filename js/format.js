/** Formátovací pomůcky (české locale). */

const nf0 = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 1 });
const df = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' });
const dfShort = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric' });
const dtf = new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium', timeStyle: 'short' });

export function num(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return nf0.format(Math.round(value));
}

export function num1(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return nf1.format(value);
}

/** Číslo se znaménkem – pro profit / zůstatek. */
export function signed(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const rounded = Math.round(value);
  if (rounded === 0) return '0';
  return `${rounded > 0 ? '+' : '−'}${nf0.format(Math.abs(rounded))}`;
}

export function percent(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: digits }).format(value)} %`;
}

export function date(iso) {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : df.format(d);
}

export function dateShort(iso) {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : dfShort.format(d);
}

export function dateTime(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  return Number.isNaN(d.getTime()) ? isoString : dtf.format(d);
}

/**
 * Turnaj: datum a číslo turnaje v rámci dne (za noc se jich hraje víc).
 * `short` je pro osu grafu, dlouhá varianta pro tooltip a tabulky.
 */
export function tournament(label, { short = false, withSeq = true } = {}) {
  if (!label) return '—';
  const iso = typeof label === 'string' ? label : label.date;
  const seq = typeof label === 'string' ? null : label.seq;
  const day = short ? dateShort(iso) : date(iso);
  return withSeq && seq && seq > 1 ? `${day} · ${seq}.` : day;
}

/** Popis turnaje do tabulky: „14. 5. 2021 · 2. turnaj“. */
export function tournamentLong(label) {
  if (!label) return '—';
  const iso = typeof label === 'string' ? label : label.date;
  const seq = typeof label === 'string' ? null : label.seq;
  return seq && seq > 1 ? `${date(iso)} · ${seq}. turnaj` : date(iso);
}

/** Třída pro obarvení čísla podle znaménka. */
export function signClass(value) {
  if (!value) return 'num-muted';
  return value > 0 ? 'num-pos' : 'num-neg';
}
