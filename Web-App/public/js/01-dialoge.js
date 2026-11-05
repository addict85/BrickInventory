// Tastaturbedienung aller Dialoge an einer Stelle: Escape, Fokus hinein, Tab bleibt drin, Fokus
// zurück. Geschlossen wird über den Knopf data-dialog-zu, damit dieselbe Aufräumarbeit läuft wie beim
// Klick auf ✕.
// Ausführlich: docs/begruendungen/public/js/01-dialoge.js.md#fuer-jedes-ovl-role-dialog-an-einer-stel

// `summary` gehört dazu: Fehlt es, springt die Falle vor „Weitere Aktionen“
// zurück an den Anfang, und alles dahinter ist per Tastatur unerreichbar.
const FOKUSSIERBAR = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"])';

/**
 * Offen heisst: Klasse `open`, oder ein Inline-`display` ausser none (confirm, PDF).
 * @param {HTMLElement} el
 */
export function istOffen(el) {
  return el.style.display ? el.style.display !== 'none' : el.classList.contains('open');
}

function dialoge() {
  return /** @type {HTMLElement[]} */ ([...document.querySelectorAll('.ovl[role="dialog"]')]);
}

/** Der oberste offene Dialog: höchster z-index, bei Gleichstand der spätere im Markup. */
export function obersterDialog() {
  /** @type {HTMLElement | null} */
  let bester = null;
  let bestZ = -Infinity;
  for (const el of dialoge()) {
    if (!istOffen(el)) continue;
    const z = parseInt(el.style.zIndex || getComputedStyle(el).zIndex, 10) || 0;
    if (z >= bestZ) { bester = el; bestZ = z; }
  }
  return bester;
}

/** @param {HTMLElement & { disabled?: boolean }} el */
function sichtbar(el) {
  if (el.disabled || el.closest('[hidden]')) return false;
  return typeof el.checkVisibility === 'function' ? el.checkVisibility() : true;
}

/** @param {HTMLElement} dialog */
function fokusZiele(dialog) {
  return /** @type {HTMLElement[]} */ ([...dialog.querySelectorAll(FOKUSSIERBAR)]).filter(sichtbar);
}

/**
 * Erstfokus: `[data-erstfokus]`, sonst der Dialog selbst — ein Eingabefeld öffnete auf dem Handy die Tastatur.
 * @param {HTMLElement} dialog
 */
function fokussiereHinein(dialog) {
  if (dialog.contains(document.activeElement)) return;
  const ziel = /** @type {HTMLElement | null} */ (dialog.querySelector('[data-erstfokus]'));
  if (ziel && sichtbar(ziel)) { ziel.focus(); return; }
  fokussiereFlaeche(dialog);
}

/** @param {HTMLElement} dialog */
function fokussiereFlaeche(dialog) {
  const flaeche = /** @type {HTMLElement} */ (dialog.firstElementChild || dialog);
  if (!flaeche.hasAttribute('tabindex')) flaeche.setAttribute('tabindex', '-1');
  flaeche.focus({ preventScroll: true });
}

const _vorher = new WeakMap();
const _warOffen = new WeakMap();
/** @type {((dialog: HTMLElement, offen: boolean) => void)[]} */
const _hoerer = [];

/**
 * Rückruf für jedes Öffnen und Schliessen (der Router führt damit den Verlauf).
 * @param {(dialog: HTMLElement, offen: boolean) => void} fn
 */
export function beiDialogWechsel(fn) { _hoerer.push(fn); }

/** @param {HTMLElement} dialog */
function zustandGeaendert(dialog) {
  const offen = istOffen(dialog);
  if (offen === _warOffen.get(dialog)) return;
  _warOffen.set(dialog, offen);
  for (const h of _hoerer) h(dialog, offen);
  if (offen) {
    const aktiv = document.activeElement;
    if (aktiv && aktiv !== document.body && !dialog.contains(aktiv)) _vorher.set(dialog, aktiv);
    fokussiereHinein(dialog);
  } else {
    const zurueck = _vorher.get(dialog);
    _vorher.delete(dialog);
    // Nur wenn der Fokus noch im geschlossenen Dialog (oder nirgends) steht —
    // wer inzwischen woanders hingeklickt hat, wird nicht zurückgerissen.
    const aktiv = document.activeElement;
    const verwaist = !aktiv || aktiv === document.body || dialog.contains(aktiv);
    if (!verwaist) return;
    const ziel = rueckziel(zurueck);
    if (ziel) { ziel.focus({ preventScroll: true }); return; }
    const darunter = obersterDialog();
    if (darunter) { fokussiereFlaeche(darunter); return; }
    // Per Adresse geöffnet gibt es keinen Auslöser: dann die Überschrift der Ansicht statt <body>.
    const kopf = /** @type {HTMLElement|null} */ (document.querySelector('#app .tab.active h1'));
    if (kopf && sichtbar(kopf)) { if (!kopf.hasAttribute('tabindex')) kopf.tabIndex = -1; kopf.focus({ preventScroll: true }); }
  }
}

/**
 * Wohin der Fokus nach dem Schliessen zurückgeht. Lag der Auslöser in einem
 * inzwischen zugeklappten <details> („Weitere Aktionen“), ist er unsichtbar
 * und nähme keinen Fokus — dann dessen <summary>.
 * @param {HTMLElement} el
 */
function rueckziel(el) {
  if (!el?.isConnected) return null;
  if (sichtbar(el)) return el;
  const summary = /** @type {HTMLElement | null | undefined} */ (el.closest('details:not([open])')?.querySelector(':scope > summary'));
  return summary && sichtbar(summary) ? summary : null;
}

/** @param {KeyboardEvent} ev */
function tasteGedrueckt(ev) {
  const dialog = obersterDialog();
  if (!dialog) return;
  if (ev.key === 'Escape') {
    // Escape schliesst beim ersten Druck, auch aus einem Feld. Ausnahme sind
    // Felder in einer Tabelle (Korrekturen der Wanted-Vorschau): Dort verlässt
    // es nur die Zelle, damit nicht alle Korrekturen mit dem Dialog verschwinden.
    const aktiv = /** @type {HTMLElement | null} */ (document.activeElement);
    if (aktiv && dialog.contains(aktiv) && /^(INPUT|TEXTAREA|SELECT)$/.test(aktiv.tagName) && aktiv.closest('table')) {
      ev.preventDefault();
      aktiv.blur();
      // Auf die Fläche, nicht zum Erstfokus: Ist der ein Eingabefeld, stünde
      // man wieder darin, und Escape käme nie aus dem Dialog heraus.
      fokussiereFlaeche(dialog);
      return;
    }
    const zu = /** @type {HTMLElement | null} */ (dialog.querySelector('[data-dialog-zu]'));
    if (!zu) return;
    ev.preventDefault();
    ev.stopPropagation();
    zu.click();
    return;
  }
  if (ev.key !== 'Tab') return;
  const ziele = fokusZiele(dialog);
  if (!ziele.length) { ev.preventDefault(); return; }
  const erstes = ziele[0], letztes = ziele[ziele.length - 1];
  const aktiv = document.activeElement;
  if (!dialog.contains(aktiv)) { ev.preventDefault(); erstes.focus(); }
  else if (ev.shiftKey && (aktiv === erstes || !ziele.includes(/** @type {HTMLElement} */ (aktiv)))) { ev.preventDefault(); letztes.focus(); }
  else if (!ev.shiftKey && aktiv === letztes) { ev.preventDefault(); erstes.focus(); }
}

export function initDialoge() {
  const beobachter = new MutationObserver(eintraege => {
    for (const e of eintraege) zustandGeaendert(/** @type {HTMLElement} */ (e.target));
  });
  for (const el of dialoge()) {
    _warOffen.set(el, istOffen(el));
    beobachter.observe(el, { attributes: true, attributeFilter: ['class', 'style'] });
  }
  // Capture: vor den Escape-Handlern einzelner Module (Benutzermenü u. a.).
  document.addEventListener('keydown', tasteGedrueckt, true);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initDialoge);
  else initDialoge();
}
