// The PDF viewer is a file of its own: it only depends on G and esc and is called via openPdfViewer().
import { registerActions } from './registry.js';
import { G, setHtml } from './dom.js';
import { tRaw } from '../i18n.js';
import { html } from './escaping.js';

/** @type {PdfDocument | null} */
let _pdfDoc = null;
/** @type {IntersectionObserver | null} */
let _pdfObserver = null;
/** @type {string | null} */
let _pdfCurrentUrl = null;
const _pdfRenderTasks = new Map();

// ── Zoom ─────────────────────────────────────────────────────────────────────
//
// `_pdfZoom` is the factor on the base size, and the base size is
// "page fills the width" (_pdfBaseScale). 1 is therefore the lower stop: further out there is nothing
// to see, the width is already fully there. The app's image zoom has the same lower limit
// (ZoomableImageDialog.kt).
const PDF_ZOOM_MIN = 1;
const PDF_ZOOM_MAX = 5;
const PDF_ZOOM_STEP = 1.25; // one press on + or −

// Upper bound of the canvas in pixels of area. The bar is memory, not the browser's limit
// (16384 per side): 16 MPixel are about 60 MB and suffice for every zoom level one wants to read.
const PDF_CANVAS_MAX_PX = 16e6;

let _pdfZoom = 1;
let _pdfBaseScale = 1; // factor "page fills the width"
let _pdfPageW = 0,
  _pdfPageH = 0; // page size at scale 1, from PDF.js
// Counts every zoom change. A render that runs across a change would otherwise hang its canvas into
// a placeholder that has a different size by now — the page would be distorted. See _renderPdfPage.
let _pdfZoomGen = 0;

/**
 * Load PDF.js (about 400 KB) only on the first PDF, not on every page view. The address stands as an inert
 * <script> in a <template> in index.html: that way it carries the server's stamp like every other asset.
 * @returns {Promise<PdfJs | undefined>}
 */
async function loadPdfjs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  const vorlage = document.getElementById('pdfjs-source');
  const source =
    vorlage instanceof HTMLTemplateElement ? vorlage.content.querySelector('script')?.getAttribute('src') : null;
  if (!source) return undefined;
  try {
    await import(source);
  } catch (e) {
    console.error('[pdf] PDF.js not loaded:', e);
  }
  return window.pdfjsLib;
}

/** @param {{ data?: ArrayBuffer, fileName?: string }} [opt] already loaded bytes (voucher PDF with
 * a one-time ticket: a second fetch would fail), `url` then only serves the download.
 * @param {string} url @param {string} title */
export async function openPdfViewer(url, title, opt = {}) {
  const modal = G('pdf-viewer-modal');
  if (!modal) return;
  const loading = G('pdf-viewer-loading'),
    pages = G('pdf-viewer-pages'),
    dl = G('pdf-viewer-download');
  G('pdf-viewer-title').textContent = title || 'PDF';
  const fname = opt.fileName || decodeURIComponent(url.split('?')[0].split('/').pop() || 'anleitung.pdf');
  dl.href = url;
  dl.setAttribute('download', fname);
  _pdfCurrentUrl = url;
  _pdfZoom = 1;
  _pdfZoomGen++;
  _pdfShowFactor();
  if (pages) {
    pages.replaceChildren();
    pages.scrollLeft = 0;
    pages.scrollTop = 0;
  }
  if (loading) {
    loading.style.display = 'flex';
    setHtml(loading, html`${html`<div class="spin"></div><span>`}${tRaw('pdf.loading')}${html`</span>`}`);
  }
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  const pdfjsLib = await loadPdfjs();
  if (!pdfjsLib) {
    if (loading) setHtml(loading, html`<span data-style="color:#f88;padding:20px">${tRaw('pdf.lib_missing')}</span>`);
    return;
  }
  try {
    const task = pdfjsLib.getDocument(
      opt.data
        ? { data: new Uint8Array(opt.data), isEvalSupported: false, enableScripting: false }
        : {
            url,
            disableAutoFetch: true, // do not load the whole file up front
            disableStream: false,
            disableRange: false, // use byte range requests
            rangeChunkSize: 262144, // 256 KB
            withCredentials: true, // send the session cookie (same-origin) along
            // A PDF also comes from foreign sources: no eval for fonts (dropped anyway from PDF.js 5, the
            // CSP forbids it) and no script in the PDF.
            isEvalSupported: false,
            enableScripting: false,
          },
    );
    _pdfDoc = await task.promise;
    if (loading) loading.style.display = 'none';
    await _renderPdfLazy(_pdfDoc, pages);
  } catch (e) {
    if (loading) {
      loading.style.display = 'flex';
      setHtml(
        loading,
        html`<span data-style="color:#f88;padding:20px;text-align:center">${tRaw('pdf.error')}: ${e instanceof Error ? e.message : String(e)}</span>`,
      );
    }
  }
}

/** Placeholder size at the current zoom, in CSS pixels. */
function _pdfMeasures() {
  return {
    w: Math.round(_pdfPageW * _pdfBaseScale * _pdfZoom),
    h: Math.round(_pdfPageH * _pdfBaseScale * _pdfZoom),
  };
}

/**
 * Bring a placeholder to the zoom size. margin:0 auto instead of just align-items:center: with a page
 * wider than the container the left edge would otherwise be negative and no longer reachable.
 * @param {HTMLElement} ph
 */
function _pdfMassPlaceholder(ph) {
  const m = _pdfMeasures();
  ph.style.width = m.w + 'px';
  ph.style.height = m.h + 'px';
}

/** @param {PdfDocument} pdf @param {HTMLElement} container */
async function _renderPdfLazy(pdf, container) {
  const first = await pdf.getPage(1);
  const vp1 = first.getViewport({ scale: 1 });
  const containerWidth = Math.min((container.clientWidth || 800) - 28, 1000);
  _pdfPageW = vp1.width;
  _pdfPageH = vp1.height;
  _pdfBaseScale = containerWidth / vp1.width;

  for (let n = 1; n <= pdf.numPages; n++) {
    const ph = document.createElement('div');
    ph.className = 'pdf-page-ph';
    ph.dataset.page = String(n);
    // The page is an image without a text layer; its name at least tells screen readers where they are.
    ph.setAttribute('role', 'img');
    ph.setAttribute('aria-label', tRaw('pdf.page_of', { n, m: pdf.numPages }));
    ph.style.cssText = 'background:var(--s200);box-shadow:0 1px 5px rgba(0,0,0,.35);flex-shrink:0;margin:0 auto';
    _pdfMassPlaceholder(ph);
    container.appendChild(ph);
  }

  if (_pdfObserver) _pdfObserver.disconnect();
  _pdfObserver = new IntersectionObserver(
    entries => {
      entries.forEach(entry => {
        const n = parseInt(/** @type {HTMLElement} */ (entry.target).dataset.page ?? '', 10);
        if (entry.isIntersecting) _renderPdfPage(pdf, n, /** @type {HTMLElement} */ (entry.target));
        else _unloadPdfPage(n, /** @type {HTMLElement} */ (entry.target));
      });
    },
    { root: container, rootMargin: '300px 0px' },
  );
  _pdfObserveAll(container);
}

/** Observe all placeholders (anew). */
/** @param {HTMLElement | null} container */
function _pdfObserveAll(container) {
  const observer = _pdfObserver;
  if (!observer || !container) return;
  container.querySelectorAll('.pdf-page-ph').forEach((/** @type {Element} */ ph) => {
    observer.observe(ph);
  });
}

/** @param {PdfDocument} pdf @param {number} n @param {HTMLElement} ph */
async function _renderPdfPage(pdf, n, ph) {
  if (ph.querySelector('canvas') || ph.dataset.rendering === '1') return;
  ph.dataset.rendering = '1';
  const gen = _pdfZoomGen;
  try {
    const page = await pdf.getPage(n);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // The bar acts on the AREA, not on a side length: a landscape page has the same
    // pixel count as a portrait one, only distributed differently.
    let scale = _pdfBaseScale * _pdfZoom * dpr;
    const surface = _pdfPageW * scale * (_pdfPageH * scale);
    if (surface > PDF_CANVAS_MAX_PX) scale *= Math.sqrt(PDF_CANVAS_MAX_PX / surface);
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    canvas.style.cssText = 'width:100%;height:100%;display:block';
    canvas.setAttribute('aria-hidden', 'true');
    // The page stays white, even if the placeholder behind it is dimmed in the dark theme.
    const task = page.render({ canvasContext: canvas.getContext('2d'), viewport: vp, background: '#fff' });
    _pdfRenderTasks.set(n, task);
    await task.promise;
    _pdfRenderTasks.delete(n);
    // Zoomed in the meantime: this canvas has the old resolution. Once hung in, the new pass
    // would abort above (canvas already there), and the page would stay coarse until the next zoom.
    if (gen !== _pdfZoomGen) {
      canvas.width = 0;
      canvas.height = 0;
      ph.dataset.rendering = '0';
      return;
    }
    ph.replaceChildren();
    ph.appendChild(canvas);
  } catch {
    /* render aborted (scroll) or similar */
  }
  ph.dataset.rendering = '0';
}

/**
 * @param {number} n
 * @param {HTMLElement} ph
 */
function _unloadPdfPage(n, ph) {
  const task = _pdfRenderTasks.get(n);
  if (task) {
    try {
      task.cancel();
    } catch (_) {}
    _pdfRenderTasks.delete(n);
  }
  const canvas = ph.querySelector('canvas');
  if (canvas) {
    canvas.width = 0;
    canvas.height = 0;
    ph.replaceChildren();
  } // release memory
  ph.dataset.rendering = '0';
}

/**
 * Set the zoom and keep one point in place.
 *
 * @param {number} newValue desired factor; clamped to [MIN, MAX].
 * @param {number|null} anchorX point in the viewport that should stay in place, in
 *        CSS pixels from the left container edge. null = center of the viewport.
 * @param {number|null} anchorY like anchorX, vertically.
 *
 * Without an anchor the display jumps to another page when zooming: whoever zooms in at
 * page 12 lands at page 40, because the same scrollTop gets four times less far in a
 * document four times as tall.
 */
function _pdfSetZoom(newValue, anchorX, anchorY) {
  const container = G('pdf-viewer-pages');
  if (!container) return;
  const alt = _pdfZoom;
  const target = Math.min(PDF_ZOOM_MAX, Math.max(PDF_ZOOM_MIN, newValue));
  if (Math.abs(target - alt) < 1e-4) return;

  const ax = anchorX == null ? container.clientWidth / 2 : anchorX;
  const ay = anchorY == null ? container.clientHeight / 2 : anchorY;
  // Position of the anchor in the document, in units of zoom 1.
  const docX = (container.scrollLeft + ax) / alt;
  const docY = (container.scrollTop + ay) / alt;

  _pdfZoom = target;
  _pdfZoomGen++;

  // First remove all canvases, then resize the placeholders: a canvas with width:100% would otherwise briefly
  // state distorted.
  /** @type {NodeListOf<HTMLElement>} */ (container.querySelectorAll('.pdf-page-ph')).forEach(ph => {
    _unloadPdfPage(parseInt(ph.dataset.page ?? '', 10), ph);
    _pdfMassPlaceholder(ph);
  });

  container.scrollLeft = docX * target - ax;
  container.scrollTop = docY * target - ay;

  // The observer does NOT report by itself when an observed element only changes size and
  // stays visible — the visible pages would stay empty. observe() however always delivers a first
  // callback, so register anew. (disconnect() before, otherwise double registration.)
  if (_pdfObserver) {
    _pdfObserver.disconnect();
    _pdfObserveAll(container);
  }
  _pdfShowFactor();
}

/** Show the factor as a percentage — not as a color or bar. */
function _pdfShowFactor() {
  const el = G('pdf-viewer-zoom');
  // The name starts with the visible number (WCAG 2.5.3): voice control hits the button with "100 %".
  if (el) {
    el.textContent = Math.round(_pdfZoom * 100) + '%';
    el.setAttribute('aria-label', tRaw('pdf.zoom_reset_n', { p: el.textContent }));
  }
  const minus = G('pdf-viewer-zoom-out'),
    plus = G('pdf-viewer-zoom-in');
  // Disable at the stop. `disabled` is binding for screen readers and keyboard; the greying out is only
  // its accompaniment, not the signal.
  if (minus) minus.disabled = _pdfZoom <= PDF_ZOOM_MIN + 1e-4;
  if (plus) plus.disabled = _pdfZoom >= PDF_ZOOM_MAX - 1e-4;
}

function pdfZoomIn() {
  _pdfSetZoom(_pdfZoom * PDF_ZOOM_STEP, null, null);
}
function pdfZoomOut() {
  _pdfSetZoom(_pdfZoom / PDF_ZOOM_STEP, null, null);
}
function pdfZoomReset() {
  _pdfSetZoom(1, null, null);
}

/**
 * Ctrl/⌘ + wheel zooms the PDF instead of the whole UI; without a modifier key the wheel keeps scrolling, because one
 * mostly pages through instructions. The pointer is the anchor.
 */
/** @param {WheelEvent} ev */
function _pdfRad(ev) {
  if (!ev.ctrlKey && !ev.metaKey) return;
  ev.preventDefault();
  const container = G('pdf-viewer-pages');
  if (!container) return;
  const r = container.getBoundingClientRect();
  // Depending on the device deltaY is pixels, lines or pages — only the sign is reliable everywhere, the
  // magnitude is not. Hence a fixed step.
  const f = ev.deltaY < 0 ? PDF_ZOOM_STEP : 1 / PDF_ZOOM_STEP;
  _pdfSetZoom(_pdfZoom * f, ev.clientX - r.left, ev.clientY - r.top);
}

/** Keyboard: + / − / 0, while the PDF window is open. */
/** @param {KeyboardEvent} ev */
function _pdfKey(ev) {
  const modal = G('pdf-viewer-modal');
  if (modal?.style.display !== 'flex') return;
  // In an input field + has a different meaning.
  const a = /** @type {HTMLElement | null} */ (document.activeElement);
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) return;
  if (ev.key === '+' || ev.key === '=') {
    ev.preventDefault();
    pdfZoomIn();
  } else if (ev.key === '-' || ev.key === '_') {
    ev.preventDefault();
    pdfZoomOut();
  } else if (ev.key === '0') {
    ev.preventDefault();
    pdfZoomReset();
  }
}

// ── Two-finger gesture ──────────────────────────────────────────────────────
//
// The browser can zoom by itself (the page has no user-scalable=no), but it zooms the viewport:
// header and buttons grow along, and the image becomes soft because the canvas stays the same. Here
// the PAGE is zoomed and re-rendered instead, which is why the viewer intercepts the gesture.
let _pdfPinchGap = 0,
  _pdfPinchZoom = 1;

/** @param {Touch} t1 @param {Touch} t2 */
function _pdfGap(t1, t2) {
  const dx = t1.clientX - t2.clientX,
    dy = t1.clientY - t2.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

/** @param {TouchEvent} ev */
function _pdfTouchStart(ev) {
  if (ev.touches.length !== 2) {
    _pdfPinchGap = 0;
    return;
  }
  _pdfPinchGap = _pdfGap(ev.touches[0], ev.touches[1]);
  _pdfPinchZoom = _pdfZoom;
}

/** @param {TouchEvent} ev */
function _pdfTouchMove(ev) {
  if (ev.touches.length !== 2 || !_pdfPinchGap) return;
  ev.preventDefault();
  const container = G('pdf-viewer-pages');
  if (!container) return;
  const r = container.getBoundingClientRect();
  const now = _pdfGap(ev.touches[0], ev.touches[1]);
  // The anchor is the middle between the fingers — the point both enclose.
  const mx = (ev.touches[0].clientX + ev.touches[1].clientX) / 2 - r.left;
  const my = (ev.touches[0].clientY + ev.touches[1].clientY) / 2 - r.top;
  _pdfSetZoom(_pdfPinchZoom * (now / _pdfPinchGap), mx, my);
}

/** @param {TouchEvent} ev */
function _pdfTouchEnd(ev) {
  if (ev.touches.length < 2) _pdfPinchGap = 0;
}

/**
 * Register listeners on the container once, not on every openPdfViewer(): otherwise after ten PDFs one
 * wheel turn would zoom tenfold. passive:false, so that preventDefault() applies and the browser does not zoom along.
 */
function _pdfAttachListenerOne() {
  const container = G('pdf-viewer-pages');
  if (!container || container.dataset.zoomReady === '1') return;
  container.dataset.zoomReady = '1';
  container.addEventListener('wheel', _pdfRad, { passive: false });
  container.addEventListener('touchstart', _pdfTouchStart, { passive: true });
  container.addEventListener('touchmove', _pdfTouchMove, { passive: false });
  container.addEventListener('touchend', _pdfTouchEnd, { passive: true });
  container.addEventListener('touchcancel', _pdfTouchEnd, { passive: true });
  document.addEventListener('keydown', _pdfKey);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _pdfAttachListenerOne);
  else _pdfAttachListenerOne();
}

function closePdfViewer() {
  const modal = G('pdf-viewer-modal');
  if (!modal) return;
  if (_pdfObserver) {
    _pdfObserver.disconnect();
    _pdfObserver = null;
  }
  _pdfRenderTasks.forEach(task => {
    try {
      task.cancel();
    } catch (_) {}
  });
  _pdfRenderTasks.clear();
  const pages = G('pdf-viewer-pages');
  if (pages) pages.replaceChildren();
  if (_pdfDoc) {
    try {
      _pdfDoc.destroy();
    } catch (_) {}
    _pdfDoc = null;
  }
  modal.style.display = 'none';
  document.body.style.overflow = '';
}

// Printing: open the native viewer in a new tab (prints all pages reliably, without having to render the whole
// PDF in memory for printing).
function printPdfViewer() {
  if (_pdfCurrentUrl) {
    try {
      window.open(_pdfCurrentUrl, '_blank');
    } catch (_) {}
  }
}

// The buttons in the PDF window register here: the handler belongs to the module that implements it.
registerActions({ closePdfViewer, printPdfViewer, pdfZoomIn, pdfZoomOut, pdfZoomReset });
