import { registerActions } from './registry.js';
import { tRaw } from '../i18n.js';
import { api } from './api.js';
import { ico, G, alle, eins, setzeHtml, fuegeHtmlEin } from './dom.js';
import { passwordRuleText, formError } from './form.js';
import { hideRbHint, showRbHint } from './account.js';
import { toast, discardToasts } from './messages.js';
import { oeffneErfassen, clearerReason } from './components.js';
import { withSecondFactor, saveSettings } from './confirm-prompt.js';
import { html } from './escaping.js';

// ═══ First-run setup wizard (server: routes/api_v1/settings.ts /settings/einrichtung) ═
// Admins only, and only while something is still missing. "Later" just closes it — the wizard comes back
// on the next login, until it is completed.

/** The steps of this pass; "passwort" only while the start password still applies. */
/** @type {string[]} */
let _steps = [];
let _now = 0;
/** Which sources already have a saved credential; then an empty field re-checks that one. */
/** @type {Record<string, boolean>} */
let _saved = {};

/** @type {Record<string, Record<string, string>>} */
const SOURCE_FIELDS = {
  rebrickable: { rebrickable_api_key: 'ew-rb' },
  brickset: { brickset_api_key: 'ew-bs' },
  bricklink: {
    bricklink_consumer_key: 'ew-bl-ck',
    bricklink_consumer_secret: 'ew-bl-cs',
    bricklink_token: 'ew-bl-tv',
    bricklink_token_secret: 'ew-bl-ts',
  },
};

function render() {
  const modal = G('einrichtung-modal');
  for (const el of alle('.ew-schritt', modal)) el.classList.toggle('aktiv', el.dataset.schritt === _steps[_now]);
  G('ew-schritte').textContent = tRaw('setup.step', { n: _now + 1, von: _steps.length });
  G('ew-spaeter').hidden = _now === _steps.length - 1;
  G('ew-zurueck').style.display = _now > 0 ? '' : 'none';
  G('ew-weiter').textContent = _now === _steps.length - 1 ? tRaw('setup.finish') : tRaw('setup.next');
  // Toasts belong to the step they arose in; they're shown at the field anyway.
  discardToasts();
}

/**
 * @param {string} source
 * @param {boolean | null} ok  null: not checked yet
 */
function setStatus(source, ok) {
  const el = G(`ew-stand-${source}`);
  if (!el) return;
  el.className = ok === null ? '' : ok ? 'ew-stand ok' : 'ew-stand fehlt';
  setzeHtml(
    el,
    ok === null
      ? ''
      : html`${ico(ok ? 'ok' : 'fehler')}<span class="vh">${tRaw(ok ? 'setup.test_ok' : 'setup.test_failed')}</span>`,
  );
}

/** Message on the section; the raw reason sits expandable below it. */
/** @param {string} source @param {string} text @param {string} [details] @param {string[]} [fields] */
function sourceError(source, text, details = '', fields = []) {
  const box = G(`ew-fehler-${source}`);
  if (!box) return;
  formError(box, text, fields);
  if (text && details && details !== text)
    fuegeHtmlEin(
      box,
      'beforeend',
      html`<details class="fehler-details"><summary>${tRaw('liste.details')}</summary><code>${details}</code></details>`,
    );
}

/**
 * The wizard only opens on its own while the start password still applies or the collection is empty.
 * Over a populated collection it would otherwise jump in right after rendering; there, the hint banner
 * about the Rebrickable key is enough.
 */
export async function checkSetup() {
  const d = await api('GET', '/v1/settings/einrichtung');
  if (!d?.success || !d.offen) return;
  if (!d.passwort_aendern) {
    const s = (await api('GET', '/v1/stats'))?.stats;
    const total = s ? (s.total_sets || 0) + (s.total_parts || 0) + (s.total_minifigs || 0) : 0;
    if (total > 0) return;
  }
  _steps = [...(d.passwort_aendern ? ['passwort'] : []), 'rebrickable', 'bricklink', 'brickset', 'erstes-set'];
  _now = 0;
  _saved = Object.fromEntries(Object.entries(d.quellen || {}).map(([q, ok]) => [q, !!ok]));
  for (const [q, ok] of Object.entries(_saved)) setStatus(q, ok ? true : null);
  render();
  G('einrichtung-modal').classList.add('open');
  hideRbHint();
}

function close() {
  G('einrichtung-modal').classList.remove('open');
}

async function finish() {
  close();
  const d = await api('POST', '/v1/settings/einrichtung/fertig');
  if (!d?.success) toast(d?.error || tRaw('settings.error'), 'error');
}

export function einrichtungSpaeter() {
  close();
  // Saved in the wizard, the checkmark is already there; the cache doesn't know yet.
  if (!G('ew-stand-rebrickable')?.classList.contains('ok')) showRbHint();
}

export function einrichtungZurueck() {
  if (_now > 0) {
    _now--;
    render();
  }
}

export async function einrichtungWeiter() {
  if (_now < _steps.length - 1) {
    _now++;
    render();
    return;
  }
  await finish();
}

export async function einrichtungPasswort() {
  const old = G('ew-pw-alt').value,
    neu = G('ew-pw-neu').value,
    again = G('ew-pw-wdh').value;
  const box = G('ew-pw-fehler');
  formError(box, '');
  const rule = passwordRuleText(neu);
  if (rule) {
    formError(box, rule, ['ew-pw-neu']);
    return;
  }
  if (neu !== again) {
    formError(box, tRaw('settings.password.mismatch'), ['ew-pw-wdh']);
    return;
  }
  const d = await withSecondFactor(z =>
    api('POST', '/v1/auth/change-password', { current: old, newPassword: neu, ...z }),
  );
  if (!d) return;
  if (!d?.success) {
    formError(box, d?.error || tRaw('settings.error'), [
      d?.code === 'aktuelles_passwort_falsch' ? 'ew-pw-alt' : 'ew-pw-neu',
    ]);
    return;
  }
  ['ew-pw-alt', 'ew-pw-neu', 'ew-pw-wdh'].forEach(id => {
    G(id).value = '';
  });
  toast(tRaw('setup.pw_done'), 'success');
  await einrichtungWeiter();
}

/**
 * Save whatever is filled in (empty fields stay as they are), then test.
 * @param {string} source
 */
export async function einrichtungQuelle(source) {
  const fields = SOURCE_FIELDS[source];
  if (!fields) return;
  /** @type {Record<string, string>} */
  const values = {};
  /** @type {string[]} */
  const empty = [];
  for (const [key, id] of Object.entries(fields)) {
    const v = G(id).value.trim();
    if (v) values[key] = v;
    else empty.push(id);
  }
  sourceError(source, '');
  // Empty and nothing saved: say so at the field, instead of letting the server report "not configured".
  if (empty.length && !_saved[source]) {
    sourceError(source, tRaw(empty.length > 1 ? 'setup.fields_missing' : 'setup.key_missing'), '', empty);
    setStatus(source, null);
    return;
  }
  if (Object.keys(values).length) {
    const s = await saveSettings(tRaw('settings.api_key_title'), values);
    if (!s) return;
    if (!s?.success) {
      sourceError(source, s?.error || tRaw('settings.error'), '', Object.values(fields));
      return;
    }
    if (!empty.length) _saved[source] = true;
  }
  const d = await api('POST', '/v1/settings/quelle-testen', { quelle: source });
  setStatus(source, !!d?.success);
  if (d?.success) {
    toast(tRaw('setup.test_ok'), 'success');
    return;
  }
  const { grund, details } = d?.code
    ? { grund: d.error, details: d.details == null ? undefined : String(d.details) }
    : clearerReason(d);
  sourceError(
    source,
    grund || tRaw('settings.error'),
    details || '',
    d?.code === 'quelle_abgelehnt' ? Object.values(fields) : [],
  );
}

/**
 * Last step: head to wherever the first set is created.
 * @param {string} target
 */
export function einrichtungZiel(target) {
  const tab = (/** @type {string} */ name) => eins(`.ntab[data-tab="${name}"]`)?.click();
  if (target === 'katalog') tab('catalog');
  else {
    tab('gallery');
    // The file picker must open in the same click, otherwise the browser blocks it.
    if (target === 'csv') G('csv-file')?.click();
    else oeffneErfassen();
  }
  finish();
}

// Names below are registry-exposed (index.html/connection.js) — kept unchanged.
registerActions({
  einrichtungSpaeter,
  einrichtungZurueck,
  einrichtungWeiter,
  einrichtungPasswort,
  einrichtungQuelle,
  einrichtungZiel,
});
