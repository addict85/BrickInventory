import { istVertraut, registerActions, resolveAction } from './registry.js';
import { bildPlatzhalter, bildVorlaeufig, bildGeladen, fullUrl, zoomStand, PLATZHALTER_SET } from './bilder.js';
import { G } from './dom.js';
import { setLang } from './konto.js';
import { toast } from './meldungen.js';
import { tRaw } from '../i18n.js';
import { saveJobSchedule } from './monitor.js';
import { openPdfViewer } from './pdfviewer.js';
import { delSet } from './gallery.js';
import { alleFiguren, deleteManualFig, renderFigs, renderManualFigsTable, updateManualFig } from './minifigs.js';
import { merkpostenLoeschen } from './merkliste.js';
import { autosaveSet, closeImageLightbox, openImageLightbox } from './set-detail.js';
import { hideProgress } from './fortschritt.js';
import { deleteManualPart } from './parts.js';

// Ein delegierter Dispatcher für data-click & Co. statt onclick im Markup: So kommt die CSP ohne script-src
// 'unsafe-inline' aus, und eine übersehene XSS-Lücke trifft noch auf diese Verteidigungslinie.

(() => {
  /** Ereignisse, die per Delegation am document abgefangen werden. Kein
   * mouseenter/mouseleave: Ein Überfahren mit der Maus ist keine Absicht, und
   * eingeschleustes Markup löste damit Aktionen ohne Klick aus. */
  const DELEGATED = ['click', 'change', 'input', 'blur', 'keydown'];

  /** blur steigt nicht auf — braucht Capture. */
  const NEEDS_CAPTURE = new Set(['blur', 'error', 'load']);

  // Ausser click nimmt jedes Ereignis nur die Handler, die das Markup dafür wirklich nutzt;
  // test/aktionen-schutz.test.js gleicht die Liste ab.
  /** @type {Record<string, Set<string>>} */
  const NUR = {
    change: new Set([
      'acqSave',
      'aendereAlarmSchwelle',
      'autosaveSet',
      'benenneLagerortUm',
      'gutscheinDateiGewaehlt',
      'gutscheinLandSpeichern',
      'importAlarmeCsv',
      'importConfig',
      'importFigsCsv',
      'importMerklisteCsv',
      'importPartsCsv',
      'ladeMerkliste',
      'lagerortGewaehlt',
      'manAcqSave',
      'manQtySave',
      'merkpostenInhaberGewaehlt',
      'onScopeChange',
      'onStorageChange',
      'plFuelleBestand',
      'renderFigsAll',
      'renderGallery',
      'saveJobMinutes',
      'saveJobTime',
      'saveRegEnabled',
      'setCatFilter',
      'setColorFilter',
      'setLangFromEl',
      'setzeDunkel',
      'setzeEigenesDesign',
      'speichereAlarm',
      'speichereAppDesign',
      'speichereCacheTtl',
      'speichereWaehrung',
      'speichereZustand',
      'speichereSetLagerort',
      'speichereStandardZustand',
      'speichereTeilFarbe',
      'speichereTeilLagerort',
      'startSetCsvImport',
      'updateColorDot',
      'uploadInstr',
      'waehrungPruefen',
      'wantedKorrekturFarbe',
      'wantedKorrekturNummer',
      'wantedKorrekturWert',
      'wantedXmlGewaehlt',
      'wechsleAlarmZustand',
    ]),
    input: new Set(['alarmGetippt', 'filterFigs', 'finSuchen']),
    blur: new Set(['acqSave', 'lagerortGetippt', 'manAcqSave', 'saveManualFigBl']),
    keydown: new Set(['blurOnEnter', 'lagerortTaste']),
  };

  // Löschen, Konto, Zugänge, Verwaltung: nur von Elementen, die unser Code erzeugt hat (istVertraut), nie aus
  // eingeschleustem Markup.
  const GEFAEHRLICH = new Set([
    'delSet',
    'delSetStop',
    'delInstr',
    'acqDelete',
    'manAcqDelete',
    'deleteManualFig',
    'deleteManualFigStop',
    'deleteManualPartStop',
    'merkpostenLoeschen',
    'merkpostenLoeschenStop',
    'merkpostenDetailLoeschen',
    'gutscheinLoeschen',
    'loescheAlarm',
    'loescheLagerort',
    'papierkorbEndgueltig',
    'papierkorbLeeren',
    'deleteBricksetQueueEntry',
    'revokeToken',
    'revokeOtherTokens',
    'passkeyHinzufuegen',
    'passkeyLoeschen',
    'qrKopplungBestaetigen',
    'qrKopplungAblehnen',
    'zfEinrichten',
    'zfNeueCodes',
    'zfAbschalten',
    'zfZuruecksetzen',
    'createHouseholdInvite',
    'redeemHouseholdInvite',
    'unlinkHousehold',
    'unlinkFromParent',
    'delUser',
    'kontoFreischalten',
    'toggleAdmin',
    'toggleAktiv',
    'openRpw',
    'saveRegEnabled',
    'importConfig',
    'auftragAbbrechen',
    'auftragsArtLeeren',
  ]);

  /**
   * @param {string} type
   */
  function attrFor(type) {
    return 'data-' + type;
  }

  /**
   * Handlernamen über die Registry auflösen: Modul-Funktionen liegen nicht auf window. resolveAction() fällt
   * intern noch auf window zurück, für den Log-Betrachter, der als klassisches Skript im eigenen Popup läuft.
   * @param {string} name
   */
  function resolve(name) {
    return resolveAction(name);
  }

  /**
   * @param {string} type
   * @param {Event} ev
   */
  function handle(type, ev) {
    const el = /** @type {HTMLElement | null | undefined} */ (
      /** @type {Element | null} */ (ev.target)?.closest?.(`[${attrFor(type)}]`)
    );
    if (!el) return;
    const name = el.getAttribute(attrFor(type));
    if (name === null || (NUR[type] && !NUR[type].has(name)) || (GEFAEHRLICH.has(name) && !istVertraut(el))) {
      console.warn('[actions] abgewiesen:', type, name);
      return;
    }
    const fn = resolve(name);
    if (!fn) {
      console.warn('[actions] unbekannter Handler:', name);
      return;
    }

    // Argumente: data-arg, data-arg2, data-arg3 … in dieser Reihenfolge. data-val="1" hängt den aktuellen
    // Feldwert an — deckt die vielen Handler ab, die früher this.value gelesen haben.
    const args = [];
    // data-self="1": Element als erstes Argument. Mehrere bestehende Handler erwarteten früher `this`
    // explizit (z. B. triggerCsvSync(this)).
    if (el.dataset.self === '1') args.push(el);
    for (const key of ['data-arg', 'data-arg2', 'data-arg3', 'data-arg4', 'data-arg5', 'data-arg6']) {
      if (!el.hasAttribute(key)) break;
      args.push(el.getAttribute(key));
    }
    if (el.dataset.val === '1') args.push(/** @type {HTMLInputElement} */ (el).value);
    args.push(ev);
    try {
      fn.apply(el, args);
    } catch (e) {
      console.error('[actions]', name, e);
    }
  }

  for (const type of DELEGATED) {
    document.addEventListener(type, ev => handle(type, ev), NEEDS_CAPTURE.has(type));
  }

  // Karten und Zeilen mit data-click sind keine Knöpfe; mit tabindex und dieser Zeile bedient die Tastatur
  // sie wie einen (Eingabe, bei role=button auch Leertaste).
  const NATIV = new Set(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'SUMMARY']);
  document.addEventListener('keydown', ev => {
    const el = ev.target;
    if (
      !(el instanceof HTMLElement) ||
      NATIV.has(el.tagName) ||
      !el.hasAttribute?.('data-click') ||
      !el.hasAttribute('tabindex')
    )
      return;
    // Das Lösch-Kreuz der Karte ist ein Mauskürzel (aria-hidden, in der Karte kein Knopf erlaubt); Entf ist sein Tastaturweg.
    const kreuz =
      ev.key === 'Delete' && el.matches('[aria-keyshortcuts~="Delete"]')
        ? el.querySelector(':scope > .ca > .delbtn')
        : null;
    // Gesperrt ist es nur, wenn der Knopf selbst fehlt (ohne Netz); ohne Überfahren ist bloss die Ecke leer.
    if (kreuz && getComputedStyle(kreuz).display !== 'none') {
      ev.preventDefault();
      /** @type {HTMLElement} */
      (kreuz).click();
      return;
    }
    const leer = ev.key === ' ' && el.getAttribute('role') === 'button';
    if (ev.key !== 'Enter' && !leer) return;
    ev.preventDefault();
    el.click();
  });

  // Anmelde- und Passwortfelder stehen in einem <form>, damit Passwortmanager zuverlässig speichern und
  // ausfüllen. Abgesendet wird nie: Ein echtes Absenden lüde die Seite neu; stattdessen läuft der Knopf aus
  // data-submit.
  document.addEventListener('submit', ev => {
    const form = ev.target;
    if (!(form instanceof HTMLFormElement)) return;
    ev.preventDefault();
    const id = form.getAttribute('data-submit');
    if (!id) return;
    const knopf = /** @type {HTMLButtonElement | null} */ (document.getElementById(id));
    if (knopf && !knopf.disabled) knopf.click();
  });
  // Mit mehr als einem Textfeld und ohne Absendeknopf sendet der Browser bei Enter nicht ab (auch verborgene
  // Felder zählen). Dann löst Enter hier den Knopf aus, den `data-submit` nennt.
  document.addEventListener('keydown', ev => {
    if (ev.key !== 'Enter' || ev.isComposing || ev.defaultPrevented) return;
    const feld = ev.target;
    if (!(feld instanceof HTMLInputElement) || /^(button|submit|reset|checkbox|radio|file|image)$/.test(feld.type))
      return;
    const id = feld.form?.getAttribute('data-submit');
    if (!id || feld.form?.querySelector('[type="submit"]')) return;
    ev.preventDefault();
    const knopf = /** @type {HTMLButtonElement|null} */ (document.getElementById(id));
    if (knopf && !knopf.disabled) knopf.click();
  });

  // ── Bilder: Fehler- und Ladezustand ───────────────────────────────────────
  // error und load steigen nicht auf, lassen sich aber in der Capture-Phase am document abfangen. Ersetzt die
  // zwölf onerror- und vier onload-Attribute in den Kachel-Templates.
  document.addEventListener(
    'error',
    ev => {
      const el = ev.target;
      if (!(el instanceof HTMLImageElement)) return;

      // Einmal wiederholen, bevor aufgegeben wird: Ein einzelner Verbindungsfehler (ETIMEDOUT beim CDN) liess
      // die Kachel sonst dauerhaft leer, obwohl das Bild in Ordnung war.
      if (!el.dataset.retried && el.src) {
        el.dataset.retried = '1';
        if (/** @type {HTMLImageElement} */ (el).dataset.ph) bildVorlaeufig(el);
        const src = el.src;
        // removeAttribute statt src='': Ein leeres src zeigt auf die SEITE, und der Browser wuerde sie als Bild
        // zu laden versuchen.
        setTimeout(() => {
          el.removeAttribute('src');
          el.src = src;
        }, 1000);
        return;
      }

      if (el.dataset.onerror === 'keep') {
        // Der Zoom (#lightbox-img) behält die Adresse: Ein leeres Overlay sähe aus wie ein kaputter Zoom, so
        // nennt die Konsole die Adresse.
        console.warn('[img] konnte nicht geladen werden:', el.src);
        return;
      }
      const orig = el.dataset.orig;
      if (orig && !el.dataset.origVersucht && el.getAttribute('src') !== orig) {
        el.dataset.origVersucht = '1';
        el.src = orig;
        zoomStand(el);
        return;
      }
      if (el.dataset.fallbackDone) return;
      el.dataset.fallbackDone = '1';
      // Bilder aus Vorlagen (bildTag) bekommen den Platzhalter ihrer Art; die festen Dialogbilder den des Sets,
      // sonst stünde ein kaputtes Bildsymbol da.
      if (el.dataset.ph) bildPlatzhalter(el);
      else if (el.classList.contains('zoombar')) {
        el.src = PLATZHALTER_SET;
        zoomStand(el);
      } else {
        el.removeAttribute('src');
        el.classList.add('loaded');
      }
    },
    true,
  );

  // .loaded an jedes img[loading=lazy], nicht nur an data-fade: styles.css blendet alle lazy-Bilder aus, und
  // ohne Zusatzattribut blieben sie sonst trotz geladenem Bild unsichtbar.
  /** @param {EventTarget | null} el */
  function markLoaded(el) {
    if (el instanceof HTMLImageElement && el.getAttribute('loading') === 'lazy') {
      el.classList.add('loaded');
    }
    const bild = /** @type {HTMLImageElement} */ (el);
    if (bild?.tagName === 'IMG' && bild.hidden && bild.dataset.ph) bildGeladen(bild);
  }

  document.addEventListener('load', ev => markLoaded(ev.target), true);

  // Aus dem Browser-Cache gelieferte Bilder sind beim Einfügen schon fertig — ihr load-Ereignis ist dann
  // bereits durch und würde nie ankommen.
  const imgObserver = new MutationObserver(muts => {
    for (const m of muts) {
      for (const node of m.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node instanceof HTMLImageElement) {
          if (node.complete) markLoaded(node);
          continue;
        }
        /** @type {NodeListOf<HTMLImageElement>} */ (node.querySelectorAll('img[loading=lazy]')).forEach(i => {
          if (i.complete) markLoaded(i);
        });
      }
    }
  });

  if (document.body) imgObserver.observe(document.body, { childList: true, subtree: true });
  else
    document.addEventListener('DOMContentLoaded', () =>
      imgObserver.observe(document.body, { childList: true, subtree: true }),
    );
})();

// ── Kleine Helfer für Handler, die vorher als Ausdruck im Attribut standen ──
// Der Dispatcher ruft mit `this` = auslösendes Element und dem Ereignis als letztem Argument auf.

function closePwModal() {
  G('pw-modal')?.classList.remove('open');
}

function closeImportProgress() {
  hideProgress();
  const b = G('btn-close-import');
  if (b) b.style.display = 'none';
}

/**
 * @param {Event} ev
 * @this {HTMLElement}
 */
function lightboxBackdrop(ev) {
  if (ev && ev.target === this) closeImageLightbox();
}

/**
 *
 * Nimmt bevorzugt data-orig, nicht this.src: Die Kacheln zeigen seit der Thumbnail-Umstellung eine
 * verkleinerte Fassung, und im Zoom wäre die unscharf. data-orig trägt die volle Auflösung.
 * @this {HTMLImageElement}
 */
function openImageLightboxFromEl() {
  const src = this.dataset.orig && this.dataset.orig !== '/assets/set-placeholder.svg' ? this.dataset.orig : this.src;
  // Der Titel des Dialogs nennt, was das Bild zeigt (Set, Teil, Figur), samt Untertitel mit der Nummer.
  const dialog = this.closest('.ovl');
  const name = [
    dialog?.querySelector('.mtit')?.textContent,
    dialog?.querySelector('.muntertit, [id$="-sub"]')?.textContent,
  ]
    .map(s => (s || '').trim())
    .filter(Boolean)
    .join(' – ');
  openImageLightbox(typeof fullUrl === 'function' ? fullUrl(src) : src, name);
}

/** @this {HTMLSelectElement} */
function setLangFromEl() {
  setLang(this.value);
}
/** Darstellung je Gerät — die Logik steht in theme-boot.js. @this {HTMLSelectElement} */
function setzeDunkel() {
  window.__bimDunkel?.(this.value);
}

/**
 * Der Ansichtsumschalter des Figuren-Reiters gilt für beide Listen: Er steht über beiden, also schaltet er
 * auch die manuell erfassten Figuren um.
 */
function renderFigsAll() {
  renderFigs(alleFiguren());
  renderManualFigsTable();
}

// ── Wrapper für Handler, die vorher als Ausdruck im Attribut standen ────────
// Alle bekommen `this` = auslösendes Element und das Ereignis als letztes Argument (siehe Dispatcher oben).

/**
 * @param {Event | undefined} ev
 */
export function stopEvent(ev) {
  ev?.stopPropagation();
}

/**
 * @param {KeyboardEvent | undefined} ev
 * @this {HTMLElement}
 */
export function blurOnEnter(ev) {
  if (ev?.key === 'Enter') this.blur();
}

export function clickJobTrigger() {
  document.getElementById('btn-job-trigger')?.click();
}

/**
 * @param {string} k
 * @this {HTMLInputElement}
 */
export function saveJobTime(k) {
  const m = /^\s*(\d{1,2})\s*[:.]?\s*(\d{2})\s*$/.exec(this.value);
  const gueltig = !!m && +m[1] < 24 && +m[2] < 60;
  this.setAttribute('aria-invalid', String(!gueltig));
  if (!gueltig) {
    toast(tRaw('monitor.sched.ungueltig'), 'error');
    return;
  }
  this.value = m[1].padStart(2, '0') + ':' + m[2];
  saveJobSchedule(k, { time: this.value }, this);
}

/**
 * @param {string} k
 * @this {HTMLInputElement}
 */
export function saveJobMinutes(k) {
  saveJobSchedule(k, { minutes: Number(this.value) }, this);
}

// owner: Besitzer der Karte. Ohne ihn schriebe der Server in die Zeile des Aufrufers statt in die angezeigte
// — siehe openManDetail.
/**
 * @param {string} id
 * @param {string} owner
 * @this {HTMLInputElement}
 */
export function saveManualFigBl(id, owner) {
  updateManualFig(id, { bl_fig_number: this.value.trim() || null }, owner);
}

/**
 * @param {string} sn
 * @param {Event | undefined} ev
 */
export function delSetStop(sn, ev) {
  ev?.stopPropagation();
  delSet(sn);
}

/**
 * Löschen von einer Kachel aus, mit stopPropagation: Die Kachel hat selbst ein data-click, und ohne Stopp
 * öffnete der Papierkorb zusätzlich den Dialog hinter der Löschabfrage.
 * @param {string} n
 * @param {string} owner
 * @param {Event | undefined} ev
 */
export function deleteManualFigStop(n, owner, ev) {
  ev?.stopPropagation();
  deleteManualFig(n, owner);
}

/**
 * @param {string} partNumber
 * @param {string} colorId Kommt als Zeichenkette aus data-arg2
 * @param {Event} ev
 * @param {string} owner
 */
export function deleteManualPartStop(partNumber, colorId, owner, ev) {
  ev?.stopPropagation();
  deleteManualPart(partNumber, parseInt(colorId, 10) || 0, owner);
}

/**
 * Merkposten von der Zeile aus loeschen.
 *
 * Die Zeile oeffnet seit dem 24.09. auf ihrer GANZEN Flaeche das Detail — damals, weil sie keinen Knopf mehr
 * trug. Jetzt traegt sie wieder einen, und genau deshalb braucht er dieselbe Stop-Fassung wie die Kacheln
 * daneben.
 * @param {string} arg
 * @param {Event | undefined} ev
 */
export function merkpostenLoeschenStop(arg, ev) {
  ev?.stopPropagation();
  merkpostenLoeschen(arg);
}

/**
 * @param {string} href
 * @param {string} desc
 * @param {Event | undefined} ev
 */
export function openPdfViewerLink(href, desc, ev) {
  ev?.preventDefault();
  openPdfViewer(href, desc || '');
}

export function mQtyDec() {
  const q = G('m-qty');
  q.value = String(Math.max(1, parseInt(q.value || '1', 10) - 1));
  autosaveSet();
}

export function mQtyInc() {
  const q = G('m-qty');
  q.value = String(parseInt(q.value || '1', 10) + 1);
  autosaveSet();
}

// ── Handler beim Dispatcher anmelden (siehe js/registry.js) ──────────────
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
