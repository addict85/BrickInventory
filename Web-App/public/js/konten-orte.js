// Konto- und Lagerortfelder: Haushaltsmitglieder, Kontofilter und die Lagerortfelder der Erfassungswege. Eine
// gemeinsame Quelle, damit alle Formulare dieselbe Liste zeigen.
import { api } from './api.js';
import { G, setzeHtml } from './dom.js';
import { SCOPE_VIEWS, scopeMode, setScopeMode } from './scope.js';
import { ladeLagerorte, lagerortBlock } from './detailfelder.js';
import { tRaw } from '../i18n.js';
import { html, ungeprueft } from './escapen.js';
import { abonniere } from './ereignisse.js';
/** @typedef {import('../../frontend-typen/vertrag').HouseholdMember} HouseholdMember */

/**
 * Kontofilter je Ansicht sichtbar machen und mit dem gespeicherten Wert füllen.
 *
 * Bleibt verborgen, solange das Konto keine Unterkonten hat: Ein Filter mit genau einer möglichen Antwort ist
 * keine Wahl, sondern eine Frage, die sich nicht stellt.
 * @param {HouseholdMember[]} members
 */
export function initScopeSelects(members) {
  const isMain = members.length > 1;
  // Alle, Eigene, dann jedes Unterkonto namentlich. „Unterkonten“ als Sammelposten fügte nichts hinzu; der
  // Server versteht accounts=subs weiter für ältere Apps.
  const subs = members.filter(m => !m.is_self);
  const opts = [
    html`<option value="all">${tRaw('household.scope_all')}</option>`,
    html`<option value="own">${tRaw('household.scope_own')}</option>`,
    ...subs.map(m => html`<option value="${m.id}">${m.username}</option>`),
  ].join('');

  for (const view of SCOPE_VIEWS) {
    const el = G('scope-' + view);
    if (!el) continue;
    if (!isMain) {
      el.style.display = 'none';
      continue;
    }
    setzeHtml(el, ungeprueft(opts));
    // Gespeicherte Wahl kann auf ein inzwischen entkoppeltes Konto zeigen — dann auf „Alle" zurückfallen
    // statt eine leere Auswahl zu zeigen.
    const saved = scopeMode(view);
    el.value = [...el.options].some(o => o.value === saved) ? saved : 'all';
    if (el.value !== saved) setScopeMode(view, el.value);
    el.style.display = '';
  }

  // Der Schalter „Unterkonten einbeziehen“ der Teileliste folgt derselben Regel: ohne Unterkonten nicht zu
  // sehen. Er steht hier, weil isMain hier aus derselben Antwort feststeht.
  const subsBox = G('pl-bestand-subs-box');
  if (subsBox) {
    subsBox.style.display = isMain ? 'inline-flex' : 'none';
    // Kein Haken, wenn es nichts einzubeziehen gibt: Sonst bliebe die Wahl beim Entkoppeln des letzten
    // Unterkontos unsichtbar gesetzt stehen und wirkte weiter.
    if (!isMain) {
      const cb = G('pl-bestand-subs');
      if (cb) cb.checked = false;
    }
  }
}

/**
 * Die Konten des Haushalts, wie sie zuletzt geladen wurden.
 *
 * Gemerkt, weil nicht jede Auswahl in index.html steht: Das Detail der Merkliste baut seine Zeilen beim
 * Oeffnen und braucht die Liste dann — lange nach loadHouseholdMembers(). Ein zweiter Abruf waere ein zweiter
 * Stand derselben Antwort.
 * @type {HouseholdMember[]}
 */
let _haushalt = [];

/** Die gemerkten Konten. Leer, solange noch keine Antwort da war. */
export function haushaltsKonten() {
  return _haushalt;
}

/**
 * Kontoauswahl beim Erfassen, nur im Haushalt: Bei einem Konto ohne Verknüpfung liefert der Server genau
 * einen Eintrag, und eine Auswahl mit einer Möglichkeit bleibt verborgen.
 */
export async function loadHouseholdMembers() {
  const d = await api('GET', '/v1/sets/household-members').catch(() => null);
  const members = d?.members || [];
  _haushalt = members;
  // Dieselbe Antwort entscheidet über den Kontofilter: mehr als ein Konto heisst Hauptkonto mit Unterkonten.
  initScopeSelects(members);
  // Die Lagerorte in EINEM Zug: Sie fuellen die Auswahlfelder der Filter UND die gemeinsame <datalist> der
  // Eingabefelder. Zwei Aufrufe waeren zwei Staende derselben Liste.
  ladeLagerorte(members.map(m => m.id)).catch(() => {});
  // Die Vorgabe fuer die Erfassungsfelder (Marcos Stern) — eigener Abruf, Begruendung bei
  // ladeLagerortVorgabe().
  ladeLagerortVorgabe().catch(() => {});
  zeichneKontoauswahl(members);
  zeichneLagerortFelder();
}

/**
 * Alle fünf Erfassungswege (Set, Teil, Figur, Katalog, Merkliste) bekommen dieselbe Kontoauswahl: Etwas für
 * ein Kind zu erfassen soll überall gleich gehen. Eine getroffene Wahl bleibt beim Neuzeichnen.
 * @param {HouseholdMember[]} members
 */
function zeichneKontoauswahl(members) {
  const markup = members
    .map(
      m =>
        html`<option value="${m.id}"${m.is_self ? ' selected' : ''}>${m.username}${m.is_self ? html`${' '}${tRaw('household.ich')}` : ''}</option>`,
    )
    .join('');
  for (const id of ['add-owner', 'ap-owner', 'af-owner', 'cat-m-owner', 'mk-owner']) {
    const box = G(`${id}-box`),
      sel = G(id);
    if (!box || !sel) continue;
    if (members.length < 2) {
      box.style.display = 'none';
      continue;
    }
    const vorher = sel.value;
    setzeHtml(sel, ungeprueft(markup));
    if (vorher && [...sel.querySelectorAll('option')].some(o => o.value === vorher)) sel.value = vorher;
    box.style.display = '';
  }
}

// Erzeugte Auswahlfelder tragen Texte der Sprache, in der sie gebaut wurden; beim Wechsel neu zeichnen, die
// Wahl bleibt. Die Lagerorte zieht ladeLagerorte() samt Vorrat und Filtern nach.
abonniere('spracheGewechselt', () => {
  if (!_haushalt.length) return;
  initScopeSelects(_haushalt);
  zeichneKontoauswahl(_haushalt);
  ladeLagerorte().catch(() => {});
});

/**
 * Die Lagerortfelder der fünf Erfassungswege, einmal aus lagerortBlock() gezeichnet statt fünfmal im HTML.
 * Zusammen mit der Kontoauswahl, weil beide warten, bis der Haushalt geladen ist.
 */
export const ERFASSUNGS_ORTFELDER = ['add-storage', 'ap-storage', 'af-storage', 'cat-m-storage', 'mk-take-storage'];

/**
 * Der Lagerort, der beim Erfassen schon dastehen soll — Marcos Stern.
 *
 * „Weiter möchte ich ein Lagerort in den Einstellungen als Default setzen
 *  können. Der soll dann bei einer Neuerfassung bereits vorausgewählt sein."
 *
 * Leer heisst: keine Vorgabe, die Felder stehen auf „—" wie bisher.
 */
let _ortVorgabe = '';

/**
 * Ein Lagerortfeld eines Erfassungswegs neu zeichnen.
 * @param {string} id
 * @param {string} wert
 */
function zeichneOrtFeld(id, wert) {
  const slot = G(`${id}-slot`);
  if (!slot) return;
  setzeHtml(slot, lagerortBlock(id, wert));
  // Die sichtbare Beschriftung steht im HTML, die beiden Bedienelemente entstehen hier — ein `for=` darauf
  // waere im Quelltext ein Verweis ins Leere (test/a11y.test.js meldet genau das, zu Recht). aria-labelledby
  // stellt die Verbindung zur Laufzeit her, und zwar fuer BEIDE: Auswahl und Textfeld tragen denselben Namen,
  // weil sie dasselbe Feld sind.
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
 * Die Vorgabe steht beim Vorrat (/v1/storage/locations), nicht bei den belegten Orten. Nachgezogen wird nur
 * ein noch leeres Feld: Wer inzwischen selbst gewählt hat, behält seine Wahl.
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
 * Den Anfangszustand herstellen: Ein Ort von vorhin sähe wie eine Vorgabe aus. Gibt es eine Vorgabe, steht
 * sie da; gezeichnet statt gesetzt, damit Auswahl und Textfeld dasselbe sagen.
 * @param {string} id
 */
export function leereLagerortFeld(id) {
  if (G(`${id}-slot`)) {
    zeichneOrtFeld(id, _ortVorgabe);
    return;
  }
  // Ohne Slot gibt es das zusammengesetzte Feld nicht; dann bleibt es beim alten Weg. Heute hat jeder der
  // fuenf Erfassungswege einen (public/ index.html), aber ein Formular ohne Slot soll hier nicht abstuerzen.
  const feld = G(id),
    sel = G(`${id}-sel`);
  if (feld) {
    feld.value = _ortVorgabe;
    feld.style.display = 'none';
  }
  if (sel) sel.selectedIndex = 0;
}

/**
 * Der gewählte Lagerort, `''` wenn keiner dasteht — nie undefined: Ein geleertes Feld heisst „kein Ort“, ein
 * fehlender Schlüssel „Vorgabe nehmen“, und der Server setzt die Vorgabe nur im zweiten Fall ein.
 * @param {string} id
 */
export function selectedStorage(id) {
  return (G(id)?.value || '').trim();
}

/**
 * Gewähltes Zielkonto eines Formulars — undefined, solange es keines gibt.
 * @param {string} selectId
 */
export function selectedOwner(selectId) {
  const box = G(`${selectId}-box`),
    sel = G(selectId);
  if (!box || box.style.display === 'none' || !sel?.value) return undefined;
  return parseInt(sel.value, 10);
}
