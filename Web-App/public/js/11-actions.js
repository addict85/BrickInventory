import { istVertraut, registerActions, resolveAction } from './00-registry.js';
import { G, bildPlatzhalter, bildVorlaeufig, bildGeladen, fullUrl, setLang, toast } from './01-core.js';
import { tRaw } from '../i18n.js';
import { saveJobSchedule } from './01-monitor.js';
import { openPdfViewer } from './12-pdfviewer.js';
import { delSet } from './02-gallery.js';
import { alleFiguren, deleteManualFig, renderFigs, renderManualFigsTable, updateManualFig } from './06-minifigs.js';
import { merkpostenLoeschen } from './16-merkliste.js';
import { autosaveSet, closeImageLightbox, openImageLightbox } from './07-set-detail.js';
import { hideProgress } from './01-fortschritt.js';
import { deleteManualPart } from './03-parts.js';

// Ziel: `script-src 'unsafe-inline'` aus der CSP entfernen. Solange irgendwo
// `onclick="…"` im Markup steht, muss der Browser Inline-Skript erlauben — und
// damit fehlt genau die Verteidigungslinie, die bei einer übersehenen
// XSS-Lücke greifen würde.
// Ausführlich: docs/begruendungen/public/js/11-actions.js.md#ziel-script-src-unsafe-inline-aus-der-cs

(function () {
  'use strict';

  /** Ereignisse, die per Delegation am document abgefangen werden. Kein
   * mouseenter/mouseleave: Ein Überfahren mit der Maus ist keine Absicht, und
   * eingeschleustes Markup löste damit Aktionen ohne Klick aus. */
  const DELEGATED = ['click', 'change', 'input', 'blur', 'keydown'];

  /** blur steigt nicht auf — braucht Capture. */
  const NEEDS_CAPTURE = new Set(['blur', 'error', 'load']);

  // Ausser click nimmt jedes Ereignis nur die Handler, die das Markup dafür
  // wirklich nutzt; test/aktionen-schutz.test.js gleicht die Liste ab.
  const NUR = {
    change: new Set(['acqSave', 'aendereAlarmSchwelle', 'autosaveSet', 'benenneLagerortUm',
      'gutscheinDateiGewaehlt', 'gutscheinLandSpeichern', 'importAlarmeCsv', 'importConfig', 'importFigsCsv',
      'importMerklisteCsv', 'importPartsCsv', 'ladeMerkliste', 'lagerortGewaehlt', 'manAcqSave',
      'manQtySave', 'merkpostenInhaberGewaehlt', 'onScopeChange', 'onStorageChange',
      'plFuelleBestand', 'renderFigsAll', 'renderGallery', 'saveJobMinutes', 'saveJobTime',
      'saveRegEnabled', 'setCatFilter', 'setColorFilter', 'setLangFromEl', 'setzeDunkel',
      'setzeEigenesDesign', 'speichereAlarm', 'speichereWaehrung', 'speichereZustand', 'speichereSetLagerort', 'speichereTeilFarbe',
      'speichereTeilLagerort', 'startSetCsvImport', 'updateColorDot', 'uploadInstr', 'waehrungPruefen',
      'wantedKorrekturFarbe', 'wantedKorrekturNummer', 'wantedKorrekturWert',
      'wantedXmlGewaehlt', 'wechsleAlarmZustand']),
    input: new Set(['alarmGetippt', 'emailGetippt', 'filterFigs']),
    blur: new Set(['acqSave', 'lagerortGetippt', 'manAcqSave', 'saveManualFigBl']),
    keydown: new Set(['blurOnEnter', 'lagerortTaste']),
  };

  // Löschen, Konto, Zugänge, Verwaltung: nur von Elementen, die unser Code
  // erzeugt hat (istVertraut), nie aus eingeschleustem Markup.
  const GEFAEHRLICH = new Set([
    'delSet', 'delSetStop', 'delInstr', 'acqDelete', 'manAcqDelete', 'deleteManualFig',
    'deleteManualFigStop', 'deleteManualPartStop', 'merkpostenLoeschen', 'merkpostenLoeschenStop',
    'merkpostenDetailLoeschen', 'gutscheinLoeschen', 'loescheAlarm', 'loescheLagerort',
    'papierkorbEndgueltig', 'papierkorbLeeren', 'deleteBricksetQueueEntry',
    'revokeToken', 'revokeOtherTokens', 'passkeyHinzufuegen', 'passkeyLoeschen',
    'zfEinrichten', 'zfNeueCodes', 'zfAbschalten', 'zfZuruecksetzen',
    'createHouseholdInvite', 'redeemHouseholdInvite', 'unlinkHousehold', 'unlinkFromParent',
    'delUser', 'toggleAdmin', 'toggleAktiv', 'openRpw', 'saveRegEnabled', 'importConfig',
    'auftragAbbrechen', 'auftragsArtLeeren',
  ]);

  function attrFor(type) { return 'data-' + type; }

  /**
   * Löst den Handlernamen über die Registry auf (js/00-registry.js).
   * Ausführlich: docs/begruendungen/public/js/11-actions.js.md#resolve
   */
  function resolve(name) {
    return resolveAction(name);
  }

  function handle(type, ev) {
    const el = ev.target?.closest?.(`[${attrFor(type)}]`);
    if (!el) return;
    const name = el.getAttribute(attrFor(type));
    if ((NUR[type] && !NUR[type].has(name)) || (GEFAEHRLICH.has(name) && !istVertraut(el))) {
      console.warn('[actions] abgewiesen:', type, name); return;
    }
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

  // Karten und Zeilen mit data-click sind keine Knöpfe; mit tabindex und
  // dieser Zeile bedient die Tastatur sie wie einen (Eingabe, bei role=button
  // auch Leertaste).
  const NATIV = new Set(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'SUMMARY']);
  document.addEventListener('keydown', ev => {
    const el = ev.target;
    if (!(el instanceof HTMLElement) || NATIV.has(el.tagName) || !el.hasAttribute?.('data-click') || !el.hasAttribute('tabindex')) return;
    const leer = ev.key === ' ' && el.getAttribute('role') === 'button';
    if (ev.key !== 'Enter' && !leer) return;
    ev.preventDefault();
    el.click();
  });

  // Die Anmelde-, Registrier- und Passwortfelder liegen seit Nachtrag … in
  // einem <form>. Nicht aus Formtreue: Ohne umgebendes Formular meldet Chrome
  // „Password field is not contained in a form", und Passwortmanager bieten
  // Speichern und Ausfuellen dann nur noch nach Heuristik an — mal ja, mal …
  // Ausführlich: docs/begruendungen/public/js/11-actions.js.md#die-anmelde-registrier-und-passwortfelde
  document.addEventListener('submit', ev => {
    const form = ev.target;
    if (!(form instanceof HTMLFormElement)) return;
    ev.preventDefault();
    const id = form.getAttribute('data-submit');
    if (!id) return;
    const knopf = /** @type {HTMLButtonElement | null} */ (document.getElementById(id));
    if (knopf && !knopf.disabled) knopf.click();
  });

  // ── Bilder: Fehler- und Ladezustand ───────────────────────────────────────
  // error und load steigen nicht auf, lassen sich aber in der Capture-Phase am
  // document abfangen. Ersetzt die zwölf onerror- und vier onload-Attribute in
  // den Kachel-Templates.
  document.addEventListener('error', ev => {
    const el = ev.target;
    if (!(el instanceof HTMLImageElement)) return;

    // Erst einmal wiederholen, bevor aufgegeben wird.
    // Ausführlich: docs/begruendungen/public/js/11-actions.js.md#if
    if (!el.dataset.retried && el.src) {
      el.dataset.retried = '1';
      if (/** @type {HTMLImageElement} */ (el).dataset.ph) bildVorlaeufig(el);
      const src = el.src;
      // removeAttribute statt src='': Ein leeres src zeigt auf die SEITE, und
      // der Browser wuerde sie als Bild zu laden versuchen.
      setTimeout(() => { el.removeAttribute('src'); el.src = src; }, 1000);
      return;
    }

    if (el.dataset.onerror === 'keep') {
      // Der Zoom (#lightbox-img) behält die Adresse: Ein leeres Overlay sähe
      // aus wie ein kaputter Zoom, so nennt die Konsole die Adresse.
      console.warn('[img] konnte nicht geladen werden:', el.src);
      return;
    }
    const orig = el.dataset.orig;
    if (orig && !el.dataset.origVersucht && el.getAttribute('src') !== orig) {
      el.dataset.origVersucht = '1';
      el.src = orig;
      return;
    }
    if (el.dataset.fallbackDone) return;
    el.dataset.fallbackDone = '1';
    // Bilder aus Vorlagen (bildTag) bekommen den Platzhalter ihrer Art; die
    // festen Dialogbilder in index.html werden nur geleert.
    if (el.dataset.ph) bildPlatzhalter(el);
    else { el.removeAttribute('src'); el.classList.add('loaded'); }
  }, true);

  // styles.css blendet JEDES img[loading=lazy] auf opacity:0 aus und erst die
  // Klasse .loaded wieder ein. Die Markierung darf deshalb nicht an data-fade
  // hängen — sonst bleibt jedes Bild unsichtbar, dem beim Ergänzen von
  // loading="lazy" das Zusatzattribut gefehlt hat. Genau das ist passiert: …
  // Ausführlich: docs/begruendungen/public/js/11-actions.js.md#markloaded
  function markLoaded(el) {
    if (el && el.tagName === 'IMG' && el.getAttribute('loading') === 'lazy') {
      el.classList.add('loaded');
    }
    const bild = /** @type {HTMLImageElement} */ (el);
    if (bild?.tagName === 'IMG' && bild.hidden && bild.dataset.ph) bildGeladen(bild);
  }

  document.addEventListener('load', ev => markLoaded(ev.target), true);

  // Aus dem Browser-Cache gelieferte Bilder sind beim Einfügen schon fertig —
  // ihr load-Ereignis ist dann bereits durch und würde nie ankommen.
  const imgObserver = new MutationObserver(muts => {
    for (const m of muts) {
      for (const node of m.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node instanceof HTMLImageElement) { if (node.complete) markLoaded(node); continue; }
        /** @type {NodeListOf<HTMLImageElement>} */ (node.querySelectorAll('img[loading=lazy]')).forEach(i => { if (i.complete) markLoaded(i); });
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
/** Darstellung je Gerät — die Logik steht in 00-theme-boot.js. */
/** @this {HTMLSelectElement} */
function setzeDunkel() { window.__bimDunkel?.(this.value); }

/** Neu zeichnen mit der zuletzt geladenen Liste. */
/**
 * Der Ansichtsumschalter des Figuren-Reiters — fuer BEIDE Listen.
 * Ausführlich: docs/begruendungen/public/js/11-actions.js.md#renderfigsall
 */
function renderFigsAll() { renderFigs(alleFiguren()); renderManualFigsTable(); }

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
export function saveJobTime(k) {
  const m = /^\s*(\d{1,2})\s*[:.]?\s*(\d{2})\s*$/.exec(this.value);
  const gueltig = !!m && +m[1] < 24 && +m[2] < 60;
  this.setAttribute('aria-invalid', String(!gueltig));
  if (!gueltig) { toast(tRaw('monitor.sched.ungueltig'), 'error'); return; }
  this.value = m[1].padStart(2, '0') + ':' + m[2];
  saveJobSchedule(k, { time: this.value });
}

/** War: onchange="saveJobSchedule('${k}',{minutes:this.value})" */
export function saveJobMinutes(k) { saveJobSchedule(k, { minutes: this.value }); }

/** War: onblur="updateManualFig('${id}',{bl_fig_number:this.value.trim()||null})" */
// owner: Besitzer der Karte. Ohne ihn schriebe der Server in die Zeile des
// Aufrufers statt in die angezeigte — siehe openManDetail.
export function saveManualFigBl(id, owner) {
  updateManualFig(id, { bl_fig_number: this.value.trim() || null }, owner);
}

/** War: onclick="event.stopPropagation();delSet('${sn}')" — Löschen auf klickbarer Kachel */
export function delSetStop(sn, ev) { ev?.stopPropagation(); delSet(sn); }

/**
 * Löschen von einer KACHEL aus — Figur, Teil, Merkposten.
 * Ausführlich: docs/begruendungen/public/js/11-actions.js.md#deletemanualfigstop
 */
export function deleteManualFigStop(n, owner, ev) { ev?.stopPropagation(); deleteManualFig(n, owner); }

/**
 * @param {string} partNumber
 * @param {string} colorId Kommt als Zeichenkette aus data-arg2
 * @param {Event} ev
 */
export function deleteManualPartStop(partNumber, colorId, owner, ev) {
  ev?.stopPropagation();
  deleteManualPart(partNumber, parseInt(colorId) || 0, owner);
}

/**
 * Merkposten von der Zeile aus loeschen.
 *
 * Die Zeile oeffnet seit dem 24.09. auf ihrer GANZEN Flaeche das Detail —
 * damals, weil sie keinen Knopf mehr trug. Jetzt traegt sie wieder einen, und
 * genau deshalb braucht er dieselbe Stop-Fassung wie die Kacheln daneben.
 */
export function merkpostenLoeschenStop(arg, ev) {
  ev?.stopPropagation();
  merkpostenLoeschen(arg);
}

/** War: onclick="openPdfViewer('${href}','${desc}');return false;" auf einem Link */
export function openPdfViewerLink(href, desc, ev) { ev?.preventDefault(); openPdfViewer(href, desc || ''); }

/** War: onclick="const q=G('m-qty');q.value=Math.max(1,parseInt(q.value||1)-1);autosaveSet()" */
export function mQtyDec() { const q = G('m-qty'); q.value = String(Math.max(1, parseInt(q.value || '1') - 1)); autosaveSet(); }

/** War: onclick="const q=G('m-qty');q.value=parseInt(q.value||1)+1;autosaveSet()" */
export function mQtyInc() { const q = G('m-qty'); q.value = String(parseInt(q.value || '1') + 1); autosaveSet(); }


// ── Handler beim Dispatcher anmelden (siehe js/00-registry.js) ──────────────
registerActions({
  blurOnEnter,
  clickJobTrigger,
  closeImportProgress,
  closePwModal,
  delSetStop,
  deleteManualFigStop,
  deleteManualPartStop,
  merkpostenLoeschenStop,
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
  setzeDunkel,
  stopEvent,
});
