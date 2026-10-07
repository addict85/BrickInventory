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
// aussen über openPdfViewer() gerufen; die Knöpfe meldet er selbst beim
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

// ── Zoom ─────────────────────────────────────────────────────────────────────
//
// `_pdfZoom` ist der Faktor auf die Grundgrösse, und die Grundgrösse ist
// „Seite füllt die Breite" (_pdfBaseScale). 1 ist deshalb der untere Anschlag:
// weiter hinaus gibt es nichts zu sehen, die Breite ist schon ganz da. Dieselbe
// Untergrenze hat der Bildzoom der App (ZoomableImageDialog.kt).
const PDF_ZOOM_MIN = 1;
const PDF_ZOOM_MAX = 5;
const PDF_ZOOM_SCHRITT = 1.25;   // ein Druck auf + bzw. −

// Obergrenze für die Leinwand, in Pixeln der Fläche.
//
// GEMESSEN in Chromium 142 (headless, playwright-core), A4-Verhältnis 1 : 1,414:
//
//   Breite    Höhe   MPixel      RAM   brauchbar
//     4096    5793    23,7    91 MB   ja
//     6144    8689    53,4   204 MB   ja
//    11586   16385   189,8   724 MB   ja
//    16384   23170   379,6  1448 MB   NEIN   (16384 ist die harte Grenze)
//
// „Brauchbar" heisst hier: ein gesetztes Pixel kommt per getImageData auch
// zurück. Die harte Grenze liegt also weit über allem, was man wollen würde —
// der Riegel hier ist der SPEICHER, nicht die Grenze. 16 MPixel sind rund
// 64 MB je Seite; der IntersectionObserver unten hält nur die sichtbaren
// Seiten, bei starkem Zoom also eine bis zwei.
//
// Wird der Riegel erreicht, bleibt die Anzeige richtig und wird nur weicher:
// die Leinwand ist dann kleiner als ihr CSS-Kasten und wird hochskaliert.
const PDF_LEINWAND_MAX_PX = 16e6;

let _pdfZoom = 1;
let _pdfBaseScale = 1;          // Faktor „Seite füllt die Breite"
let _pdfSeiteW = 0, _pdfSeiteH = 0;   // Seitengrösse bei scale 1, aus PDF.js
// Zählt jede Zoom-Änderung. Ein Render, der über eine Änderung hinweg läuft,
// hängt seine Leinwand sonst in einen Platzhalter, der inzwischen eine andere
// Grösse hat — die Seite wäre verzerrt. Siehe _renderPdfPage.
let _pdfZoomGen = 0;

export async function openPdfViewer(url, title) {
  const modal = G('pdf-viewer-modal'); if (!modal) return;
  const loading = G('pdf-viewer-loading'), pages = G('pdf-viewer-pages'), dl = G('pdf-viewer-download');
  G('pdf-viewer-title').textContent = title || 'PDF';
  const fname = decodeURIComponent((url.split('?')[0].split('/').pop() || 'anleitung.pdf'));
  dl.href = url; dl.setAttribute('download', fname);
  _pdfCurrentUrl = url;
  _pdfZoom = 1; _pdfZoomGen++; _pdfZeigeFaktor();
  if (pages) { pages.innerHTML = ''; pages.scrollLeft = 0; pages.scrollTop = 0; }
  if (loading) { loading.style.display = 'flex'; loading.innerHTML = '<div class="spin"></div><span>' + (t('pdf.loading')||'PDF wird geladen…') + '</span>'; }
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  // PDF.js wird als ESM-Modul asynchron geladen → ggf. kurz darauf warten.
  let _tries = 0;
  while (!window.pdfjsLib && _tries < 50) { await new Promise(r => setTimeout(r, 100)); _tries++; }
  const pdfjsLib = window.pdfjsLib;
  if (!pdfjsLib) {
    if (loading) loading.innerHTML =
      `<span style="color:#f88;padding:20px">${t('pdf.lib_missing')}</span>`;
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

/** Platzhaltergrösse beim aktuellen Zoom, in CSS-Pixeln. */
function _pdfMasse() {
  return {
    w: Math.round(_pdfSeiteW * _pdfBaseScale * _pdfZoom),
    h: Math.round(_pdfSeiteH * _pdfBaseScale * _pdfZoom)
  };
}

/**
 * Einen Platzhalter auf die aktuelle Zoomgrösse bringen.
 *
 * Das `margin:0 auto` ist kein Geschmack, es ist der Riegel gegen eine
 * GEMESSENE Falle. Behälter 400px breit mit den Stilen aus index.html,
 * Zeile 1526, Chromium 142 (headless, playwright-core):
 *
 *                              Seite 1200px breit        Seite 200px breit
 *                           scrollW  linker Rand         Lage
 *   align-items:center (heute)  800        −400   weg    mittig
 *   center + margin:0 auto     1200           0   da     mittig
 *   flex-start + margin:0 auto 1200           0   da     mittig
 *
 * Erste Zeile: Ist die Seite breiter als der Behälter, sind 400 von 1200 Pixeln
 * links NICHT erreichbar. Der Behälter rollt nicht dorthin — sein scrollWidth
 * kennt sie gar nicht (800 statt 1200). Das ist die alte Flexbox-Eigenheit:
 * zentriert wird auch NEGATIVER Platz, und die Hälfte davon landet vor dem
 * Rollbereich. Ohne diesen Riegel wäre beim Hineinzoomen die linke
 * Seitenhälfte verloren — genau die Hälfte, auf der bei Anleitungen die
 * Teileliste steht.
 *
 * Zweite Zeile ist, was ausgeliefert wird: auto-Ränder schlagen align-self,
 * zentrieren weiter, solange Platz da ist, und werden zu 0, sobald es eng wird.
 * Der Behälter in index.html bleibt deshalb unangetastet.
 *
 * Nicht genommen: `align-items:safe center` tut dasselbe (ebenfalls gemessen),
 * fällt aber auf älteren Browsern als ganze Deklaration aus — dann gilt
 * `normal`, also stretch, und die Seiten wären verzerrt. `margin:auto` gibt es
 * überall.
 */
function _pdfMassPlatzhalter(ph) {
  const m = _pdfMasse();
  ph.style.width = m.w + 'px';
  ph.style.height = m.h + 'px';
}

async function _renderPdfLazy(pdf, container) {
  const first = await pdf.getPage(1);
  const vp1 = first.getViewport({ scale: 1 });
  const containerWidth = Math.min((container.clientWidth || 800) - 28, 1000);
  _pdfSeiteW = vp1.width; _pdfSeiteH = vp1.height;
  _pdfBaseScale = containerWidth / vp1.width;

  for (let n = 1; n <= pdf.numPages; n++) {
    const ph = document.createElement('div');
    ph.className = 'pdf-page-ph';
    ph.dataset.page = n;
    ph.style.cssText = 'background:#fff;box-shadow:0 1px 5px rgba(0,0,0,.35);flex-shrink:0;margin:0 auto';
    _pdfMassPlatzhalter(ph);
    container.appendChild(ph);
  }

  if (_pdfObserver) _pdfObserver.disconnect();
  _pdfObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      const n = parseInt(entry.target.dataset.page);
      if (entry.isIntersecting) _renderPdfPage(pdf, n, entry.target);
      else _unloadPdfPage(n, entry.target);
    });
  }, { root: container, rootMargin: '300px 0px' });
  _pdfBeobachteAlle(container);
}

/** Alle Platzhalter (neu) beobachten. */
function _pdfBeobachteAlle(container) {
  if (!_pdfObserver || !container) return;
  container.querySelectorAll('.pdf-page-ph').forEach(ph => _pdfObserver.observe(ph));
}

async function _renderPdfPage(pdf, n, ph) {
  if (ph.querySelector('canvas') || ph.dataset.rendering === '1') return;
  ph.dataset.rendering = '1';
  const gen = _pdfZoomGen;
  try {
    const page = await pdf.getPage(n);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // Der Riegel wirkt auf die FLÄCHE, nicht auf eine Seitenlänge: eine
    // querformatige Seite hat dieselbe Pixelzahl wie eine hochformatige, nur
    // anders verteilt.
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
    // Zwischenzeitlich gezoomt. Diese Leinwand hat die Auflösung von VORHER.
    //
    // Verzerrt wäre sie nicht — das Seitenverhältnis ist dasselbe, width:100%
    // streckt sie nur. Der Schaden ist ein anderer: Hängt sie erst einmal
    // drin, kehrt der neue Durchlauf gleich oben wieder um
    // (`if (ph.querySelector('canvas')) return`), und die Seite bleibt bis zum
    // nächsten Zoom oder Rollen in der alten, zu groben Auflösung stehen.
    // Genau das ist der Fall, den man nicht sieht, solange der alte Durchlauf
    // schneller fertig wird als der neue — und bei starkem Zoom ist er das,
    // denn er hat weniger zu rendern.
    if (gen !== _pdfZoomGen) { canvas.width = 0; canvas.height = 0; ph.dataset.rendering = '0'; return; }
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

  // Erst alle Leinwände weg, dann die Platzhalter neu bemessen: eine Leinwand
  // mit width:100% würde sonst kurz verzerrt dastehen.
  container.querySelectorAll('.pdf-page-ph').forEach(ph => {
    _unloadPdfPage(parseInt(ph.dataset.page), ph);
    _pdfMassPlatzhalter(ph);
  });

  container.scrollLeft = dokX * ziel - ax;
  container.scrollTop = dokY * ziel - ay;

  // Der Beobachter meldet sich NICHT von selbst, wenn ein beobachtetes Element
  // nur die Grösse ändert und weiter sichtbar bleibt — die sichtbaren Seiten
  // blieben leer. observe() liefert aber immer einen ersten Rückruf, also neu
  // anmelden. (disconnect() davor, sonst doppelte Anmeldung.)
  if (_pdfObserver) { _pdfObserver.disconnect(); _pdfBeobachteAlle(container); }
  _pdfZeigeFaktor();
}

/** Den Faktor als Prozentzahl anzeigen — nicht als Farbe oder Balken. */
function _pdfZeigeFaktor() {
  const el = G('pdf-viewer-zoom');
  if (el) el.textContent = Math.round(_pdfZoom * 100) + '%';
  const minus = G('pdf-viewer-zoom-out'), plus = G('pdf-viewer-zoom-in');
  // Am Anschlag abschalten. `disabled` ist für Screenreader und Tastatur
  // verbindlich; die Ausgrauung ist nur die Begleitung davon, nicht das Signal.
  if (minus) minus.disabled = _pdfZoom <= PDF_ZOOM_MIN + 1e-4;
  if (plus) plus.disabled = _pdfZoom >= PDF_ZOOM_MAX - 1e-4;
}

function pdfZoomIn() { _pdfSetzeZoom(_pdfZoom * PDF_ZOOM_SCHRITT, null, null); }
function pdfZoomOut() { _pdfSetzeZoom(_pdfZoom / PDF_ZOOM_SCHRITT, null, null); }
function pdfZoomReset() { _pdfSetzeZoom(1, null, null); }

/**
 * Mausrad mit Strg/⌘ zoomt, ohne Zusatztaste rollt es weiter.
 *
 * Strg+Rad ist die Geste, mit der Browser seit je die Seite zoomen; genau die
 * fängt der Betrachter hier ab, damit sie das PDF zoomt und nicht die ganze
 * Oberfläche. Ohne Zusatztaste bleibt das Rad beim Rollen — wer durch eine
 * 80-seitige Anleitung blättert, will nicht zoomen.
 *
 * Der Zeiger ist der Anker: man zoomt auf das, worauf man zeigt.
 */
function _pdfRad(ev) {
  if (!ev.ctrlKey && !ev.metaKey) return;
  ev.preventDefault();
  const container = G('pdf-viewer-pages'); if (!container) return;
  const r = container.getBoundingClientRect();
  // deltaY ist je nach Gerät Pixel, Zeilen oder Seiten — nur das Vorzeichen
  // ist überall verlässlich, der Betrag nicht. Deshalb ein fester Schritt.
  const f = ev.deltaY < 0 ? PDF_ZOOM_SCHRITT : 1 / PDF_ZOOM_SCHRITT;
  _pdfSetzeZoom(_pdfZoom * f, ev.clientX - r.left, ev.clientY - r.top);
}

/** Tastatur: + / − / 0, solange das PDF-Fenster offen ist. */
function _pdfTaste(ev) {
  const modal = G('pdf-viewer-modal');
  if (!modal || modal.style.display !== 'flex') return;
  // In einem Eingabefeld hat + eine andere Bedeutung.
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) return;
  if (ev.key === '+' || ev.key === '=') { ev.preventDefault(); pdfZoomIn(); }
  else if (ev.key === '-' || ev.key === '_') { ev.preventDefault(); pdfZoomOut(); }
  else if (ev.key === '0') { ev.preventDefault(); pdfZoomReset(); }
}

// ── Zwei-Finger-Geste ────────────────────────────────────────────────────────
//
// Der Browser kann selbst zoomen (die Seite hat kein user-scalable=no), aber er
// zoomt das Sichtfeld: Kopfzeile und Knöpfe werden mitgross, und das Bild wird
// weich, weil die Leinwand dieselbe bleibt. Hier wird stattdessen die SEITE
// gezoomt und neu gerendert, deshalb fängt der Betrachter die Geste ab.
let _pdfPinchAbstand = 0, _pdfPinchZoom = 1;

function _pdfAbstand(t1, t2) {
  const dx = t1.clientX - t2.clientX, dy = t1.clientY - t2.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function _pdfTouchStart(ev) {
  if (ev.touches.length !== 2) { _pdfPinchAbstand = 0; return; }
  _pdfPinchAbstand = _pdfAbstand(ev.touches[0], ev.touches[1]);
  _pdfPinchZoom = _pdfZoom;
}

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

function _pdfTouchEnd(ev) {
  if (ev.touches.length < 2) _pdfPinchAbstand = 0;
}

/**
 * Die Zuhörer hängen am Behälter und nicht am Fenster, und sie werden EINMAL
 * angemeldet — beim Laden des Moduls, nicht bei jedem openPdfViewer(). Sonst
 * sammelt jedes geöffnete PDF einen weiteren Zuhörer an, und nach zehn
 * Anleitungen zoomt ein Raddreh um das Zehnfache.
 *
 * `passive:false` ist bei wheel und touchmove nötig: ohne das darf
 * preventDefault() nicht wirken, und der Browser zoomt zusätzlich die ganze
 * Oberfläche.
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

// Die Knöpfe im PDF-Fenster melden sich hier an, nicht mehr in 01-core.js —
// der Handler gehört zu dem Modul, das ihn umsetzt.
registerActions({ closePdfViewer, printPdfViewer, pdfZoomIn, pdfZoomOut, pdfZoomReset });
