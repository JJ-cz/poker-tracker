/**
 * Opakování HTTP požadavků při přechodných chybách.
 *
 * Google Sheets API občas vrátí 503 „The service is currently unavailable“ –
 * není to chyba konfigurace, další pokus za chvíli projde. Bez opakování kvůli
 * tomu padal celý sync a musel se restartovat ručně.
 *
 * Vědomě bez Node závislostí (fetch i setTimeout jsou globální), aby se dal
 * modul testovat i v prohlížeči. `fetchImpl` a `sleep` jdou podstrčit z testu.
 */

/** Stavy, které mají smysl zkoušet znovu – zbytek je chyba na naší straně. */
export const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

const DEFAULT_ATTEMPTS = 5;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 15000;
const MAX_RETRY_AFTER_MS = 60000;

/** Exponenciální odstup s jitterem, ať se opakování netrefují do stejné chvíle. */
export function backoffDelay(attempt, { jitter = Math.random } = {}) {
  const exponential = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
  return Math.round(exponential + jitter() * 500);
}

/** Hodnota hlavičky Retry-After (sekundy nebo HTTP datum) v ms, nebo null. */
export function retryAfterMs(headerValue, now = Date.now()) {
  if (!headerValue) return null;
  const seconds = Number.parseInt(String(headerValue).trim(), 10);
  if (Number.isFinite(seconds) && String(seconds) === String(headerValue).trim()) {
    if (seconds < 0) return null;
    return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  }
  const date = new Date(headerValue);
  if (Number.isNaN(date.getTime())) return null;
  return Math.min(Math.max(date.getTime() - now, 0), MAX_RETRY_AFTER_MS);
}

/**
 * Jako `fetch`, ale přechodné chyby zkouší znovu.
 *
 * - trvalé chyby (401/403/404/400 …) vrací hned, opakovat je nemá smysl
 * - po vyčerpání pokusů vrací poslední odpověď, aby ji volající zpracoval
 *   svým standardním hlášením
 * - síťová výjimka po vyčerpání pokusů se propaguje
 */
export async function fetchWithRetry(
  url,
  init = {},
  {
    label = 'požadavek',
    attempts = DEFAULT_ATTEMPTS,
    fetchImpl = globalThis.fetch,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    onRetry = () => {},
    jitter = Math.random,
    now = () => Date.now(),
  } = {}
) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response = null;
    try {
      response = await fetchImpl(url, init);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
      const delay = backoffDelay(attempt, { jitter });
      onRetry({ label, attempt, attempts, delay, reason: error.message });
      await sleep(delay);
      continue;
    }

    if (response.ok || !RETRYABLE_STATUSES.has(response.status)) return response;
    if (attempt === attempts) return response;

    const delay =
      retryAfterMs(response.headers?.get?.('retry-after'), now()) ??
      backoffDelay(attempt, { jitter });
    onRetry({ label, attempt, attempts, delay, reason: `HTTP ${response.status}` });
    await sleep(delay);
  }

  // sem se dostaneme jen když attempts <= 0
  if (lastError) throw lastError;
  throw new Error(`${label}: nepovedlo se provést žádný pokus`);
}
