// Konto- und Lagerortfelder: Haushaltsmitglieder, Kontofilter und die
// Lagerortfelder der Erfassungswege. Eine gemeinsame Quelle, damit alle
// Formulare dieselbe Liste zeigen.
import { G, api } from './01-core.js';
import { SCOPE_VIEWS, scopeMode, setScopeMode } from './14-scope.js';
import { ladeLagerorte, lagerortBlock } from './02-detailfelder.js';
import { tRaw } from '../i18n.js';
import { esc } from './00-escapen.js';

/**
 * Kontoauswahl beim Erfassen — nur im Haushalt.
 *
 * Die Liste kommt vom Server (/sets/household-members) und enthält bei einem
 * Konto ohne Verknüpfung genau einen Eintrag. Dann bleibt das Feld verborgen:
 * Eine Auswahl mit einer einzigen Möglichkeit ist keine Auswahl, sondern eine
 * Frage, die sich nicht stellt.
 */
/**
 * Kontofilter je Ansicht sichtbar machen und mit dem gespeicherten Wert füllen.
 *
 * Bleibt verborgen, solange das Konto keine Unterkonten hat: Ein Filter mit
 * genau einer möglichen Antwort ist keine Wahl, sondern eine Frage, die sich
 * nicht stellt.
 */
export function initScopeSelects(members) {
  const isMain = members.length > 1;
  // Einträge: Alle Konten, Eigene, dann JEDES Unterkonto namentlich.
  //
  // Der Sammelposten „Unterkonten" ist auf Marcos Wunsch entfallen: Er
  // beantwortete nur „nicht mir" und stand zwischen zwei Einträgen, die
  // dieselbe Frage genauer beantworten. Bei zwei Kindern war die Auswahl
  // damit fünf Zeilen lang, von denen eine nichts hinzufügte.
  //
  // Der Server versteht `accounts=subs` weiterhin (src/haushalt/haushalt.ts) — eine
  // ältere App-Fassung auf einem Gerät schickt es sonst ins Leere.
  const subs = members.filter(m => !m.is_self);
  const opts = [
    `<option value="all">${esc(tRaw('household.scope_all'))}</option>`,
    `<option value="own">${esc(tRaw('household.scope_own'))}</option>`,
    ...subs.map(m => `<option value="${m.id}">${esc(m.username)}</option>`),
  ].join('');

  for (const view of SCOPE_VIEWS) {
    const el = G('scope-' + view);
    if (!el) continue;
    if (!isMain) { el.style.display = 'none'; continue; }
    el.innerHTML = opts;
    // Gespeicherte Wahl kann auf ein inzwischen entkoppeltes Konto zeigen —
    // dann auf „Alle" zurückfallen statt eine leere Auswahl zu zeigen.
    const saved = scopeMode(view);
    el.value = [...el.options].some(o => o.value === saved) ? saved : 'all';
    if (el.value !== saved) setScopeMode(view, el.value);
    el.style.display = '';
  }

  // Die Teileliste hat kein Auswahlfeld, sondern eine Wahl mit zwei
  // Möglichkeiten („Unterkonten mit einbeziehen", index.html). Sie beantwortet
  // dort dieselbe Frage und gehorcht deshalb derselben Regel: Wer keine
  // Unterkonten hat, bekommt sie nicht zu sehen — ein Schalter ohne Wirkung
  // ist schlechter als keiner.
  //
  // Hier und nicht in 08-init.js, weil `isMain` genau hier feststeht: Es
  // ergibt sich aus der Haushaltsantwort, die diese Funktion ohnehin schon
  // gelesen hat. Ein zweiter Abruf dafür wäre eine zweite Wahrheit.
  const subsBox = G('pl-bestand-subs-box');
  if (subsBox) {
    subsBox.style.display = isMain ? 'inline-flex' : 'none';
    // Kein Haken, wenn es nichts einzubeziehen gibt: Sonst bliebe die Wahl
    // beim Entkoppeln des letzten Unterkontos unsichtbar gesetzt stehen und
    // wirkte weiter.
    if (!isMain) { const cb = G('pl-bestand-subs'); if (cb) cb.checked = false; }
  }
}

/**
 * Die Konten des Haushalts, wie sie zuletzt geladen wurden.
 *
 * Gemerkt, weil nicht jede Auswahl in index.html steht: Das Detail der
 * Merkliste baut seine Zeilen beim Oeffnen und braucht die Liste dann —
 * lange nach loadHouseholdMembers(). Ein zweiter Abruf waere ein zweiter
 * Stand derselben Antwort.
 */
let _haushalt = [];

/** Die gemerkten Konten. Leer, solange noch keine Antwort da war. */
export function haushaltsKonten() { return _haushalt; }

export async function loadHouseholdMembers() {
  const d = await api('GET', '/v1/sets/household-members').catch(() => null);
  const members = d?.members || [];
  _haushalt = members;
  // Dieselbe Antwort entscheidet über den Kontofilter: mehr als ein Konto
  // heisst Hauptkonto mit Unterkonten.
  initScopeSelects(members);
  // Die Lagerorte in EINEM Zug: Sie fuellen die Auswahlfelder der Filter UND
  // die gemeinsame <datalist> der Eingabefelder. Zwei Aufrufe waeren zwei
  // Staende derselben Liste.
  ladeLagerorte().catch(() => {});
  // Die Vorgabe fuer die Erfassungsfelder (Marcos Stern) — eigener Abruf,
  // Begruendung bei ladeLagerortVorgabe().
  ladeLagerortVorgabe().catch(() => {});
  const html = members.map(m =>
    `<option value="${m.id}"${m.is_self ? ' selected' : ''}>${esc(m.username)}${m.is_self ? ' (ich)' : ''}</option>`
  ).join('');
  // Alle drei Erfassen-Formulare: Set, manuelles Teil, manuelle Minifigur.
  // Dieselbe Liste, dieselbe Regel — ein Kaufpreis für ein Kind zu erfassen
  // soll für alle drei gleich gehen.
  // cat-m-owner dabei — der Katalog-Dialog ist der vierte
  // Erfassungsweg und war als einziger nicht angeschlossen.
  // mk-owner ist der fuenfte Erfassungsweg (Merkliste) — dieselbe Liste,
  // dieselbe Regel. Der Grossvater traegt einen Wunsch fuer den Enkel ein.
  for (const id of ['add-owner', 'ap-owner', 'af-owner', 'cat-m-owner', 'mk-owner']) {
    const box = G(`${id}-box`), sel = G(id);
    if (!box || !sel) continue;
    if (members.length < 2) { box.style.display = 'none'; continue; }
    sel.innerHTML = html;
    box.style.display = '';
  }
  zeichneLagerortFelder();
}

/**
 * Die Lagerortfelder der fuenf ERFASSUNGSWEGE einmal zeichnen.
 *
 * ── Marcos Befund vom 24.09. ────────────────────────────────────────────────
 *
 * „Wenn ich ein Set in der Galerie hinzufuegen will, kann ich den Lagerort
 * nicht waehlen. Egal ob ich das manuell oder per Barcode hinzufuege. Bei den
 * manuell erfassten Teilen kann ich beim Erfassen keinen Lagerort setzen. Bei
 * manuelle erfassten Minifiguren kann ich beim Erfassen keinen Lagerort
 * setzen." Dazu die beiden Wege in die Galerie, aus dem Katalog und aus der
 * Merkliste.
 *
 * ── Warum hier und nicht fuenfmal im HTML ───────────────────────────────────
 *
 * Das Bedienelement ist zusammengesetzt (Auswahl + Textfeld fuer einen neuen
 * Ort) und steht als EINE Fassung in lagerortBlock() — dieselbe, die die
 * Detailansichten benutzen. Fuenfmal von Hand ausgeschrieben waeren fuenf
 * Fassungen, die auseinanderlaufen koennen.
 *
 * Gezeichnet wird zusammen mit der Kontoauswahl, weil beides denselben Anlass
 * hat: Der Haushalt ist geladen, die Erfassungsformulare stehen. setzeOrtVorrat()
 * zieht die Auswahlen danach von selbst nach, sobald der Vorrat eintrifft —
 * sie tragen data-ortauswahl.
 */
export const ERFASSUNGS_ORTFELDER = ['add-storage', 'ap-storage', 'af-storage',
                                     'cat-m-storage', 'mk-take-storage'];

/**
 * Der Lagerort, der beim Erfassen schon dastehen soll — Marcos Stern.
 *
 * „Weiter möchte ich ein Lagerort in den Einstellungen als Default setzen
 *  können. Der soll dann bei einer Neuerfassung bereits vorausgewählt sein."
 *
 * Leer heisst: keine Vorgabe, die Felder stehen auf „—" wie bisher.
 */
let _ortVorgabe = '';

/** Ein Lagerortfeld eines Erfassungswegs neu zeichnen. */
function zeichneOrtFeld(id, wert) {
  const slot = G(`${id}-slot`);
  if (!slot) return;
  slot.innerHTML = lagerortBlock(id, wert);
  // Die sichtbare Beschriftung steht im HTML, die beiden Bedienelemente
  // entstehen hier — ein `for=` darauf waere im Quelltext ein Verweis ins
  // Leere (test/a11y.test.js meldet genau das, zu Recht). aria-labelledby
  // stellt die Verbindung zur Laufzeit her, und zwar fuer BEIDE: Auswahl und
  // Textfeld tragen denselben Namen, weil sie dasselbe Feld sind.
  for (const el of slot.children) el.setAttribute('aria-labelledby', `${id}-label`);
  slot.dataset.gezeichnet = '1';
}

export function zeichneLagerortFelder() {
  for (const id of ERFASSUNGS_ORTFELDER) {
    const slot = G(`${id}-slot`);
    // Nur einmal: Ein zweiter Durchlauf wuerfe eine bereits getroffene Wahl weg.
    if (!slot || slot.dataset.gezeichnet === '1') continue;
    zeichneOrtFeld(id, _ortVorgabe);
  }
}

/**
 * Die Vorgabe holen und die Erfassungsfelder darauf stellen.
 *
 * ── Warum ein eigener Abruf und nicht der Vorrat von ladeLagerorte() ────────
 *
 * ladeLagerorte() liest /v1/storage — das sind die BELEGTEN Orte mit ihrer
 * Anzahl, und die Antwort hat keine Vorgabe (sie ist je Konto, die Uebersicht
 * spannt das ganze Blickfeld). Die Vorgabe steht in /v1/storage/locations,
 * also beim Vorrat, zu dem sie gehoert.
 *
 * Das Vorbild ist initDefaultCondition() in 01-core.js: Derselbe Gedanke —
 * eine Einstellung aus den Einstellungen belegt die Erfassungsformulare vor —,
 * nur fuer den Ort statt fuer den Zustand.
 *
 * NACHZIEHEN, weil die Felder schon stehen: Sie werden mit dem Haushalt
 * gezeichnet, die Antwort kommt ueber das Netz. Nachgezogen wird aber nur, was
 * noch LEER ist; wer in der Zwischenzeit selbst etwas gewaehlt hat, behaelt es.
 */
export async function ladeLagerortVorgabe() {
  const d = await api('GET', '/v1/storage/locations').catch(() => null);
  if (!d?.success) return;
  _ortVorgabe = d.vorgabe?.name || '';
  if (!_ortVorgabe) return;
  for (const id of ERFASSUNGS_ORTFELDER) {
    if (!(G(id)?.value || '').trim()) zeichneOrtFeld(id, _ortVorgabe);
  }
}

/**
 * Das Lagerortfeld eines Erfassungswegs auf den Ausgangszustand stellen.
 *
 * Beim Oeffnen des Formulars, wie Anzahl und Kaufpreis auch: Ein Ort von
 * vorhin sieht aus wie eine Vorgabe, ist aber ein Rest.
 *
 * Seit es Marcos Stern gibt, ist der Ausgangszustand nicht mehr zwangslaeufig
 * leer: Gibt es eine Vorgabe, steht SIE wieder da. Genau das ist der Sinn der
 * Sache — und deshalb heisst die Funktion nicht mehr „leeren", sondern stellt
 * den Anfang wieder her.
 *
 * Gezeichnet statt gesetzt: ortOptionen() legt fuer einen Ort, den der Vorrat
 * noch nicht kennt (die Liste kommt ueber das Netz), eine eigene Option an.
 * Setzte man nur `sel.value`, stuende die Auswahl auf „—", waehrend im
 * Textfeld der Ort steht — ein Feld mit zwei Aussagen.
 */
export function leereLagerortFeld(id) {
  if (G(`${id}-slot`)) { zeichneOrtFeld(id, _ortVorgabe); return; }
  // Ohne Slot gibt es das zusammengesetzte Feld nicht; dann bleibt es beim
  // alten Weg. Heute hat jeder der fuenf Erfassungswege einen (public/
  // index.html), aber ein Formular ohne Slot soll hier nicht abstuerzen.
  const feld = G(id), sel = G(`${id}-sel`);
  if (feld) { feld.value = _ortVorgabe; feld.style.display = 'none'; }
  if (sel) sel.selectedIndex = 0;
}

/**
 * Der gewaehlte Lagerort eines Formulars — `''`, wenn keiner dasteht.
 *
 * ── Warum `''` und nicht `undefined` (Marcos Befund vom 20.10.) ─────────────
 *
 * Hier stand `wert || undefined`. Damit fiel der Schluessel aus dem Rumpf, und
 * der Server sah zwei voellig verschiedene Lagen gleich:
 *
 *   - ein Formular, in dem jemand die vorbefuellte Vorgabe weggeraeumt hat,
 *   - ein Import, der von Lagerorten ueberhaupt nichts weiss.
 *
 * Seit ortFuerNeuerfassung() (src/bestand/lagerort.ts) die Vorgabe auch
 * serverseitig einsetzt, ist das ein Unterschied: Die zweite Lage SOLL die
 * Vorgabe bekommen, die erste nicht. Ein leeres Feld sagt es deshalb
 * ausdruecklich, statt zu schweigen.
 *
 * Fuer das Anlegen selbst aendert sich nichts: normalisiereLagerort('') ist
 * weiterhin null, und bei null wird kein Ort geschrieben.
 */
export function selectedStorage(id) {
  return (G(id)?.value || '').trim();
}

/** Gewähltes Zielkonto eines Formulars — undefined, solange es keines gibt. */
export function selectedOwner(selectId) {
  const box = G(`${selectId}-box`), sel = G(selectId);
  if (!box || box.style.display === 'none' || !sel?.value) return undefined;
  return parseInt(sel.value);
}
