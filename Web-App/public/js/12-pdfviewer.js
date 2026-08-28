// ── PDF-Viewer (PDF.js, lokal eingebunden) ────────────────────────────────────
//
// ── Warum eigene Datei (Nachtrag 130) ────────────────────────────────────────
//
// Diese 110 Zeilen standen in js/01-core.js. Deren Kopfzeile nennt als Inhalt
// „Utils, i18n-Glue, Auth & Panels, Login/Logout, CSV-Import-Fortschrittsbalken"
// — ein PDF-Betrachter ist nichts davon. Die Datei war 1479 Zeilen lang und
// hiess nach ihrer Geschichte, nicht nach ihrem Inhalt.
//
// Der Betrachter hängt an genau zwei Dingen aus dem Kern (G, esc) und wird von
// aussen über openPdfViewer() gerufen; die beiden Knöpfe meldet er selbst beim
// Dispatcher an. Damit ist er ein sauberer Schnitt.
import { registerActions } from './00-registry.js';
import { G, esc } from './01-core.js';
// t() wird für die Lade- und Fehlermeldung gebraucht. Beim Herauslösen aus
// 01-core.js in Nachtrag 130 blieb der Import zurück — dort war t() über den
// Dateikopf verfügbar. Der Fehler flog erst beim ÖFFNEN eines PDFs
// („ReferenceError: t is not defined"), also nicht beim Laden der Seite und
// damit auch nicht beim Bündeln (Nachtrag 138).
import { t } from '../i18n.js';

let _pdfDoc = null, _pdfObserver = null, _pdfCurrentUrl = null;
const _pdfRenderTasks = new Map();

export async function openPdfViewer(url, title) {
  const modal = G('pdf-viewer-modal'); if (!modal) return;
  const loading = G('pdf-viewer-loading'), pages = G('pdf-viewer-pages'), dl = G('pdf-viewer-download');
  G('pdf-viewer-title').textContent = title || 'PDF';
  const fname = decodeURIComponent((url.split('?')[0].split('/').pop() || 'anleitung.pdf'));
  dl.href = url; dl.setAttribute('download', fname);
  _pdfCurrentUrl = url;
  if (pages) pages.innerHTML = '';
  if (loading) { loading.style.display = 'flex'; loading.innerHTML = '<div class="spin"></div><span>' + (t('pdf.loading')||'PDF wird geladen…') + '</span>'; }
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  // PDF.js wird als ESM-Modul asynchron geladen → ggf. kurz darauf warten.
  let _tries = 0;
  while (!window.pdfjsLib && _tries < 50) { await new Promise(r => setTimeout(r, 100)); _tries++; }
  const pdfjsLib = window.pdfjsLib;
  if (!pdfjsLib) {
    if (loading) loading.innerHTML = '<span style="color:#f88;padding:20px">PDF.js nicht geladen</span>';
    return;
  }
  try {
    const task = pdfjsLib.getDocument({
      url,
      disableAutoFetch: true,   // nicht die ganze Datei vorab laden
      disableStream: false,
      disableRange: false,      // Byte-Range-Requests nutzen
      rangeChunkSize: 262144,   // 256 KB
      withCredentials: true     // Session-Cookie (same-origin) mitsenden
    });
    _pdfDoc = await task.promise;
    if (loading) loading.style.display = 'none';
    await _renderPdfLazy(_pdfDoc, pages);
  } catch (e) {
    if (loading) { loading.style.display = 'flex'; loading.innerHTML = '<span style="color:#f88;padding:20px;text-align:center">' + (t('pdf.error')||'Fehler beim Laden') + ': ' + esc(String(e && e.message || e)) + '</span>'; }
  }
}

async function _renderPdfLazy(pdf, container) {
  const first = await pdf.getPage(1);
  const vp1 = first.getViewport({ scale: 1 });
  const containerWidth = Math.min((container.clientWidth || 800) - 28, 1000);
  const baseScale = containerWidth / vp1.width;

  for (let n = 1; n <= pdf.numPages; n++) {
    const ph = document.createElement('div');
    ph.className = 'pdf-page-ph';
    ph.dataset.page = n;
    ph.style.cssText = `width:${Math.round(vp1.width*baseScale)}px;height:${Math.round(vp1.height*baseScale)}px;background:#fff;box-shadow:0 1px 5px rgba(0,0,0,.35);flex-shrink:0`;
    container.appendChild(ph);
  }

  if (_pdfObserver) _pdfObserver.disconnect();
  _pdfObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      const n = parseInt(entry.target.dataset.page);
      if (entry.isIntersecting) _renderPdfPage(pdf, n, entry.target, baseScale);
      else _unloadPdfPage(n, entry.target);
    });
  }, { root: container, rootMargin: '300px 0px' });
  container.querySelectorAll('.pdf-page-ph').forEach(ph => _pdfObserver.observe(ph));
}

async function _renderPdfPage(pdf, n, ph, baseScale) {
  if (ph.querySelector('canvas') || ph.dataset.rendering === '1') return;
  ph.dataset.rendering = '1';
  try {
    const page = await pdf.getPage(n);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const vp = page.getViewport({ scale: baseScale * dpr });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
    canvas.style.cssText = 'width:100%;height:100%;display:block';
    const task = page.render({ canvasContext: canvas.getContext('2d'), viewport: vp });
    _pdfRenderTasks.set(n, task);
    await task.promise;
    _pdfRenderTasks.delete(n);
    ph.innerHTML = ''; ph.appendChild(canvas);
  } catch (e) { /* Render abgebrochen (Scroll) o.ä. */ }
  ph.dataset.rendering = '0';
}

function _unloadPdfPage(n, ph) {
  const task = _pdfRenderTasks.get(n);
  if (task) { try { task.cancel(); } catch (_) {} _pdfRenderTasks.delete(n); }
  const canvas = ph.querySelector('canvas');
  if (canvas) { canvas.width = 0; canvas.height = 0; ph.innerHTML = ''; } // Speicher freigeben
  ph.dataset.rendering = '0';
}

function closePdfViewer() {
  const modal = G('pdf-viewer-modal'); if (!modal) return;
  if (_pdfObserver) { _pdfObserver.disconnect(); _pdfObserver = null; }
  _pdfRenderTasks.forEach(task => { try { task.cancel(); } catch (_) {} });
  _pdfRenderTasks.clear();
  const pages = G('pdf-viewer-pages'); if (pages) pages.innerHTML = '';
  if (_pdfDoc) { try { _pdfDoc.destroy(); } catch (_) {} _pdfDoc = null; }
  modal.style.display = 'none';
  document.body.style.overflow = '';
}

// Drucken: nativen Viewer in neuem Tab öffnen (druckt zuverlässig alle Seiten,
// ohne für den Druck das ganze PDF im Speicher rendern zu müssen).
function printPdfViewer() {
  if (_pdfCurrentUrl) { try { window.open(_pdfCurrentUrl, '_blank'); } catch (_) {} }
}

// Die beiden Knöpfe im PDF-Fenster melden sich hier an, nicht mehr in
// 01-core.js — der Handler gehört zu dem Modul, das ihn umsetzt.
registerActions({ closePdfViewer, printPdfViewer });
