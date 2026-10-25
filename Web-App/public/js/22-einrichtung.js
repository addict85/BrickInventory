import { registerActions } from './00-registry.js';
import { t, tRaw } from '../i18n.js';
import { G, api, toast, passwortZuKurz, passwortZuKurzText } from './01-core.js';
import { oeffneErfassen } from './02-gallery.js';

// ═══ Einrichtung beim ersten Start (Server: routes/settings.ts /einrichtung) ═
// Nur für Verwalter, nur solange etwas fehlt. „Später" schliesst bloss — beim
// nächsten Anmelden kommt der Assistent wieder, bis er abgeschlossen ist.

/** Die Schritte dieses Durchgangs; „passwort" nur, wenn es noch das Startpasswort ist. */
let _schritte = [];
let _jetzt = 0;

const QUELLEN_FELDER = {
  rebrickable: { rebrickable_api_key: 'ew-rb' },
  brickset:    { brickset_api_key: 'ew-bs' },
  bricklink:   { bricklink_consumer_key: 'ew-bl-ck', bricklink_consumer_secret: 'ew-bl-cs',
                 bricklink_token: 'ew-bl-tv', bricklink_token_secret: 'ew-bl-ts' },
};

function zeige() {
  const modal = G('einrichtung-modal');
  modal.querySelectorAll('.ew-schritt').forEach(el =>
    el.classList.toggle('aktiv', el.dataset.schritt === _schritte[_jetzt]));
  G('ew-schritte').textContent = tRaw('setup.step', { n: _jetzt + 1, von: _schritte.length });
  G('ew-zurueck').style.display = _jetzt > 0 ? '' : 'none';
  G('ew-weiter').textContent = _jetzt === _schritte.length - 1 ? tRaw('setup.finish') : tRaw('setup.next');
}

function setzeStand(quelle, ok) {
  const el = G(`ew-stand-${quelle}`);
  if (el) el.textContent = ok ? '✅' : '';
}

export async function pruefeEinrichtung() {
  const d = await api('GET', '/v1/settings/einrichtung');
  if (!d?.success || !d.offen) return;
  _schritte = [...(d.passwort_aendern ? ['passwort'] : []), 'quellen', 'erstes-set'];
  _jetzt = 0;
  for (const [q, ok] of Object.entries(d.quellen || {})) setzeStand(q, ok);
  zeige();
  G('einrichtung-modal').classList.add('open');
}

function schliessen() { G('einrichtung-modal').classList.remove('open'); }

async function abschliessen() {
  schliessen();
  const d = await api('POST', '/v1/settings/einrichtung/fertig');
  if (!d?.success) toast(d?.error || tRaw('settings.error'), 'error');
}

export function einrichtungSpaeter() { schliessen(); }

export function einrichtungZurueck() {
  if (_jetzt > 0) { _jetzt--; zeige(); }
}

export async function einrichtungWeiter() {
  if (_jetzt < _schritte.length - 1) { _jetzt++; zeige(); return; }
  await abschliessen();
}

export async function einrichtungPasswort() {
  const alt = G('ew-pw-alt').value, neu = G('ew-pw-neu').value, wdh = G('ew-pw-wdh').value;
  if (neu !== wdh) { toast(tRaw('settings.password.mismatch'), 'error'); return; }
  if (passwortZuKurz(neu)) { toast(passwortZuKurzText(), 'error'); return; }
  const d = await api('POST', '/v1/auth/change-password', { current: alt, newPassword: neu });
  if (!d?.success) { toast(d?.error || tRaw('settings.error'), 'error'); return; }
  ['ew-pw-alt', 'ew-pw-neu', 'ew-pw-wdh'].forEach(id => { G(id).value = ''; });
  toast(tRaw('setup.pw_done'), 'success');
  await einrichtungWeiter();
}

/** Speichern, was eingetragen ist (leere Felder bleiben, wie sie sind), dann testen. */
export async function einrichtungQuelle(quelle) {
  const felder = QUELLEN_FELDER[quelle];
  if (!felder) return;
  const werte = {};
  for (const [schluessel, id] of Object.entries(felder)) {
    const v = G(id).value.trim();
    if (v) werte[schluessel] = v;
  }
  if (Object.keys(werte).length) {
    const s = await api('POST', '/v1/settings', werte);
    if (!s?.success) { toast(s?.error || tRaw('settings.error'), 'error'); return; }
  }
  const d = await api('POST', '/v1/settings/quelle-testen', { quelle });
  setzeStand(quelle, !!d?.success);
  toast(d?.success ? tRaw('setup.test_ok') : (d?.error || tRaw('settings.error')), d?.success ? 'success' : 'error');
}

/** Letzter Schritt: dorthin, wo das erste Set entsteht. */
export function einrichtungZiel(ziel) {
  const reiter = (name) => document.querySelector(`.ntab[data-tab="${name}"]`)?.click();
  if (ziel === 'katalog') reiter('catalog');
  else {
    reiter('gallery');
    // Die Dateiauswahl muss im selben Klick aufgehen, sonst blockt der Browser sie.
    if (ziel === 'csv') G('csv-file')?.click();
    else oeffneErfassen();
  }
  abschliessen();
}

registerActions({ einrichtungSpaeter, einrichtungZurueck, einrichtungWeiter, einrichtungPasswort,
                  einrichtungQuelle, einrichtungZiel });
