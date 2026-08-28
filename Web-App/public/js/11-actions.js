import { registerActions, resolveAction } from './00-registry.js';
import { G, fullUrl, saveJobSchedule, setLang } from './01-core.js';
import { openPdfViewer } from './12-pdfviewer.js';
import { autosaveSet, closeImageLightbox, delSet, hideProgress, openImageLightbox } from './02-gallery.js';
import { allFigsCache, deleteManualFig, renderFigs, updateManualFig, deleteManualPart} from './06-minifigs.js';

// ═══ AKTIONEN OHNE INLINE-HANDLER ═══════════════════════════════════════════
//
// Ziel: `script-src 'unsafe-inline'` aus der CSP entfernen. Solange irgendwo
// `onclick="…"` im Markup steht, muss der Browser Inline-Skript erlauben — und
// damit fehlt genau die Verteidigungslinie, die bei einer übersehenen
// XSS-Lücke greifen würde.
//
// Statt 140 Handler einzeln in addEventListener-Aufrufe zu übersetzen, gibt es
// hier einen delegierten Dispatcher. Aus
//
//     <button onclick="plGenerate()">
//     <button onclick="setChartPeriod('year')">
//     <div onclick="openModal('${escJs(s.set_number)}')">
//
// wird
//
//     <button data-click="plGenerate">
//     <button data-click="setChartPeriod" data-arg="year">
//     <div data-click="openModal" data-arg="${esc(s.set_number)}">
//
// Das löst zwei Probleme auf einmal: Die CSP kann zumachen, UND der ganze
// escJs-Kontext verschwindet. Ein Wert in einem data-Attribut wird nie als
// Code gelesen — es gibt keinen JS-String mehr, aus dem ein Apostroph
// ausbrechen könnte.
//
// Kein eval, kein new Function: Der Name wird in einer Tabelle nachgeschlagen.
// Steht er nicht drin, passiert nichts (und es gibt eine Konsolenmeldung).

(function () {
  'use strict';

  /** Ereignisse, die per Delegation am document abgefangen werden. */
  const DELEGATED = ['click', 'change', 'input', 'blur', 'keydown', 'mouseenter', 'mouseleave'];

  /** blur, mouseenter und mouseleave steigen nicht auf — die brauchen Capture. */
  const NEEDS_CAPTURE = new Set(['blur', 'mouseenter', 'mouseleave', 'error', 'load']);

  function attrFor(type) { return 'data-' + type; }

  /**
   * Löst den Handlernamen über die Registry auf (js/00-registry.js).
   *
   * VORHER: `window[name]`. Das setzte voraus, dass alle Handler globale
   * Funktionsdeklarationen sind — eine Annahme, die mit der Umstellung auf
   * ES-Module wegfällt, weil Modul-Deklarationen nicht auf window liegen.
   * Ohne Ersatz wären schlagartig alle Handler tot gewesen, und zwar erst
   * beim Klicken sichtbar.
   *
   * resolveAction() fällt intern weiterhin auf window zurück — das brauchen
   * die vier Handler des Log-Betrachters, der als klassisches Skript in ein
   * eigenes Popup geladen wird.
   */
  function resolve(name) {
    return resolveAction(name);
  }

  function handle(type, ev) {
    const el = ev.target?.closest?.(`[${attrFor(type)}]`);
    if (!el) return;
    const name = el.getAttribute(attrFor(type));
    const fn = resolve(name);
    if (!fn) { console.warn('[actions] unbekannter Handler:', name); return; }

    // Argumente: data-arg, data-arg2, data-arg3 … in dieser Reihenfolge.
    // data-val="1" hängt den aktuellen Feldwert an — deckt die vielen
    // Handler ab, die früher this.value gelesen haben.
    const args = [];
    // data-self="1": Element als erstes Argument. Mehrere bestehende Handler
    // erwarteten früher `this` explizit (z. B. triggerCsvSync(this)).
    if (el.dataset.self === '1') args.push(el);
    for (const key of ['data-arg', 'data-arg2', 'data-arg3', 'data-arg4', 'data-arg5', 'data-arg6']) {
      if (!el.hasAttribute(key)) break;
      args.push(el.getAttribute(key));
    }
    if (el.dataset.val === '1') args.push(el.value);
    args.push(ev);
    try { fn.apply(el, args); }
    catch (e) { console.error('[actions]', name, e); }
  }

  for (const type of DELEGATED) {
    document.addEventListener(type, ev => handle(type, ev), NEEDS_CAPTURE.has(type));
  }

  // ── Bilder: Fehler- und Ladezustand ───────────────────────────────────────
  // error und load steigen nicht auf, lassen sich aber in der Capture-Phase am
  // document abfangen. Ersetzt die zwölf onerror- und vier onload-Attribute in
  // den Kachel-Templates.
  document.addEventListener('error', ev => {
    const el = ev.target;
    if (!el || el.tagName !== 'IMG') return;

    // Erst einmal wiederholen, bevor aufgegeben wird.
    //
    // Ein einzelner Verbindungsfehler — gemessen ETIMEDOUT beim CDN-Abruf —
    // liess die Kachel bisher dauerhaft leer: Der Rückfall entfernte das src
    // oder blendete das Bild aus, und `fallbackDone` verhinderte jeden weiteren
    // Versuch. Das Bild selbst war in Ordnung. Ein Versuch nach einer Sekunde
    // fängt genau diese Aussetzer ab.
    if (!el.dataset.retried && el.src) {
      el.dataset.retried = '1';
      const src = el.src;
      setTimeout(() => { el.src = ''; el.src = src; }, 1000);
      return;
    }

    if (el.dataset.fallbackDone) return;
    el.dataset.fallbackDone = '1';

    // data-onerror bestimmt das Verhalten. Ohne Angabe: volle Auflösung
    // nachladen, wenn die Vorschau fehlschlägt (data-orig), sonst leeren.
    switch (el.dataset.onerror) {
      case 'hide':  el.style.display = 'none'; return;
      case 'clear': el.removeAttribute('src'); return;
      case 'placeholder':
        if (window._catPlaceholderImg) el.outerHTML = window._catPlaceholderImg;
        return;
      case 'keep':
        // Adresse BEHALTEN und den Fehler melden.
        //
        // Für den Zoom (#lightbox-img) ist das Wegnehmen des src die falsche
        // Reaktion: Das Overlay öffnet sich, zeigt eine leere Fläche, und im
        // Log steht nichts — es sieht aus, als sei der Zoom kaputt, obwohl
        // nur EIN Bild nicht geladen werden konnte. Mit dem behaltenen src
        // zeigt der Browser sein Fehlersymbol, und die Konsole nennt die
        // Adresse, an der es scheitert.
        console.warn('[img] konnte nicht geladen werden:', el.src);
        return;
      default: {
        const orig = el.dataset.orig;
        if (orig && el.src !== orig) el.src = orig; else el.removeAttribute('src');
        el.classList.add('loaded');
      }
    }
  }, true);

  // styles.css blendet JEDES img[loading=lazy] auf opacity:0 aus und erst die
  // Klasse .loaded wieder ein. Die Markierung darf deshalb nicht an data-fade
  // hängen — sonst bleibt jedes Bild unsichtbar, dem beim Ergänzen von
  // loading="lazy" das Zusatzattribut gefehlt hat. Genau das ist passiert:
  // sieben Stellen in Finanzen, Minifiguren, Galerie, Teilen und der
  // Startübersicht waren dauerhaft leer, obwohl das Bild geladen war.
  function markLoaded(el) {
    if (el && el.tagName === 'IMG' && el.getAttribute('loading') === 'lazy') {
      el.classList.add('loaded');
    }
  }

  document.addEventListener('load', ev => markLoaded(ev.target), true);

  // Aus dem Browser-Cache gelieferte Bilder sind beim Einfügen schon fertig —
  // ihr load-Ereignis ist dann bereits durch und würde nie ankommen.
  const imgObserver = new MutationObserver(muts => {
    for (const m of muts) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.tagName === 'IMG') { if (node.complete) markLoaded(node); continue; }
        node.querySelectorAll?.('img[loading=lazy]').forEach(i => { if (i.complete) markLoaded(i); });
      }
    }
  });

  if (document.body) imgObserver.observe(document.body, { childList: true, subtree: true });
  else document.addEventListener('DOMContentLoaded',
    () => imgObserver.observe(document.body, { childList: true, subtree: true }));
})();

// ── Kleine Helfer für Handler, die vorher als Ausdruck im Attribut standen ──
// Der Dispatcher ruft mit `this` = auslösendes Element und dem Ereignis als
// letztem Argument auf.

/** War: onclick="G('pw-modal').classList.remove('open')" */
function closePwModal() { G('pw-modal')?.classList.remove('open'); }

/** War: onclick="hideProgress();G('btn-close-import').style.display='none'" */
function closeImportProgress() {
  hideProgress();
  const b = G('btn-close-import');
  if (b) b.style.display = 'none';
}

/** War: onclick="if(event.target===this)closeImageLightbox()" — nur der Hintergrund schliesst. */
function lightboxBackdrop(ev) {
  if (ev && ev.target === this) closeImageLightbox();
}

/**
 * War: onclick="openImageLightbox(this.src)"
 *
 * Nimmt bevorzugt data-orig, nicht this.src: Die Kacheln zeigen seit der
 * Thumbnail-Umstellung eine verkleinerte Fassung, und im Zoom wäre die
 * unscharf. data-orig trägt die volle Auflösung.
 */
function openImageLightboxFromEl() {
  const src = this.dataset.orig && this.dataset.orig !== '/assets/set-placeholder.svg'
    ? this.dataset.orig : this.src;
  openImageLightbox(typeof fullUrl === 'function' ? fullUrl(src) : src);
}

/** War: onchange="setLang(this.value)" */
function setLangFromEl() { setLang(this.value); }

/** War: onchange="renderFigs(allFigsCache)" */
function renderFigsAll() { renderFigs(allFigsCache); }

// ── Wrapper für Handler, die vorher als Ausdruck im Attribut standen ────────
// Alle bekommen `this` = auslösendes Element und das Ereignis als letztes
// Argument (siehe Dispatcher oben).

/** War: onclick="event.stopPropagation()" */
export function stopEvent(ev) { ev?.stopPropagation(); }

/** War: onkeydown="if(event.key==='Enter'){this.blur()}" */
export function blurOnEnter(ev) { if (ev?.key === 'Enter') this.blur(); }

/** War: onclick="document.getElementById('btn-job-trigger').click()" */
export function clickJobTrigger() { document.getElementById('btn-job-trigger')?.click(); }

/** War: onchange="saveJobSchedule('${k}',{time:this.value})" */
export function saveJobTime(k) { saveJobSchedule(k, { time: this.value }); }

/** War: onchange="saveJobSchedule('${k}',{minutes:this.value})" */
export function saveJobMinutes(k) { saveJobSchedule(k, { minutes: this.value }); }

/** War: onblur="updateManualFig('${id}',{bl_fig_number:this.value.trim()||null})" */
export function saveManualFigBl(id) { updateManualFig(id, { bl_fig_number: this.value.trim() || null }); }

/** War: onclick="event.stopPropagation();delSet('${sn}')" — Löschen auf klickbarer Kachel */
export function delSetStop(sn, ev) { ev?.stopPropagation(); delSet(sn); }

/** War: onclick="event.stopPropagation();deleteManualFig('${n}')" */
export function deleteManualFigStop(n, ev) { ev?.stopPropagation(); deleteManualFig(n); }

/**
 * Löschen eines manuellen Teils von der Kachel aus.
 *
 * stopPropagation ist zwingend: Die Kachel selbst trägt data-click="openManDetail".
 * Ohne das Anhalten öffnete der Klick zusätzlich den Detail-Dialog hinter der
 * Löschabfrage — genau dafür gibt es die Stop-Variante schon bei Sets und Figuren.
 *
 * @param {string} partNumber
 * @param {string} colorId Kommt als Zeichenkette aus data-arg2
 * @param {Event} ev
 */
export function deleteManualPartStop(partNumber, colorId, ev) {
  ev?.stopPropagation();
  deleteManualPart(partNumber, parseInt(colorId) || 0);
}

/** War: onclick="openPdfViewer('${href}','${desc}');return false;" auf einem Link */
export function openPdfViewerLink(href, desc, ev) { ev?.preventDefault(); openPdfViewer(href, desc || ''); }

/** War: onclick="const q=G('m-qty');q.value=Math.max(1,parseInt(q.value||1)-1);autosaveSet()" */
export function mQtyDec() { const q = G('m-qty'); q.value = Math.max(1, parseInt(q.value || 1) - 1); autosaveSet(); }

/** War: onclick="const q=G('m-qty');q.value=parseInt(q.value||1)+1;autosaveSet()" */
export function mQtyInc() { const q = G('m-qty'); q.value = parseInt(q.value || 1) + 1; autosaveSet(); }


// ── Handler beim Dispatcher anmelden (siehe js/00-registry.js) ──────────────
registerActions({
  blurOnEnter,
  clickJobTrigger,
  closeImportProgress,
  closePwModal,
  delSetStop,
  deleteManualFigStop,
  deleteManualPartStop,
  lightboxBackdrop,
  mQtyDec,
  mQtyInc,
  openImageLightboxFromEl,
  openPdfViewerLink,
  renderFigsAll,
  saveJobMinutes,
  saveJobTime,
  saveManualFigBl,
  setLangFromEl,
  stopEvent,
});
