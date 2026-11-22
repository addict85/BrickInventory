import { registerActions } from './registry.js';
import { tRaw } from '../i18n.js';
import { api } from './api.js';
import { ico, G, queryAll, queryOne, setHtml, insertHtml } from './dom.js';
import { passwordRuleText, formError } from './form.js';
import { hideRbHint, showRbHint } from './account.js';
import { toast, discardToasts } from './messages.js';
import { openCapture, clearerReason } from './components.js';
import { withSecondFactor, saveSettings } from './confirm-prompt.js';
import { html } from './escaping.js';

// ═══ First-run setup wizard (server: routes/api/settings.ts /settings/einrichtung) ═
// Admins only, and only while something is still missing. "Later" just closes it — the wizard comes back
// on the next login, until it is completed.

/** The steps of this pass; "password" only while the start password still applies. */
/** @type {string[]} */
let _steps = [];
let _now = 0;
/** Which sources already have a saved credential; then an empty field re-checks that one. */
/** @type {Record<string, boolean>} */
let _saved = {};

/** @type {Record<string, Record<string, string>>} */
const SOURCE_FIELDS = {
  rebrickable: { rebrickable_api_key: 'wiz-rb' },
  brickset: { brickset_api_key: 'wiz-bs' },
  bricklink: {
    bricklink_consumer_key: 'wiz-bl-ck',
    bricklink_consumer_secret: 'wiz-bl-cs',
    bricklink_token: 'wiz-bl-tv',
    bricklink_token_secret: 'wiz-bl-ts',
  },
};

function render() {
  const modal = G('setup-modal');
  for (const el of queryAll('.wiz-step', modal)) el.classList.toggle('active', el.dataset.step === _steps[_now]);
  G('wiz-steps').textContent = tRaw('setup.step', { n: _now + 1, of: _steps.length });
  G('wiz-later').hidden = _now === _steps.length - 1;
  G('wiz-back').style.display = _now > 0 ? '' : 'none';
  G('wiz-next').textContent = _now === _steps.length - 1 ? tRaw('setup.finish') : tRaw('setup.next');
  // Toasts belong to the step they arose in; they're shown at the field anyway.
  discardToasts();
}

/**
 * @param {string} source
 * @param {boolean | null} ok  null: not checked yet
 */
function setStatus(source, ok) {
  const el = G(`wiz-status-${source}`);
  if (!el) return;
  el.className = ok === null ? '' : ok ? 'wiz-status ok' : 'wiz-status missing';
  setHtml(
    el,
    ok === null
      ? ''
      : html`${ico(ok ? 'ok' : 'error')}<span class="vh">${tRaw(ok ? 'setup.test_ok' : 'setup.test_failed')}</span>`,
  );
}

/** Message on the section; the raw reason sits expandable below it. */
/** @param {string} source @param {string} text @param {string} [details] @param {string[]} [fields] */
function sourceError(source, text, details = '', fields = []) {
  const box = G(`wiz-error-${source}`);
  if (!box) return;
  formError(box, text, fields);
  if (text && details && details !== text)
    insertHtml(
      box,
      'beforeend',
      html`<details class="error-details"><summary>${tRaw('list.details')}</summary><code>${details}</code></details>`,
    );
}

/**
 * The wizard only opens on its own while the start password still applies or the collection is empty.
 * Over a populated collection it would otherwise jump in right after rendering; there, the hint banner
 * about the Rebrickable key is enough.
 */
export async function checkSetup() {
  const d = await api('GET', '/v2/settings/setup');
  if (!d?.success || !d.open) return;
  if (!d.change_password) {
    const s = (await api('GET', '/v2/stats'))?.stats;
    const total = s ? (s.total_sets || 0) + (s.total_parts || 0) + (s.total_minifigs || 0) : 0;
    if (total > 0) return;
  }
  _steps = [...(d.change_password ? ['password'] : []), 'rebrickable', 'bricklink', 'brickset', 'first-set'];
  _now = 0;
  _saved = Object.fromEntries(Object.entries(d.sources || {}).map(([q, ok]) => [q, !!ok]));
  for (const [q, ok] of Object.entries(_saved)) setStatus(q, ok ? true : null);
  render();
  G('setup-modal').classList.add('open');
  hideRbHint();
}

function close() {
  G('setup-modal').classList.remove('open');
}

async function finish() {
  close();
  const d = await api('POST', '/v2/settings/setup/complete');
  if (!d?.success) toast(d?.error || tRaw('settings.error'), 'error');
}

export function setupLater() {
  close();
  // Saved in the wizard, the checkmark is already there; the cache doesn't know yet.
  if (!G('wiz-status-rebrickable')?.classList.contains('ok')) showRbHint();
}

export function setupBack() {
  if (_now > 0) {
    _now--;
    render();
  }
}

export async function setupNext() {
  if (_now < _steps.length - 1) {
    _now++;
    render();
    return;
  }
  await finish();
}

export async function setupPassword() {
  const old = G('wiz-pw-alt').value,
    newValue = G('wiz-pw-new').value,
    again = G('wiz-pw-repeat').value;
  const box = G('wiz-pw-error');
  formError(box, '');
  const rule = passwordRuleText(newValue);
  if (rule) {
    formError(box, rule, ['wiz-pw-new']);
    return;
  }
  if (newValue !== again) {
    formError(box, tRaw('settings.password.mismatch'), ['wiz-pw-repeat']);
    return;
  }
  const d = await withSecondFactor(z =>
    api('POST', '/v2/auth/change-password', { current: old, newPassword: newValue, ...z }),
  );
  if (!d) return;
  if (!d?.success) {
    formError(box, d?.error || tRaw('settings.error'), [
      d?.code === 'current_password_wrong' ? 'wiz-pw-alt' : 'wiz-pw-new',
    ]);
    return;
  }
  ['wiz-pw-alt', 'wiz-pw-new', 'wiz-pw-repeat'].forEach(id => {
    G(id).value = '';
  });
  toast(tRaw('setup.pw_done'), 'success');
  await setupNext();
}

/**
 * Save whatever is filled in (empty fields stay as they are), then test.
 * @param {string} source
 */
export async function setupSource(source) {
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
  if (Object.keys(values).length && !(await saveSourceValues(source, fields, values, empty))) return;
  const d = await api('POST', '/v2/settings/test-source', { source: source });
  setStatus(source, !!d?.success);
  if (d?.success) {
    toast(tRaw('setup.test_ok'), 'success');
    return;
  }
  sourceTestFailed(source, fields, d);
}

/** @returns whether saving worked; a failure is already shown at the fields.
 * @param {string} source @param {Record<string, string>} fields @param {Record<string, string>} values
 * @param {string[]} empty */
async function saveSourceValues(source, fields, values, empty) {
  const s = await saveSettings(tRaw('settings.api_key_title'), values);
  if (!s) return false;
  if (!s?.success) {
    sourceError(source, s?.error || tRaw('settings.error'), '', Object.values(fields));
    return false;
  }
  if (!empty.length) _saved[source] = true;
  return true;
}

/** A rejected key marks every field of the source; other failures mark none.
 * @param {string} source @param {Record<string, string>} fields @param {any} d */
function sourceTestFailed(source, fields, d) {
  const { reason, details } = d?.code
    ? { reason: d.error, details: d.details == null ? undefined : String(d.details) }
    : clearerReason(d);
  sourceError(
    source,
    reason || tRaw('settings.error'),
    details || '',
    d?.code === 'source_rejected' ? Object.values(fields) : [],
  );
}

/**
 * Last step: head to wherever the first set is created.
 * @param {string} target
 */
export function setupTarget(target) {
  const tab = (/** @type {string} */ name) => queryOne(`.ntab[data-tab="${name}"]`)?.click();
  if (target === 'catalog') tab('catalog');
  else {
    tab('gallery');
    // The file picker must open in the same click, otherwise the browser blocks it.
    if (target === 'csv') G('csv-file')?.click();
    else openCapture();
  }
  finish();
}

// Names below are registry-exposed (index.html/connection.js) — kept unchanged.
registerActions({
  setupLater,
  setupBack,
  setupNext,
  setupPassword,
  setupSource,
  setupTarget,
});
