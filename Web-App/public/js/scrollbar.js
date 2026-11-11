// ── Eigener Scrollbalken für die ganze Anwendung ────────────────────────────
//
// ── Warum eigene Datei ───────────────────────────────────────
//
// Braucht von aussen nur G() — den Rest macht er selbst.
import { html } from './escapen.js';
import { G, setzeHtml } from './dom.js';

// Ein eigener Scrollbalken für die ganze Seite, fest am rechten Rand, statt eines Scrollkastens im Katalog:
// Dort sass der Balken mitten im Fenster, und das Nachladen mass gegen den Kasten statt gegen das Fenster.

/**
 * Wer beim Ziehen ein Etikett zeigen will, setzt hier eine Funktion.
 * @type {(() => string | null | undefined) | null}
 */
let scrollLabelFn = null;
/** @param {(() => string | null | undefined) | null} fn */
export function setScrollLabel(fn) { scrollLabelFn = fn; }

function _rollbarerBereich() {
  const doc = document.documentElement;
  return Math.max(0, doc.scrollHeight - window.innerHeight);
}

/** Griffgrösse und -lage aus dem Rollzustand — wie bei einem echten Balken. */
export function zeichneScrollbalken() {
  const bar = G('app-scrollbar'), thumb = G('app-scrollbar-thumb');
  if (!bar || !thumb) return;
  const rollbar = _rollbarerBereich();
  // Passt alles ins Fenster, gibt es nichts zu rollen — dann auch keinen Balken.
  if (rollbar < 8) { bar.style.display = 'none'; return; }
  bar.style.display = 'block';
  const spur = bar.clientHeight;
  const anteil = window.innerHeight / document.documentElement.scrollHeight;
  const hoehe = Math.max(32, Math.round(spur * anteil));
  const maxOben = Math.max(0, spur - hoehe);
  const fortschritt = window.scrollY / rollbar;
  thumb.style.height = hoehe + 'px';
  thumb.style.top = Math.round(maxOben * Math.min(1, Math.max(0, fortschritt))) + 'px';
}

/**
 * Das Balken-Element aus JavaScript erzeugen: app.bundle.js läuft, sobald der Parser es erreicht, und ein
 * <div> dahinter im Markup gab es beim Start noch nicht — der Balken fehlte still.
 */
function _erzeugeScrollbalken() {
  /** @type {HTMLElement} */
  let bar = G('app-scrollbar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'app-scrollbar';
    bar.style.display = 'none';
    setzeHtml(bar, html`<div id="app-scrollbar-thumb"></div><div id="app-scrollbar-label"></div>`);
    document.body.appendChild(bar);
  }
  return bar;
}

export function initScrollbalken() {
  const bar = _erzeugeScrollbalken();
  const thumb = G('app-scrollbar-thumb'), label = G('app-scrollbar-label');
  if (!bar || !thumb) return;
  let ziehen = false, griffOffset = 0;

  // Gedrosselt über requestAnimationFrame: Ein Scroll-Ereignis feuert dutzende Male je Sekunde, und
  // zeichneScrollbalken() LIEST Layout (scrollHeight). Ungedrosselt erzwingt das je Ereignis eine
  // Neuberechnung — die Seite fühlt sich dann zäh an, obwohl der Server längst geantwortet hat.
  let angefordert = false;
  const nachzeichnen = () => {
    if (angefordert) return;
    angefordert = true;
    requestAnimationFrame(() => { angefordert = false; zeichneScrollbalken(); });
  };
  window.addEventListener('scroll', nachzeichnen, { passive: true });
  window.addEventListener('resize', nachzeichnen, { passive: true });
  // Die Seitenhöhe ändert sich beim Nachladen von Kacheln, ohne dass gerollt wird — ohne diese Beobachtung
  // bliebe der Griff auf seiner alten Grösse.
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(nachzeichnen).observe(document.body);
  }

  const rollen = (/** @type {number} */ clientY) => {
    const r = bar.getBoundingClientRect();
    const hoehe = thumb.offsetHeight;
    const maxOben = Math.max(1, r.height - hoehe);
    const oben = Math.min(maxOben, Math.max(0, clientY - r.top - griffOffset));
    window.scrollTo({ top: (oben / maxOben) * _rollbarerBereich() });
    if (label) {
      const text = scrollLabelFn ? scrollLabelFn() : null;
      label.textContent = text || '';
      label.style.display = text ? 'block' : 'none';
      label.style.top = (oben + hoehe / 2) + 'px';
    }
  };
  const start = (/** @type {MouseEvent | TouchEvent} */ ev) => {
    const y = 'touches' in ev ? ev.touches[0].clientY : ev.clientY;
    const tr = thumb.getBoundingClientRect();
    // Neben den Griff getippt: erst dorthin springen, dann greifen — wie bei einem gewöhnlichen Scrollbalken.
    griffOffset = (y >= tr.top && y <= tr.bottom) ? y - tr.top : thumb.offsetHeight / 2;
    ziehen = true; bar.classList.add('dragging');
    rollen(y); ev.preventDefault();
  };
  const bewegen = (/** @type {MouseEvent | TouchEvent} */ ev) => {
    if (!ziehen) return;
    rollen('touches' in ev ? ev.touches[0].clientY : ev.clientY);
    ev.preventDefault();
  };
  const ende = () => {
    if (!ziehen) return;
    ziehen = false;
    bar.classList.remove('dragging');
    // Die inline gesetzte Sichtbarkeit wieder wegnehmen: Sie schlägt die CSS-Regel für .dragging, und das
    // Jahresetikett blieb nach dem Loslassen in jedem Reiter stehen.
    if (label) label.style.display = '';
  };

  bar.addEventListener('mousedown', start);
  window.addEventListener('mousemove', bewegen);
  window.addEventListener('mouseup', ende);
  bar.addEventListener('touchstart', start, { passive: false });
  bar.addEventListener('touchmove', bewegen, { passive: false });
  bar.addEventListener('touchend', ende);
  zeichneScrollbalken();
}
