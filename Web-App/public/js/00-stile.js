// ── Stile ohne 'unsafe-inline' ───────────────────────────────────────────────
//
// Die CSP erlaubt keine style-Attribute im Markup: Eine eingeschleuste
// Auszeichnung soll die Seite nicht umgestalten können (falsches Formular über
// dem echten). Das Markup trägt den Stil deshalb als data-stil, und diese Datei
// setzt ihn per CSSOM — aber nur Werte, die so im Quelltext stehen. Die Liste
// baut scripts/build-frontend.js; was nicht darauf steht, bleibt wirkungslos.

/* global __ERLAUBTE_STILE__ */
const ERLAUBT = new Set(typeof __ERLAUBTE_STILE__ === 'undefined' ? [] : __ERLAUBTE_STILE__);

// Werte, die erst zur Laufzeit feststehen, kommen über eigene Attribute mit
// fester Form: eine Farbe, eine Zahl. Mehr als diese eine Eigenschaft können
// sie nicht setzen.
const FARBE = /^(#[0-9A-Fa-f]{6}|var\(--[a-z0-9-]+\))$/;
const ZAHL = /^\d{1,5}(\.\d{1,3})?$/;
const FREI = [
  ['data-farbe', (el, v) => { if (FARBE.test(v)) el.style.background = v; }],
  ['data-breite', (el, v) => { if (ZAHL.test(v)) el.style.width = Math.min(100, Number(v)) + '%'; }],
  ['data-breite-px', (el, v) => { if (ZAHL.test(v)) el.style.width = v + 'px'; }],
  ['data-hoehe-px', (el, v) => { if (ZAHL.test(v)) el.style.height = v + 'px'; }],
  ['data-faecher', (el, v) => { if (/^\d{1,2}$/.test(v)) el.style.setProperty('--faecher-ton', `var(--faecher-${v})`); }],
];
const AUSWAHL = '[data-stil],' + FREI.map(([a]) => `[${a}]`).join(',');

/** Alle data-stil und Laufzeitwerte unter `wurzel` (einschliesslich) anwenden. */
export function wendeStileAn(wurzel) {
  if (!wurzel || typeof wurzel.querySelectorAll !== 'function') return;
  const els = [...wurzel.querySelectorAll(AUSWAHL)];
  if (wurzel.matches?.(AUSWAHL)) els.unshift(wurzel);
  for (const el of els) {
    const stil = el.getAttribute('data-stil');
    if (stil !== null) {
      if (ERLAUBT.has(stil)) el.style.cssText = stil;
      else console.warn('[stile] nicht freigegeben:', stil);
      el.removeAttribute('data-stil');
    }
    for (const [attr, setze] of FREI) {
      const v = el.getAttribute(attr);
      if (v !== null) { setze(el, v); el.removeAttribute(attr); }
    }
  }
}

// innerHTML & Co. umhüllen, damit der Stil im selben Schritt sitzt wie das
// Markup: Code, der gleich danach el.style.display umschaltet, findet den
// Ausgangswert vor und wird nicht nachträglich überschrieben.
function umhuelle(proto, name, nachher) {
  const d = Object.getOwnPropertyDescriptor(proto, name);
  if (!d) return;
  if (d.set) {
    Object.defineProperty(proto, name, { ...d, set(v) { const p = this.parentNode; d.set.call(this, v); nachher(this, p); } });
  } else if (typeof d.value === 'function') {
    const f = d.value;
    Object.defineProperty(proto, name, { ...d, value(...a) { const p = this.parentNode; const r = f.apply(this, a); nachher(this, p, a[0]); return r; } });
  }
}
if (typeof Element !== 'undefined') {
  umhuelle(Element.prototype, 'innerHTML', (el) => wendeStileAn(el));
  // outerHTML ersetzt das Element selbst; die neuen Knoten hängen am Elternteil.
  umhuelle(Element.prototype, 'outerHTML', (_el, p) => wendeStileAn(p));
  umhuelle(Element.prototype, 'insertAdjacentHTML', (el, p, wo) =>
    wendeStileAn(/^(beforebegin|afterend)$/i.test(String(wo)) ? p : el));
  if (typeof document !== 'undefined') wendeStileAn(document.documentElement);
}
