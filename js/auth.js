/**
 * Jednoduchý zámek proti náhodným kolemjdoucím.
 *
 * ⚠️ Vědomě to NENÍ bezpečnostní opatření. Chrání jen zobrazení v appce –
 * soubory v data/*.json jsou na veřejném hostingu dostupné komukoli, kdo zná
 * jejich URL. Nedávej sem nic, co nesmí uniknout.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  JAK NASTAVIT HESLO
 *  1) Vygeneruj SHA-256 hash svého hesla (na macOS v Terminálu):
 *
 *       printf '%s' 'tvojeheslo' | shasum -a 256
 *
 *     (nebo `printf '%s' 'tvojeheslo' | sha256sum` na Linuxu)
 *
 *  2) Vlož výsledný 64znakový hex do PASSWORD_SHA256 níž (jen ten hash,
 *     bez mezery a bez pomlčky na konci výpisu).
 *
 *  Do kódu se tak nikdy nedostane heslo v čitelné podobě.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const PASSWORD_SHA256 = 'ec3466bebb33324c9f6628869f3691bbe600a744f87b3a913094d570a8c4d120';

const STORAGE_KEY = 'poker-tracker:unlocked';
const HEX64 = /^[0-9a-f]{64}$/i;

const isConfigured = () => HEX64.test(PASSWORD_SHA256);

/** Lokální vývoj – tam pustíme dovnitř i bez nastaveného hesla. */
function isLocalHost() {
  const { hostname, protocol } = window.location;
  return (
    protocol === 'file:' ||
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname.endsWith('.local')
  );
}

async function sha256Hex(text) {
  if (!window.crypto?.subtle) {
    throw new Error(
      'Prohlížeč neposkytuje Web Crypto API. Otevři appku přes https:// nebo http://localhost, ne jako soubor z disku.'
    );
  }
  const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Postaví zámek. `onUnlock` se zavolá jednou, až je uživatel uvnitř.
 */
export function initGate(onUnlock) {
  const gate = document.getElementById('gate');
  const form = document.getElementById('gate-form');
  const input = document.getElementById('gate-input');
  const error = document.getElementById('gate-error');
  const hint = gate.querySelector('.gate__hint');

  const showError = (message) => {
    error.textContent = message;
    error.hidden = false;
  };

  const unlock = () => {
    gate.hidden = true;
    document.getElementById('app').hidden = false;
    onUnlock();
  };

  document.getElementById('logout')?.addEventListener('click', () => {
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* nic */
    }
    window.location.reload();
  });

  const controls = document.getElementById('gate-controls');

  if (!isConfigured()) {
    if (isLocalHost()) {
      // Lokální náhled – ať se dá appka vyvíjet, než si JJ doplní hash.
      hint.textContent = 'Heslo ještě není nastavené (lokální náhled).';
      controls.innerHTML = '';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn--primary btn--block';
      btn.textContent = 'Pokračovat bez hesla';
      btn.addEventListener('click', unlock);
      controls.append(btn);
      error.style.color = 'var(--text-muted)';
      error.textContent = 'Před nasazením doplň PASSWORD_SHA256 v js/auth.js.';
      error.hidden = false;
      gate.hidden = false;
      return;
    }
    hint.textContent = 'Appka ještě není zamčená heslem.';
    controls.innerHTML = '';
    error.innerHTML =
      'Doplň SHA-256 hash hesla do <code>js/auth.js</code> (<code>PASSWORD_SHA256</code>). ' +
      'Postup je v komentáři na začátku souboru.';
    error.hidden = false;
    gate.hidden = false;
    return;
  }

  // už odemčeno v této kartě prohlížeče?
  try {
    if (window.sessionStorage.getItem(STORAGE_KEY) === PASSWORD_SHA256) {
      unlock();
      return;
    }
  } catch {
    /* sessionStorage může být zakázaný – nic se neděje, jen se přihlásí znovu */
  }

  gate.hidden = false;
  input.focus();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.hidden = true;
    try {
      const hash = await sha256Hex(input.value);
      if (hash.toLowerCase() !== PASSWORD_SHA256.toLowerCase()) {
        showError('Špatné heslo.');
        input.select();
        return;
      }
      try {
        window.sessionStorage.setItem(STORAGE_KEY, PASSWORD_SHA256);
      } catch {
        /* bez sessionStorage se prostě po refreshi přihlásí znovu */
      }
      unlock();
    } catch (err) {
      showError(err.message);
    }
  });
}
