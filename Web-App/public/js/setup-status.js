import { registerActions } from './registry.js';
import { tRaw, locale } from '../i18n.js';
import { api } from './api.js';
import { G } from './dom.js';
import { toast } from './messages.js';

// ═══ Setup status (server: routes/api_v1/setup.ts) ═
// The login page checks with this what is still missing before the first account, and
// explains installing the root certificate. The response carries only flags and the public
// certificate (src/profile/setupStatus.ts) — no accounts, no keys.

/** Order of the checks; the texts sit as fixed keys next to them, so no path assembles an
 * i18n name (test/i18n-calls.test.js). */
const STEPS = [
  { id: 'datenbank', name: 'es.step.database', hint: 'es.hint.database' },
  { id: 'basis_url', name: 'es.step.basis_url', hint: 'es.hint.basis_url' },
  { id: 'https', name: 'es.step.https', hint: 'es.hint.https' },
  { id: 'ca', name: 'es.step.ca', hint: 'es.hint.ca' },
  { id: 'konto', name: 'es.step.account', hint: 'es.hint.account' },
  { id: 'quelle', name: 'es.step.source', hint: 'es.hint.source' },
];

let _built = false;

/** Built once: text instead of markup, so the label comes from i18n and no path assembles HTML. */
function buildRows() {
  if (_built) return;
  const list = G('es-list');
  for (const s of STEPS) {
    const row = document.createElement('li');
    row.className = 'es-row';
    row.id = 'es-' + s.id;
    const dot = document.createElement('span');
    dot.className = 'es-dot';
    dot.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.textContent = tRaw(s.name);
    const value = document.createElement('span');
    value.className = 'es-value';
    const hint = document.createElement('span');
    hint.className = 'es-hint';
    hint.textContent = tRaw(s.hint);
    row.append(dot, name, value, hint);
    list.append(row);
  }
  _built = true;
}

/** @param {{ erledigt: boolean, schritte: { id: string, ok: boolean, pflicht: boolean }[], ca: { vorhanden: boolean, fp_hex?: string, zert_sha256?: string, gueltig_bis?: string } }} d */
function show(d) {
  const banner = G('es-banner');
  banner.hidden = false;
  banner.classList.toggle('done', !!d.erledigt);
  banner.textContent = tRaw(d.erledigt ? 'es.done' : 'es.open');

  buildRows();
  G('es-list').hidden = !!d.erledigt;
  for (const s of STEPS) {
    const row = G('es-' + s.id);
    const state = (d.schritte || []).find(x => x.id === s.id);
    if (!row) continue;
    if (!state) {
      row.hidden = true;
      continue;
    }
    row.hidden = false;
    row.classList.toggle('ok', !!state.ok);
    row.classList.toggle('missing', !state.ok);
    const value = /** @type {HTMLElement | null} */ (row.querySelector('.es-value'));
    // The state shows as text next to it: "red" alone says nothing.
    if (value)
      value.textContent = tRaw(state.ok ? 'es.ok' : 'es.missing') + (state.pflicht ? '' : ' · ' + tRaw('es.optional'));
  }

  G('es-ca-fp').textContent = d.ca?.vorhanden ? d.ca.zert_sha256 || d.ca.fp_hex || '' : tRaw('es.ca_none');
  G('es-ca-time').textContent = d.ca?.gueltig_bis
    ? tRaw('es.ca_until', { date: new Date(d.ca.gueltig_bis).toLocaleDateString(locale()) })
    : '';
  G('es-ca-link').hidden = !d.ca?.vorhanden;
}

async function load() {
  const banner = G('es-banner');
  banner.hidden = false;
  banner.classList.remove('done');
  banner.textContent = tRaw('es.loading');
  const d = await api('GET', '/v1/einrichtung/stand');
  if (!d?.success) {
    banner.textContent = tRaw('es.error');
    toast(d?.error || tRaw('es.error'), 'error');
    return;
  }
  show(d);
}

/** The button belongs to the initial setup: once Rebrickable or BrickLink is configured, it
 * disappears. Without a response it stays visible — in that case the check itself is what helps. */
export async function setupCheckButtonRefresh() {
  const button = G('btn-setup-check');
  if (!button) return;
  const d = await api('GET', '/v1/einrichtung/stand');
  button.hidden = !!(d?.success && d.konfiguriert === true);
  const hint = G('setup-check-hint');
  if (hint) hint.hidden = button.hidden;
}

export async function checkSetup() {
  G('setup-status-modal').classList.add('open');
  await load();
}

export async function setupStatusNew() {
  await load();
}

export function closeSetupStatus() {
  G('setup-status-modal').classList.remove('open');
}

registerActions({ checkSetup, setupStatusNew, closeSetupStatus });
