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
  { id: 'datenbank', name: 'es.step.datenbank', hint: 'es.hint.datenbank' },
  { id: 'basis_url', name: 'es.step.basis_url', hint: 'es.hint.basis_url' },
  { id: 'https', name: 'es.step.https', hint: 'es.hint.https' },
  { id: 'ca', name: 'es.step.ca', hint: 'es.hint.ca' },
  { id: 'konto', name: 'es.step.konto', hint: 'es.hint.konto' },
  { id: 'quelle', name: 'es.step.quelle', hint: 'es.hint.quelle' },
];

let _built = false;

/** Built once: text instead of markup, so the label comes from i18n and no path assembles HTML. */
function buildRows() {
  if (_built) return;
  const list = G('es-liste');
  for (const s of STEPS) {
    const row = document.createElement('li');
    row.className = 'es-zeile';
    row.id = 'es-' + s.id;
    const dot = document.createElement('span');
    dot.className = 'es-punkt';
    dot.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.textContent = tRaw(s.name);
    const value = document.createElement('span');
    value.className = 'es-wert';
    const hint = document.createElement('span');
    hint.className = 'es-hinweis';
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
  banner.classList.toggle('fertig', !!d.erledigt);
  banner.textContent = tRaw(d.erledigt ? 'es.done' : 'es.open');

  buildRows();
  G('es-liste').hidden = !!d.erledigt;
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
    row.classList.toggle('fehlt', !state.ok);
    const value = /** @type {HTMLElement | null} */ (row.querySelector('.es-wert'));
    // The state shows as text next to it: "red" alone says nothing.
    if (value)
      value.textContent = tRaw(state.ok ? 'es.ok' : 'es.missing') + (state.pflicht ? '' : ' · ' + tRaw('es.optional'));
  }

  G('es-ca-fp').textContent = d.ca?.vorhanden ? d.ca.zert_sha256 || d.ca.fp_hex || '' : tRaw('es.ca_none');
  G('es-ca-zeit').textContent = d.ca?.gueltig_bis
    ? tRaw('es.ca_until', { datum: new Date(d.ca.gueltig_bis).toLocaleDateString(locale()) })
    : '';
  G('es-ca-link').hidden = !d.ca?.vorhanden;
}

async function load() {
  const banner = G('es-banner');
  banner.hidden = false;
  banner.classList.remove('fertig');
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
  const button = G('btn-einrichtung-pruefen');
  if (!button) return;
  const d = await api('GET', '/v1/einrichtung/stand');
  button.hidden = !!(d?.success && d.konfiguriert === true);
  const hint = G('einrichtung-pruefen-hinweis');
  if (hint) hint.hidden = button.hidden;
}

export async function einrichtungPruefen() {
  G('einrichtung-stand-modal').classList.add('open');
  await load();
}

export async function einrichtungStandNeu() {
  await load();
}

export function einrichtungStandSchliessen() {
  G('einrichtung-stand-modal').classList.remove('open');
}

registerActions({ einrichtungPruefen, einrichtungStandNeu, einrichtungStandSchliessen });
