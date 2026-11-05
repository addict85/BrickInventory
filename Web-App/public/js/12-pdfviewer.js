// Der PDF-Betrachter ist eine eigene Datei: Er hängt nur an G und esc und wird über openPdfViewer() gerufen.
// Ausführlich: docs/begruendungen/public/js/12-pdfviewer.js.md#diese-110-zeilen-standen-in-js-01-core-j
import { registerActions } from './00-registry.js';
import { G, setzeHtml } from './01-dom.js';
import { tRaw } from '../i18n.js';
import { html } from './00-escapen.js';

/** @type {PdfDokument | null} */
let _pdfDoc = null;
/** @type {IntersectionObserver | null} */
let _pdfObserver = null;
/** @type {string | null} */
let _pdfCurrentUrl = null;
const _pdfRenderTasks = new Map();

// ── Zoom ─────────────────────────────────────────────────────────────────────
//
// `_pdfZoom` ist der Faktor auf die Grundgrösse, und die Grundgrösse ist
// „Seite füllt die Breite" (_pdfBaseScale). 1 ist deshalb der untere Anschlag: weiter hinaus gibt es nichts
// zu sehen, die Breite ist schon ganz da. Dieselbe Untergrenze hat der Bildzoom der App
// (ZoomableImageDialog.kt).
const PDF_ZOOM_MIN = 1;
const PDF_ZOOM_MAX = 5;
const PDF_ZOOM_SCHRITT = 1.25;   // ein Druck auf + bzw. −

// Obergrenze der Leinwand in Pixeln der Fläche. Der Riegel ist der Speicher, nicht die Grenze des Browsers
// (16384 je Seite): 16 MPixel sind rund 60 MB und reichen für jede Zoomstufe, die man lesen will.
// Ausführlich: docs/begruendungen/public/js/12-pdfviewer.js.md#pdf-leinwand-max-px
const PDF_LEINWAND_MAX_PX = 16e6;

let _pdfZoom = 1;
let _pdfBaseScale = 1;          // Faktor „Seite füllt die Breite"
let _pdfSeiteW = 0, _pdfSeiteH = 0;   // Seitengrösse bei scale 1, aus PDF.js
// Zählt jede Zoom-Änderung. Ein Render, der über eine Änderung hinweg läuft, hängt seine Leinwand sonst in
// einen Platzhalter, der inzwischen eine andere Grösse hat — die Seite wäre verzerrt. Siehe _renderPdfPage.
let _pdfZoomGen = 0;

/** @param {{ daten?: ArrayBuffer, dateiname?: string }} [opt] schon geladene Bytes (Gutschein-PDF mit
 * Einmal-Ticket: ein zweiter Abruf schlüge fehl), `url` dient dann nur dem Download.
 * @param {string} url @param {string} title */
export async function openPdfViewer(url, title, opt = {}) {
  const modal = G('pdf-viewer-modal'); if (!modal) return;
  const loading = G('pdf-viewer-loading'), pages = G('pdf-viewer-pages'), dl = G('pdf-viewer-download');
  G('pdf-viewer-title').textContent = title || 'PDF';
  const fname = opt.dateiname || decodeURIComponent((url.split('?')[0].split('/').pop() || 'anleitung.pdf'));
  dl.href = url; dl.setAttribute('download', fname);
  _pdfCurrentUrl = url;
  _pdfZoom = 1; _pdfZoomGen++; _pdfZeigeFaktor();
  if (pages) { pages.replaceChildren(); pages.scrollLeft = 0; pages.scrollTop = 0; }
  if (loading) { loading.style.display = 'flex'; setzeHtml(loading, html`${html`<div class="spin"></div><span>`}${tRaw('pdf.loading') || 'PDF wird geladen…'}${html`</span>`}`); }
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  // PDF.js wird als ESM-Modul asynchron geladen → ggf. kurz darauf warten.
  let _tries = 0;
  while (!window.pdfjsLib && _tries < 50) { await new Promise(r => setTimeout(r, 100)); _tries++; }
  const pdfjsLib = window.pdfjsLib;
  if (!pdfjsLib) {
    if (loading) setzeHtml(loading, html`<span data-stil="color:#f88;padding:20px">${tRaw('pdf.lib_missing')}</span>`);
    return;
  }
  try {
    const task = pdfjsLib.getDocument(opt.daten ? { data: new Uint8Array(opt.daten), isEvalSupported: false, enableScripting: false } : {
      url,
      disableAutoFetch: true,   // nicht die ganze Datei vorab laden
      disableStream: false,
      disableRange: false,      // Byte-Range-Requests nutzen
      rangeChunkSize: 262144,   // 256 KB
      withCredentials: true,    // Session-Cookie (same-origin) mitsenden
      // Ein PDF kommt auch von fremden Quellen: kein eval für Schriften (ab PDF.js 5 ohnehin entfallen, die
      // CSP verbietet es) und kein Skript im PDF.
      isEvalSupported: false,
      enableScripting: false
    });
    _pdfDoc = await task.promise;
    if (loading) loading.style.display = 'none';
    await _renderPdfLazy(_pdfDoc, pages);
  } catch (e) {
    if (loading) { loading.style.display = 'flex'; setzeHtml(loading, html`<span data-stil="color:#f88;padding:20px;text-align:center">${tRaw('pdf.error') || 'Fehler beim Laden'}: ${e instanceof Error ? e.message : String(e)}</span>`); }
  }
}

/** Platzhaltergrösse beim aktuellen Zoom, in CSS-Pixeln. */
function _pdfMasse() {
  return {
    w: Math.round(_pdfSeiteW * _pdfBaseScale * _pdfZoom),
    h: Math.round(_pdfSeiteH * _pdfBaseScale * _pdfZoom)
  };
}

/**
 * Einen Platzhalter auf die Zoomgrösse bringen. margin:0 auto statt nur align-items:center: Bei einer Seite
 * breiter als der Behälter läge der linke Rand sonst im Negativen und wäre nicht mehr erreichbar.
 * Ausführlich: docs/begruendungen/public/js/12-pdfviewer.js.md#pdfmassplatzhalter
 * @param {HTMLElement} ph
 */
function _pdfMassPlatzhalter(ph) {
  const m = _pdfMasse();
  ph.style.width = m.w + 'px';
  ph.style.height = m.h + 'px';
}

/** @param {PdfDokument} pdf @param {HTMLElement} container */
async function _renderPdfLazy(pdf, container) {
  const first = await pdf.getPage(1);
  const vp1 = first.getViewport({ scale: 1 });
  const containerWidth = Math.min((container.clientWidth || 800) - 28, 1000);
  _pdfSeiteW = vp1.width; _pdfSeiteH = vp1.height;
  _pdfBaseScale = containerWidth / vp1.width;

  for (let n = 1; n <= pdf.numPages; n++) {
    const ph = document.createElement('div');
    ph.className = 'pdf-page-ph';
    ph.dataset.page = String(n);
    ph.style.cssText = 'background:#fff;box-shadow:0 1px 5px rgba(0,0,0,.35);flex-shrink:0;margin:0 auto';
    _pdfMassPlatzhalter(ph);
    container.appendChild(ph);
  }

  if (_pdfObserver) _pdfObserver.disconnect();
  _pdfObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      const n = parseInt(/** @type {HTMLElement} */ (entry.target).dataset.page ?? '');
      if (entry.isIntersecting) _renderPdfPage(pdf, n, /** @type {HTMLElement} */ (entry.target));
      else _unloadPdfPage(n, /** @type {HTMLElement} */ (entry.target));
    });
  }, { root: container, rootMargin: '300px 0px' });
  _pdfBeobachteAlle(container);
}

/** Alle Platzhalter (neu) beobachten. */
/** @param {HTMLElement | null} container */
function _pdfBeobachteAlle(container) {
  const beobachter = _pdfObserver;
  if (!beobachter || !container) return;
  container.querySelectorAll('.pdf-page-ph').forEach((/** @type {Element} */ ph) => beobachter.observe(ph));
}

/** @param {PdfDokument} pdf @param {number} n @param {HTMLElement} ph */
async function _renderPdfPage(pdf, n, ph) {
  if (ph.querySelector('canvas') || ph.dataset.rendering === '1') return;
  ph.dataset.rendering = '1';
  const gen = _pdfZoomGen;
  try {
    const page = await pdf.getPage(n);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // Der Riegel wirkt auf die FLÄCHE, nicht auf eine Seitenlänge: eine querformatige Seite hat dieselbe
    // Pixelzahl wie eine hochformatige, nur anders verteilt.
    let scale = _pdfBaseScale * _pdfZoom * dpr;
    const flaeche = (_pdfSeiteW * scale) * (_pdfSeiteH * scale);
    if (flaeche > PDF_LEINWAND_MAX_PX) scale *= Math.sqrt(PDF_LEINWAND_MAX_PX / flaeche);
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
    canvas.style.cssText = 'width:100%;height:100%;display:block';
    const task = page.render({ canvasContext: canvas.getContext('2d'), viewport: vp });
    _pdfRenderTasks.set(n, task);
    await task.promise;
    _pdfRenderTasks.delete(n);
    // Zwischenzeitlich gezoomt: Diese Leinwand hat die alte Auflösung. Einmal eingehängt, bräche der neue
    // Durchlauf oben ab (Leinwand schon da), und die Seite bliebe grob bis zum nächsten Zoom.
    // Ausführlich: docs/begruendungen/public/js/12-pdfviewer.js.md#zwischenzeitlich-gezoomt-diese-leinwand
    if (gen !== _pdfZoomGen) { canvas.width = 0; canvas.height = 0; ph.dataset.rendering = '0'; return; }
    ph.replaceChildren(); ph.appendChild(canvas);
  } catch (e) { /* Render abgebrochen (Scroll) o.ä. */ }
  ph.dataset.rendering = '0';
}

/**
 * @param {number} n
 * @param {HTMLElement} ph
 */
function _unloadPdfPage(n, ph) {
  const task = _pdfRenderTasks.get(n);
  if (task) { try { task.cancel(); } catch (_) {} _pdfRenderTasks.delete(n); }
  const canvas = ph.querySelector('canvas');
  if (canvas) { canvas.width = 0; canvas.height = 0; ph.replaceChildren(); } // Speicher freigeben
  ph.dataset.rendering = '0';
}

/**
 * Zoom setzen und dabei einen Punkt stehen lassen.
 *
 * @param {number} neu Gewünschter Faktor; wird auf [MIN, MAX] begrenzt.
 * @param {number|null} ankerX Punkt im Sichtfeld, der stehen bleiben soll, in
 *        CSS-Pixeln ab linker Behälterkante. null = Mitte des Sichtfelds.
 * @param {number|null} ankerY wie ankerX, senkrecht.
 *
 * Ohne Anker springt die Anzeige beim Zoomen auf eine andere Seite: wer bei
 * Seite 12 hineinzoomt, landet bei Seite 40, weil derselbe scrollTop in einem
 * viermal so hohen Dokument viermal weniger weit kommt.
 */
function _pdfSetzeZoom(neu, ankerX, ankerY) {
  const container = G('pdf-viewer-pages'); if (!container) return;
  const alt = _pdfZoom;
  const ziel = Math.min(PDF_ZOOM_MAX, Math.max(PDF_ZOOM_MIN, neu));
  if (Math.abs(ziel - alt) < 1e-4) return;

  const ax = (ankerX == null) ? container.clientWidth / 2 : ankerX;
  const ay = (ankerY == null) ? container.clientHeight / 2 : ankerY;
  // Lage des Ankers im Dokument, in Einheiten von Zoom 1.
  const dokX = (container.scrollLeft + ax) / alt;
  const dokY = (container.scrollTop + ay) / alt;

  _pdfZoom = ziel;
  _pdfZoomGen++;

  // Erst alle Leinwände weg, dann die Platzhalter neu bemessen: eine Leinwand mit width:100% würde sonst kurz
  // verzerrt dastehen.
  /** @type {NodeListOf<HTMLElement>} */ (container.querySelectorAll('.pdf-page-ph')).forEach(ph => {
    _unloadPdfPage(parseInt(ph.dataset.page ?? ''), ph);
    _pdfMassPlatzhalter(ph);
  });

  container.scrollLeft = dokX * ziel - ax;
  container.scrollTop = dokY * ziel - ay;

  // Der Beobachter meldet sich NICHT von selbst, wenn ein beobachtetes Element nur die Grösse ändert und
  // weiter sichtbar bleibt — die sichtbaren Seiten blieben leer. observe() liefert aber immer einen ersten
  // Rückruf, also neu anmelden. (disconnect() davor, sonst doppelte Anmeldung.)
  if (_pdfObserver) { _pdfObserver.disconnect(); _pdfBeobachteAlle(container); }
  _pdfZeigeFaktor();
}

/** Den Faktor als Prozentzahl anzeigen — nicht als Farbe oder Balken. */
function _pdfZeigeFaktor() {
  const el = G('pdf-viewer-zoom');
  if (el) el.textContent = Math.round(_pdfZoom * 100) + '%';
  const minus = G('pdf-viewer-zoom-out'), plus = G('pdf-viewer-zoom-in');
  // Am Anschlag abschalten. `disabled` ist für Screenreader und Tastatur verbindlich; die Ausgrauung ist nur
  // die Begleitung davon, nicht das Signal.
  if (minus) minus.disabled = _pdfZoom <= PDF_ZOOM_MIN + 1e-4;
  if (plus) plus.disabled = _pdfZoom >= PDF_ZOOM_MAX - 1e-4;
}

function pdfZoomIn() { _pdfSetzeZoom(_pdfZoom * PDF_ZOOM_SCHRITT, null, null); }
function pdfZoomOut() { _pdfSetzeZoom(_pdfZoom / PDF_ZOOM_SCHRITT, null, null); }
function pdfZoomReset() { _pdfSetzeZoom(1, null, null); }

/**
 * Strg/⌘ + Rad zoomt das PDF statt der ganzen Oberfläche; ohne Zusatztaste rollt das Rad weiter, weil man
 * durch Anleitungen vor allem blättert. Der Zeiger ist der Anker.
 * Ausführlich: docs/begruendungen/public/js/12-pdfviewer.js.md#pdfrad
 */
/** @param {WheelEvent} ev */
function _pdfRad(ev) {
  if (!ev.ctrlKey && !ev.metaKey) return;
  ev.preventDefault();
  const container = G('pdf-viewer-pages'); if (!container) return;
  const r = container.getBoundingClientRect();
  // deltaY ist je nach Gerät Pixel, Zeilen oder Seiten — nur das Vorzeichen ist überall verlässlich, der
  // Betrag nicht. Deshalb ein fester Schritt.
  const f = ev.deltaY < 0 ? PDF_ZOOM_SCHRITT : 1 / PDF_ZOOM_SCHRITT;
  _pdfSetzeZoom(_pdfZoom * f, ev.clientX - r.left, ev.clientY - r.top);
}

/** Tastatur: + / − / 0, solange das PDF-Fenster offen ist. */
/** @param {KeyboardEvent} ev */
function _pdfTaste(ev) {
  const modal = G('pdf-viewer-modal');
  if (!modal || modal.style.display !== 'flex') return;
  // In einem Eingabefeld hat + eine andere Bedeutung.
  const a = /** @type {HTMLElement | null} */ (document.activeElement);
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) return;
  if (ev.key === '+' || ev.key === '=') { ev.preventDefault(); pdfZoomIn(); }
  else if (ev.key === '-' || ev.key === '_') { ev.preventDefault(); pdfZoomOut(); }
  else if (ev.key === '0') { ev.preventDefault(); pdfZoomReset(); }
}

// ── Zwei-Finger-Geste ────────────────────────────────────────────────────────
//
// Der Browser kann selbst zoomen (die Seite hat kein user-scalable=no), aber er zoomt das Sichtfeld:
// Kopfzeile und Knöpfe werden mitgross, und das Bild wird weich, weil die Leinwand dieselbe bleibt. Hier wird
// stattdessen die SEITE gezoomt und neu gerendert, deshalb fängt der Betrachter die Geste ab.
let _pdfPinchAbstand = 0, _pdfPinchZoom = 1;

/** @param {Touch} t1 @param {Touch} t2 */
function _pdfAbstand(t1, t2) {
  const dx = t1.clientX - t2.clientX, dy = t1.clientY - t2.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

/** @param {TouchEvent} ev */
function _pdfTouchStart(ev) {
  if (ev.touches.length !== 2) { _pdfPinchAbstand = 0; return; }
  _pdfPinchAbstand = _pdfAbstand(ev.touches[0], ev.touches[1]);
  _pdfPinchZoom = _pdfZoom;
}

/** @param {TouchEvent} ev */
function _pdfTouchMove(ev) {
  if (ev.touches.length !== 2 || !_pdfPinchAbstand) return;
  ev.preventDefault();
  const container = G('pdf-viewer-pages'); if (!container) return;
  const r = container.getBoundingClientRect();
  const jetzt = _pdfAbstand(ev.touches[0], ev.touches[1]);
  // Anker ist die Mitte zwischen den Fingern — der Punkt, den beide umfassen.
  const mx = (ev.touches[0].clientX + ev.touches[1].clientX) / 2 - r.left;
  const my = (ev.touches[0].clientY + ev.touches[1].clientY) / 2 - r.top;
  _pdfSetzeZoom(_pdfPinchZoom * (jetzt / _pdfPinchAbstand), mx, my);
}

/** @param {TouchEvent} ev */
function _pdfTouchEnd(ev) {
  if (ev.touches.length < 2) _pdfPinchAbstand = 0;
}

/**
 * Zuhörer einmal am Behälter anmelden, nicht bei jedem openPdfViewer(): Sonst zoomte nach zehn PDFs ein
 * Raddreh zehnfach. passive:false, damit preventDefault() greift und der Browser nicht mitzoomt.
 * Ausführlich: docs/begruendungen/public/js/12-pdfviewer.js.md#pdfhaengezuhoererein
 */
function _pdfHaengeZuhoererEin() {
  const container = G('pdf-viewer-pages');
  if (!container || container.dataset.zoomBereit === '1') return;
  container.dataset.zoomBereit = '1';
  container.addEventListener('wheel', _pdfRad, { passive: false });
  container.addEventListener('touchstart', _pdfTouchStart, { passive: true });
  container.addEventListener('touchmove', _pdfTouchMove, { passive: false });
  container.addEventListener('touchend', _pdfTouchEnd, { passive: true });
  container.addEventListener('touchcancel', _pdfTouchEnd, { passive: true });
  document.addEventListener('keydown', _pdfTaste);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _pdfHaengeZuhoererEin);
  else _pdfHaengeZuhoererEin();
}

function closePdfViewer() {
  const modal = G('pdf-viewer-modal'); if (!modal) return;
  if (_pdfObserver) { _pdfObserver.disconnect(); _pdfObserver = null; }
  _pdfRenderTasks.forEach(task => { try { task.cancel(); } catch (_) {} });
  _pdfRenderTasks.clear();
  const pages = G('pdf-viewer-pages'); if (pages) pages.replaceChildren();
  if (_pdfDoc) { try { _pdfDoc.destroy(); } catch (_) {} _pdfDoc = null; }
  modal.style.display = 'none';
  document.body.style.overflow = '';
}

// Drucken: nativen Viewer in neuem Tab öffnen (druckt zuverlässig alle Seiten, ohne für den Druck das ganze
// PDF im Speicher rendern zu müssen).
function printPdfViewer() {
  if (_pdfCurrentUrl) { try { window.open(_pdfCurrentUrl, '_blank'); } catch (_) {} }
}

// Die Knöpfe im PDF-Fenster melden sich hier an: Der Handler gehört zu dem Modul, das ihn umsetzt.
registerActions({ closePdfViewer, printPdfViewer, pdfZoomIn, pdfZoomOut, pdfZoomReset });
