/**
 * Testy opakování HTTP požadavků: node --test "tests/**\/*.test.mjs"
 *
 * Sync 4× spadl na přechodném 503 od Google Sheets API a musel se restartovat
 * ručně. Tyhle testy hlídají, že se přechodné chyby zkusí znovu a trvalé ne.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { backoffDelay, fetchWithRetry, retryAfterMs } from '../scripts/http-retry.mjs';

/** Odpověď s jen tím, co fetchWithRetry potřebuje. */
const reply = (status, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
});

/** Postrčené prostředí: žádné reálné čekání, deterministický jitter. */
function harness(responses) {
  const slept = [];
  const retries = [];
  const queue = [...responses];
  return {
    slept,
    retries,
    calls: () => responses.length - queue.length,
    opts: {
      fetchImpl: async () => {
        const next = queue.shift();
        if (next instanceof Error) throw next;
        return next;
      },
      sleep: async (ms) => slept.push(ms),
      onRetry: (info) => retries.push(info),
      jitter: () => 0,
    },
  };
}

test('úspěšná odpověď se nezkouší znovu', async () => {
  const h = harness([reply(200)]);
  const res = await fetchWithRetry('https://x', {}, h.opts);
  assert.equal(res.status, 200);
  assert.equal(h.calls(), 1);
  assert.deepEqual(h.slept, [], 'žádné čekání');
});

test('přechodné 503 se zkusí znovu a projde (to byl reálný pád syncu)', async () => {
  const h = harness([reply(503), reply(503), reply(200)]);
  const res = await fetchWithRetry('https://x', {}, h.opts);
  assert.equal(res.status, 200);
  assert.equal(h.calls(), 3);
  assert.deepEqual(h.slept, [1000, 2000], 'exponenciální odstup');
  assert.deepEqual(
    h.retries.map((r) => r.reason),
    ['HTTP 503', 'HTTP 503'],
    'každý pokus se ohlásí'
  );
});

test('trvalé chyby se neopakují – nemá to smysl', async () => {
  for (const status of [400, 401, 403, 404]) {
    const h = harness([reply(status), reply(200)]);
    const res = await fetchWithRetry('https://x', {}, h.opts);
    assert.equal(res.status, status, `${status} se vrátí hned`);
    assert.equal(h.calls(), 1, `${status} se nezkouší znovu`);
  }
});

test('429 a 5xx se opakují', async () => {
  for (const status of [408, 429, 500, 502, 503, 504]) {
    const h = harness([reply(status), reply(200)]);
    const res = await fetchWithRetry('https://x', {}, h.opts);
    assert.equal(res.status, 200, `${status} se zkusí znovu`);
  }
});

test('po vyčerpání pokusů se vrátí poslední odpověď, ať ji zpracuje volající', async () => {
  const h = harness([reply(503), reply(503), reply(503)]);
  const res = await fetchWithRetry('https://x', {}, { ...h.opts, attempts: 3 });
  assert.equal(res.status, 503);
  assert.equal(h.calls(), 3);
  assert.equal(h.slept.length, 2, 'čeká se jen mezi pokusy, ne po posledním');
});

test('síťová výjimka se zkouší znovu, po vyčerpání propadne dál', async () => {
  const ok = harness([new Error('ECONNRESET'), reply(200)]);
  assert.equal((await fetchWithRetry('https://x', {}, ok.opts)).status, 200);

  const bad = harness([new Error('ECONNRESET'), new Error('ECONNRESET')]);
  await assert.rejects(
    () => fetchWithRetry('https://x', {}, { ...bad.opts, attempts: 2 }),
    /ECONNRESET/
  );
});

test('Retry-After má přednost před exponenciálním odstupem', async () => {
  const h = harness([reply(429, { 'retry-after': '5' }), reply(200)]);
  await fetchWithRetry('https://x', {}, h.opts);
  assert.deepEqual(h.slept, [5000]);
});

test('Retry-After: sekundy, HTTP datum i nesmysl', () => {
  const now = Date.UTC(2026, 8, 3, 12, 0, 0);
  assert.equal(retryAfterMs('7', now), 7000);
  assert.equal(retryAfterMs('  7  ', now), 7000);
  assert.equal(retryAfterMs(new Date(now + 4000).toUTCString(), now), 4000);
  assert.equal(retryAfterMs('-3', now), null);
  assert.equal(retryAfterMs('nesmysl', now), null);
  assert.equal(retryAfterMs(null, now), null);
  assert.equal(retryAfterMs('99999', now), 60000, 'zastropováno na minutu');
});

test('odstup roste exponenciálně a je zastropovaný', () => {
  const noJitter = { jitter: () => 0 };
  assert.equal(backoffDelay(1, noJitter), 1000);
  assert.equal(backoffDelay(2, noJitter), 2000);
  assert.equal(backoffDelay(3, noJitter), 4000);
  assert.equal(backoffDelay(4, noJitter), 8000);
  assert.equal(backoffDelay(5, noJitter), 15000, 'strop');
  assert.equal(backoffDelay(20, noJitter), 15000, 'strop drží');
  assert.ok(backoffDelay(1, { jitter: () => 1 }) > backoffDelay(1, noJitter), 'jitter přidává');
});
