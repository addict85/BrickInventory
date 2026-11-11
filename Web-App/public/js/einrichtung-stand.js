import { registerActions } from './registry.js';
import { tRaw, locale } from '../i18n.js';
import { api } from './api.js';
import { G } from './dom.js';
import { toast } from './meldungen.js';

// ═══ Stand der Ersteinrichtung (Server: routes/api_v1/einrichtung.ts) ═
// Die Anmeldeseite prüft damit, was vor dem ersten Konto noch fehlt, und erklärt die
// Installation des Wurzelzertifikats. Die Antwort trägt nur Schalter und das öffentliche
// Zertifikat (src/konto/einrichtungStand.ts) — keine Konten, keine Schlüssel.

/** Reihenfolge der Prüfungen; die Texte stehen als feste Schlüssel daneben, damit
 * kein Pfad einen i18n-Namen zusammensetzt (test/i18n-aufrufe.test.js). */
const SCHRITTE = [
  { id: 'datenbank', name: 'es.step.datenbank', hinweis: 'es.hint.datenbank' },
  { id: 'basis_url', name: 'es.step.basis_url', hinweis: 'es.hint.basis_url' },
  { id: 'https', name: 'es.step.https', hinweis: 'es.hint.https' },
  { id: 'ca', name: 'es.step.ca', hinweis: 'es.hint.ca' },
  { id: 'konto', name: 'es.step.konto', hinweis: 'es.hint.konto' },
  { id: 'quelle', name: 'es.step.quelle', hinweis: 'es.hint.quelle' },
];

let _gebaut = false;

/** Einmal aufbauen: Text statt Markup, damit die Beschriftung aus i18n kommt und
 * kein Pfad HTML zusammensetzt. */
function baueZeilen() {
  if (_gebaut) return;
  const liste = G('es-liste');
  for (const s of SCHRITTE) {
    const zeile = document.createElement('li');
    zeile.className = 'es-zeile';
    zeile.id = 'es-' + s.id;
    const punkt = document.createElement('span');
    punkt.className = 'es-punkt';
    punkt.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.textContent = tRaw(s.name);
    const wert = document.createElement('span');
    wert.className = 'es-wert';
    const hinweis = document.createElement('span');
    hinweis.className = 'es-hinweis';
    hinweis.textContent = tRaw(s.hinweis);
    zeile.append(punkt, name, wert, hinweis);
    liste.append(zeile);
  }
  _gebaut = true;
}

/** @param {{ erledigt: boolean, schritte: { id: string, ok: boolean, pflicht: boolean }[], ca: { vorhanden: boolean, fp_hex?: string, zert_sha256?: string, gueltig_bis?: string } }} d */
function zeige(d) {
  const banner = G('es-banner');
  banner.hidden = false;
  banner.classList.toggle('fertig', !!d.erledigt);
  banner.textContent = tRaw(d.erledigt ? 'es.done' : 'es.open');

  baueZeilen();
  G('es-liste').hidden = !!d.erledigt;
  for (const s of SCHRITTE) {
    const zeile = G('es-' + s.id);
    const stand = (d.schritte || []).find(x => x.id === s.id);
    if (!zeile) continue;
    if (!stand) {
      zeile.hidden = true;
      continue;
    }
    zeile.hidden = false;
    zeile.classList.toggle('ok', !!stand.ok);
    zeile.classList.toggle('fehlt', !stand.ok);
    const wert = /** @type {HTMLElement | null} */ (zeile.querySelector('.es-wert'));
    // Der Zustand steht als Text daneben: „rot“ allein ist keine Auskunft.
    if (wert)
      wert.textContent = tRaw(stand.ok ? 'es.ok' : 'es.missing') + (stand.pflicht ? '' : ' · ' + tRaw('es.optional'));
  }

  G('es-ca-fp').textContent = d.ca?.vorhanden ? d.ca.zert_sha256 || d.ca.fp_hex || '' : tRaw('es.ca_none');
  G('es-ca-zeit').textContent = d.ca?.gueltig_bis
    ? tRaw('es.ca_until', { datum: new Date(d.ca.gueltig_bis).toLocaleDateString(locale()) })
    : '';
  G('es-ca-link').hidden = !d.ca?.vorhanden;
}

async function lade() {
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
  zeige(d);
}

/** Der Knopf gehört zur Ersteinrichtung: Ist Rebrickable oder BrickLink hinterlegt,
 * verschwindet er. Ohne Antwort bleibt er stehen — dann ist die Prüfung gerade
 * das, was weiterhilft. */
export async function einrichtungKnopfPruefen() {
  const knopf = G('btn-einrichtung-pruefen');
  if (!knopf) return;
  const d = await api('GET', '/v1/einrichtung/stand');
  knopf.hidden = !!(d?.success && d.konfiguriert === true);
  const hinweis = G('einrichtung-pruefen-hinweis');
  if (hinweis) hinweis.hidden = knopf.hidden;
}

export async function einrichtungPruefen() {
  G('einrichtung-stand-modal').classList.add('open');
  await lade();
}

export async function einrichtungStandNeu() {
  await lade();
}

export function einrichtungStandSchliessen() {
  G('einrichtung-stand-modal').classList.remove('open');
}

registerActions({ einrichtungPruefen, einrichtungStandNeu, einrichtungStandSchliessen });
