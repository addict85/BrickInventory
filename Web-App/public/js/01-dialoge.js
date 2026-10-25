// ═══ Tastaturbedienung aller Dialoge ════════════════════════════════════════
//
// Für jedes `.ovl[role=dialog]` an EINER Stelle: Escape schliesst den
// obersten offenen Dialog, beim Öffnen springt der Fokus hinein, Tab bleibt
// darin, und beim Schliessen kehrt der Fokus dorthin zurück, wo er vorher war.
//
// Geschlossen wird über den Knopf mit `data-dialog-zu` — so läuft dieselbe
// Aufräumarbeit wie beim Klick auf ✕, statt sie hier nachzubauen.

const FOKUSSIERBAR = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Offen heisst: Klasse `open`, oder ein Inline-`display` ausser none (confirm, PDF). */
function istOffen(el) {
  return el.style.display ? el.style.display !== 'none' : el.classList.contains('open');
}

function dialoge() {
  return [...document.querySelectorAll('.ovl[role="dialog"]')];
}

/** Der oberste offene Dialog: höchster z-index, bei Gleichstand der spätere im Markup. */
export function obersterDialog() {
  let bester = null, bestZ = -Infinity;
  for (const el of dialoge()) {
    if (!istOffen(el)) continue;
    const z = parseInt(el.style.zIndex || getComputedStyle(el).zIndex, 10) || 0;
    if (z >= bestZ) { bester = el; bestZ = z; }
  }
  return bester;
}

function sichtbar(el) {
  if (el.disabled || el.closest('[hidden]')) return false;
  return typeof el.checkVisibility === 'function' ? el.checkVisibility() : true;
}

function fokusZiele(dialog) {
  return [...dialog.querySelectorAll(FOKUSSIERBAR)].filter(sichtbar);
}

/** Erstfokus: `[data-erstfokus]`, sonst der Dialog selbst — ein Eingabefeld öffnete auf dem Handy die Tastatur. */
function fokussiereHinein(dialog) {
  if (dialog.contains(document.activeElement)) return;
  const ziel = dialog.querySelector('[data-erstfokus]');
  if (ziel && sichtbar(ziel)) { ziel.focus(); return; }
  fokussiereFlaeche(dialog);
}

function fokussiereFlaeche(dialog) {
  const flaeche = dialog.firstElementChild || dialog;
  if (!flaeche.hasAttribute('tabindex')) flaeche.setAttribute('tabindex', '-1');
  flaeche.focus({ preventScroll: true });
}

const _vorher = new WeakMap();
const _warOffen = new WeakMap();

function zustandGeaendert(dialog) {
  const offen = istOffen(dialog);
  if (offen === _warOffen.get(dialog)) return;
  _warOffen.set(dialog, offen);
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
    if (zurueck && zurueck.isConnected && verwaist) zurueck.focus({ preventScroll: true });
  }
}

function tasteGedrueckt(ev) {
  const dialog = obersterDialog();
  if (!dialog) return;
  if (ev.key === 'Escape') {
    // Aus einem Eingabefeld zuerst nur hinaus: Wer in der Wanted-Vorschau eine
    // Zelle abbricht, soll nicht den Dialog samt allen Korrekturen verlieren.
    const aktiv = document.activeElement;
    if (aktiv && dialog.contains(aktiv) && /^(INPUT|TEXTAREA|SELECT)$/.test(aktiv.tagName)) {
      ev.preventDefault();
      aktiv.blur();
      // Auf die Fläche, nicht zum Erstfokus: Ist der ein Eingabefeld, stünde
      // man wieder darin, und Escape käme nie aus dem Dialog heraus.
      fokussiereFlaeche(dialog);
      return;
    }
    const zu = dialog.querySelector('[data-dialog-zu]');
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
  else if (ev.shiftKey && (aktiv === erstes || !ziele.includes(aktiv))) { ev.preventDefault(); letztes.focus(); }
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
