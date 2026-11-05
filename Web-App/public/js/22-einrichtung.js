import { registerActions } from './00-registry.js';
import { tRaw } from '../i18n.js';
import { ico, G, api, toast, passwortRegelText, rbHinweisVerbergen, rbHinweisZeigen, alle, eins, formularFehler, verwirfToasts } from './01-core.js';
import { oeffneErfassen, verstaendlicherGrund } from './01-bausteine.js';
import { mitZweitemFaktor, speichereEinstellungen } from './01-rueckfrage.js';
import { esc } from './00-escapen.js';

// ═══ Einrichtung beim ersten Start (Server: routes/settings.ts /einrichtung) ═
// Nur für Verwalter, nur solange etwas fehlt. „Später" schliesst bloss — beim
// nächsten Anmelden kommt der Assistent wieder, bis er abgeschlossen ist.

/** Die Schritte dieses Durchgangs; „passwort" nur, wenn es noch das Startpasswort ist. */
/** @type {string[]} */
let _schritte = [];
let _jetzt = 0;
/** Welche Quellen schon einen gespeicherten Zugang haben; dann prüft ein leeres Feld diesen. */
/** @type {Record<string, boolean>} */
let _gespeichert = {};

/** @type {Record<string, Record<string, string>>} */
const QUELLEN_FELDER = {
  rebrickable: { rebrickable_api_key: 'ew-rb' },
  brickset:    { brickset_api_key: 'ew-bs' },
  bricklink:   { bricklink_consumer_key: 'ew-bl-ck', bricklink_consumer_secret: 'ew-bl-cs',
                 bricklink_token: 'ew-bl-tv', bricklink_token_secret: 'ew-bl-ts' },
};

function zeige() {
  const modal = G('einrichtung-modal');
  alle('.ew-schritt', modal).forEach(el =>
    el.classList.toggle('aktiv', el.dataset.schritt === _schritte[_jetzt]));
  G('ew-schritte').textContent = tRaw('setup.step', { n: _jetzt + 1, von: _schritte.length });
  G('ew-spaeter').hidden = _jetzt === _schritte.length - 1;
  G('ew-zurueck').style.display = _jetzt > 0 ? '' : 'none';
  G('ew-weiter').textContent = _jetzt === _schritte.length - 1 ? tRaw('setup.finish') : tRaw('setup.next');
  // Meldungen gehören zum Schritt, in dem sie entstanden; am Feld stehen sie ohnehin.
  verwirfToasts();
}

/**
 * @param {string} quelle
 * @param {boolean | null} ok  null: noch nicht geprüft
 */
function setzeStand(quelle, ok) {
  const el = G(`ew-stand-${quelle}`);
  if (!el) return;
  el.className = ok === null ? '' : ok ? 'ew-stand ok' : 'ew-stand fehlt';
  el.innerHTML = ok === null ? '' : `${ico(ok ? 'ok' : 'fehler')}<span class="vh">${esc(tRaw(ok ? 'setup.test_ok' : 'setup.test_failed'))}</span>`;
}

/** Meldung am Abschnitt; der rohe Grund steht aufklappbar darunter. */
/** @param {string} quelle @param {string} text @param {string} [details] @param {string[]} [felder] */
function quellenFehler(quelle, text, details = '', felder = []) {
  const box = G(`ew-fehler-${quelle}`);
  if (!box) return;
  formularFehler(box, text, felder);
  if (text && details && details !== text)
    box.insertAdjacentHTML('beforeend', `<details class="fehler-details"><summary>${esc(tRaw('liste.details'))}</summary><code>${esc(details)}</code></details>`);
}

/**
 * Von selbst geht der Assistent nur auf, wenn das Startpasswort noch gilt oder
 * die Sammlung leer ist. Über einer gefüllten Sammlung spränge er sonst nach
 * dem Rendern hinein; dort genügt das Hinweisband zum Rebrickable-Schlüssel.
 */
export async function pruefeEinrichtung() {
  const d = await api('GET', '/v1/settings/einrichtung');
  if (!d?.success || !d.offen) return;
  if (!d.passwort_aendern) {
    const s = (await api('GET', '/v1/stats'))?.stats;
    const bestand = s ? (s.total_sets || 0) + (s.total_parts || 0) + (s.total_minifigs || 0) : 0;
    if (bestand > 0) return;
  }
  _schritte = [...(d.passwort_aendern ? ['passwort'] : []), 'rebrickable', 'bricklink', 'brickset', 'erstes-set'];
  _jetzt = 0;
  _gespeichert = Object.fromEntries(Object.entries(d.quellen || {}).map(([q, ok]) => [q, !!ok]));
  for (const [q, ok] of Object.entries(_gespeichert)) setzeStand(q, ok ? true : null);
  zeige();
  G('einrichtung-modal').classList.add('open');
  rbHinweisVerbergen();
}

function schliessen() { G('einrichtung-modal').classList.remove('open'); }

async function abschliessen() {
  schliessen();
  const d = await api('POST', '/v1/settings/einrichtung/fertig');
  if (!d?.success) toast(d?.error || tRaw('settings.error'), 'error');
}

export function einrichtungSpaeter() {
  schliessen();
  // Im Assistenten gespeichert, steht der Haken; der Zwischenspeicher weiss es noch nicht.
  if (!G('ew-stand-rebrickable')?.classList.contains('ok')) rbHinweisZeigen();
}

export function einrichtungZurueck() {
  if (_jetzt > 0) { _jetzt--; zeige(); }
}

export async function einrichtungWeiter() {
  if (_jetzt < _schritte.length - 1) { _jetzt++; zeige(); return; }
  await abschliessen();
}

export async function einrichtungPasswort() {
  const alt = G('ew-pw-alt').value, neu = G('ew-pw-neu').value, wdh = G('ew-pw-wdh').value;
  const box = G('ew-pw-fehler');
  formularFehler(box, '');
  const regel = passwortRegelText(neu);
  if (regel) { formularFehler(box, regel, ['ew-pw-neu']); return; }
  if (neu !== wdh) { formularFehler(box, tRaw('settings.password.mismatch'), ['ew-pw-wdh']); return; }
  const d = await mitZweitemFaktor(z => api('POST', '/v1/auth/change-password', { current: alt, newPassword: neu, ...z }));
  if (!d) return;
  if (!d?.success) {
    formularFehler(box, d?.error || tRaw('settings.error'), [d?.code === 'aktuelles_passwort_falsch' ? 'ew-pw-alt' : 'ew-pw-neu']);
    return;
  }
  ['ew-pw-alt', 'ew-pw-neu', 'ew-pw-wdh'].forEach(id => { G(id).value = ''; });
  toast(tRaw('setup.pw_done'), 'success');
  await einrichtungWeiter();
}

/**
 * Speichern, was eingetragen ist (leere Felder bleiben, wie sie sind), dann testen.
 * @param {string} quelle
 */
export async function einrichtungQuelle(quelle) {
  const felder = QUELLEN_FELDER[quelle];
  if (!felder) return;
  /** @type {Record<string, string>} */
  const werte = {};
  /** @type {string[]} */
  const leer = [];
  for (const [schluessel, id] of Object.entries(felder)) {
    const v = G(id).value.trim();
    if (v) werte[schluessel] = v; else leer.push(id);
  }
  quellenFehler(quelle, '');
  // Leer und nichts gespeichert: am Feld sagen, statt den Server „nicht konfiguriert“ melden zu lassen.
  if (leer.length && !_gespeichert[quelle]) {
    quellenFehler(quelle, tRaw(leer.length > 1 ? 'setup.fields_missing' : 'setup.key_missing'), '', leer);
    setzeStand(quelle, null);
    return;
  }
  if (Object.keys(werte).length) {
    const s = await speichereEinstellungen(tRaw('settings.api_key_title'), werte);
    if (!s) return;
    if (!s?.success) { quellenFehler(quelle, s?.error || tRaw('settings.error'), '', Object.values(felder)); return; }
    if (!leer.length) _gespeichert[quelle] = true;
  }
  const d = await api('POST', '/v1/settings/quelle-testen', { quelle });
  setzeStand(quelle, !!d?.success);
  if (d?.success) { toast(tRaw('setup.test_ok'), 'success'); return; }
  const { grund, details } = d?.code ? { grund: d.error, details: d.details == null ? undefined : String(d.details) } : verstaendlicherGrund(d);
  quellenFehler(quelle, grund || tRaw('settings.error'), details || '', d?.code === 'quelle_abgelehnt' ? Object.values(felder) : []);
}

/**
 * Letzter Schritt: dorthin, wo das erste Set entsteht.
 * @param {string} ziel
 */
export function einrichtungZiel(ziel) {
  const reiter = (/** @type {string} */ name) => eins(`.ntab[data-tab="${name}"]`)?.click();
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
