// ── Own scroll bar for the whole application ────────────────────────────────
//
// ── Why a file of its own ─────────────────────────────────────
//
// From the outside it only needs G() — it does the rest itself.
import { html } from './escaping.js';
import { G, setzeHtml } from './dom.js';

// An own scroll bar for the whole page, fixed at the right edge, instead of a scroll box in the catalog:
// there the bar sat in the middle of the window, and loading more measured against the box instead of the window.

/**
 * Whoever wants to show a label while dragging sets a function here.
 * @type {(() => string | null | undefined) | null}
 */
let scrollLabelFn = null;
/** @param {(() => string | null | undefined) | null} fn */
export function setScrollLabel(fn) {
  scrollLabelFn = fn;
}

function _scrollableArea() {
  const doc = document.documentElement;
  return Math.max(0, doc.scrollHeight - window.innerHeight);
}

/** Handle size and position from the scroll state — as with a real bar. */
export function drawScrollbar() {
  const bar = G('app-scrollbar'),
    thumb = G('app-scrollbar-thumb');
  if (!bar || !thumb) return;
  const rollbar = _scrollableArea();
  // If everything fits into the window, there is nothing to scroll — then no bar either.
  if (rollbar < 8) {
    bar.style.display = 'none';
    return;
  }
  bar.style.display = 'block';
  const spur = bar.clientHeight;
  const anteil = window.innerHeight / document.documentElement.scrollHeight;
  const hoehe = Math.max(32, Math.round(spur * anteil));
  const maxTop = Math.max(0, spur - hoehe);
  const fortschritt = window.scrollY / rollbar;
  thumb.style.height = hoehe + 'px';
  thumb.style.top = Math.round(maxTop * Math.min(1, Math.max(0, fortschritt))) + 'px';
}

/**
 * Create the bar element from JavaScript: app.bundle.js runs as soon as the parser reaches it, and a
 * <div> behind it in the markup did not exist yet at startup — the bar was silently missing.
 */
function _createScrollbar() {
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

export function initScrollbar() {
  const bar = _createScrollbar();
  const thumb = G('app-scrollbar-thumb'),
    label = G('app-scrollbar-label');
  if (!bar || !thumb) return;
  let ziehen = false,
    griffOffset = 0;

  // Throttled via requestAnimationFrame: a scroll event fires dozens of times per second, and
  // drawScrollbar() READS layout (scrollHeight). Unthrottled that forces a recalculation per event
  // — the page then feels sluggish, although the server answered long ago.
  let angefordert = false;
  const retrace = () => {
    if (angefordert) return;
    angefordert = true;
    requestAnimationFrame(() => {
      angefordert = false;
      drawScrollbar();
    });
  };
  window.addEventListener('scroll', retrace, { passive: true });
  window.addEventListener('resize', retrace, { passive: true });
  // The page height changes when loading more tiles without scrolling — without this observation
  // the handle would stay at its old size.
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(retrace).observe(document.body);
  }

  const rollen = (/** @type {number} */ clientY) => {
    const r = bar.getBoundingClientRect();
    const hoehe = thumb.offsetHeight;
    const maxTop = Math.max(1, r.height - hoehe);
    const oben = Math.min(maxTop, Math.max(0, clientY - r.top - griffOffset));
    window.scrollTo({ top: (oben / maxTop) * _scrollableArea() });
    if (label) {
      const text = scrollLabelFn ? scrollLabelFn() : null;
      label.textContent = text || '';
      label.style.display = text ? 'block' : 'none';
      label.style.top = oben + hoehe / 2 + 'px';
    }
  };
  const start = (/** @type {MouseEvent | TouchEvent} */ ev) => {
    const y = 'touches' in ev ? ev.touches[0].clientY : ev.clientY;
    const tr = thumb.getBoundingClientRect();
    // Tapped next to the handle: first jump there, then grab — as with an ordinary scroll bar.
    griffOffset = y >= tr.top && y <= tr.bottom ? y - tr.top : thumb.offsetHeight / 2;
    ziehen = true;
    bar.classList.add('dragging');
    rollen(y);
    ev.preventDefault();
  };
  const move = (/** @type {MouseEvent | TouchEvent} */ ev) => {
    if (!ziehen) return;
    rollen('touches' in ev ? ev.touches[0].clientY : ev.clientY);
    ev.preventDefault();
  };
  const ende = () => {
    if (!ziehen) return;
    ziehen = false;
    bar.classList.remove('dragging');
    // Remove the inline visibility again: it beats the CSS rule for .dragging, and the
    // year label stayed in every tab after letting go.
    if (label) label.style.display = '';
  };

  bar.addEventListener('mousedown', start);
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', ende);
  bar.addEventListener('touchstart', start, { passive: false });
  bar.addEventListener('touchmove', move, { passive: false });
  bar.addEventListener('touchend', ende);
  drawScrollbar();
}
