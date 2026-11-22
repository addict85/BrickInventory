import { tRaw } from '../i18n.js';
import { toast } from './messages.js';
import { fmtDatum } from './format.js';

// Connection banner and locking of writing buttons without network. The API wrapper reports every response and
// every network error here; the views know nothing about it.

// ── Connection ──────────────────────────────────────────────────────────────
// Without network the page keeps showing the last state. The banner says that it is one and from when — otherwise
// one takes old numbers for current ones.
/** @type {Date | null} */
let _lastResponse = null;

let _offline = false;

/** @param {boolean} erreichbar */
export function showConnection(erreichbar) {
  if (erreichbar && typeof navigator !== 'undefined' && navigator.onLine === false) erreichbar = false;
  const band = typeof document !== 'undefined' ? document.getElementById('offline-band') : null;
  if (!band) return;
  if (erreichbar) {
    if (_offline) toast(tRaw('net.back'), 'success');
    if (_offline) schreibenSperren(false);
    // Whatever could not load without network now loads by itself.
    if (_offline)
      document.querySelectorAll('.tab.active .fehler-zustand [data-lesend]').forEach(k => {
        /** @type {HTMLElement} */ (k).click();
      });
    _offline = false;
    band.hidden = true;
    return;
  }
  _offline = true;
  const heute = _lastResponse && new Date(_lastResponse).toDateString() === new Date().toDateString();
  const seit = heute
    ? tRaw('net.heute', { zeit: fmtDatum(_lastResponse, 'zeit') })
    : fmtDatum(_lastResponse, 'tagzeit');
  band.textContent =
    (_lastResponse ? tRaw('net.offline_since', { zeit: seit }) : tRaw('net.offline')) +
    ' ' +
    tRaw('net.offline_gesperrt');
  band.hidden = false;
  schreibenSperren(true);
}

// Without a connection every change fails. Instead of showing a message only after the click, the
// writing controls are locked and name the banner as the reason via aria-describedby. Whether a button
// writes is decided by its action, not by its name: a word in the name missed handlers like revokeToken.
// Every registered action is in exactly one of the two lists (test/offline-rating-ui.test.js).
const SERVED = 'button, input[type=file], .import-menue > summary, [data-click]';

/**
 * Handlers that change server state via POST/PUT/PATCH/DELETE (also via another handler), plus the
 * openers of forms that can only save (capture, edit, adopt): filled in offline,
 * the input would be lost.
 */
export const WRITING_ACTIONS = new Set([
  'acqDelete',
  'acqSave',
  'aendereAlarmSchwelle',
  'alarmGetippt',
  'auftragAbbrechen',
  'auftragsArtJetzt',
  'auftragsArtLeeren',
  'autosaveSet',
  'benenneLagerortUm',
  'bestaetigeUebernahme',
  'bestaetigungErneut',
  'clickJobTrigger',
  'createHouseholdInvite',
  'deleteBricksetQueueEntry',
  'deleteManualFig',
  'deleteManualFigStop',
  'deleteManualPartStop',
  'delInstr',
  'delSet',
  'delSetStop',
  'delUser',
  'dismissFormerLink',
  'einrichtungPasswort',
  'einrichtungQuelle',
  'guthabenAbfragen',
  'guthabenAlleAbfragen',
  'gutscheinBearbeiten',
  'gutscheinLandSpeichern',
  'gutscheinLoeschen',
  'gutscheinSpeichern',
  'importAlarmeCsv',
  'importConfig',
  'importFigsCsv',
  'importMerklisteCsv',
  'importPartsCsv',
  'katalogAufMerkliste',
  'kontoFreischalten',
  'lagerortGewaehlt',
  'lagerortTaste',
  'legeAlarmAn',
  'legeLagerortAn',
  'loescheAlarm',
  'loescheLagerort',
  'manAcqDelete',
  'manAcqSave',
  'manQtyChange',
  'manQtySave',
  'mengeJeKonto',
  'merkpostenDetailLoeschen',
  'merkpostenDetailUebernehmen',
  'merkpostenHinzufuegen',
  'merkpostenInhaberGewaehlt',
  'merkpostenLoeschen',
  'merkpostenLoeschenStop',
  'merkpostenUebernehmen',
  'mQtyDec',
  'mQtyInc',
  'oeffneErfassen',
  'openRpw',
  'papierkorbEndgueltig',
  'papierkorbLeeren',
  'papierkorbWiederherstellen',
  'passkeyAnmelden',
  'passkeyHinzufuegen',
  'passkeyLoeschen',
  'passkeyZweiterFaktor',
  'plFuelleBestand',
  'qrKopplungAblehnen',
  'qrKopplungBestaetigen',
  'queueCatalogImages',
  'redeemHouseholdInvite',
  'redownloadInstr',
  'redownloadMissingImages',
  'reimportMissingInstructions',
  'reimportParts',
  'retryBricksetQueueEntry',
  'revokeOtherTokens',
  'revokeToken',
  'saveJobMinutes',
  'saveJobTime',
  'saveManualFigBl',
  'saveRegEnabled',
  'schalteLagerortVorgabe',
  'setLangFromEl',
  'setzeEigenesDesign',
  'speichereAlarm',
  'speichereAppDesign',
  'speichereCacheTtl',
  'speichereSetLagerort',
  'speichereStandardZustand',
  'speichereTeilFarbe',
  'speichereTeilLagerort',
  'speichereWaehrung',
  'speichereZustand',
  'startSetCsvImport',
  'teileNeuImportieren',
  'toggleAdmin',
  'toggleAktiv',
  'triggerCsvSync',
  'unlinkFromParent',
  'unlinkHousehold',
  'uploadInstr',
  'wantedXmlSchreiben',
  'zfAbschalten',
  'zfBestaetigen',
  'zfEinrichten',
  'zfNeueCodes',
  'zfZuruecksetzen',
]);

// Reading, checking without saving (test source, preview, plaintext) and everything purely local stays free offline.
// einrichtungWeiter only reports "done" in the last step; before that it only pages.
export const READING_ACTIONS = new Set([
  'ansichtWaehlen',
  'benutzerMenue',
  'blurOnEnter',
  'closeAcqModal',
  'closeCatModal',
  'closeImageLightbox',
  'closeImportProgress',
  'closeManDetail',
  'closeModal',
  'closePdfViewer',
  'closePwModal',
  'closeSetItemDetail',
  'copyHouseholdInvite',
  'einrichtungPruefen',
  'einrichtungSpaeter',
  'einrichtungStandNeu',
  'einrichtungStandSchliessen',
  'einrichtungWeiter',
  'einrichtungZiel',
  'einrichtungZurueck',
  'einstAbschnitt',
  'einstellungenQuellePruefen',
  'erfassenZumSet',
  'feldFokussieren',
  'filterFigs',
  'filterUmschalten',
  'filterZuruecksetzen',
  'finFilter',
  'finSortiere',
  'finSuchen',
  'geheimUmschalten',
  'gibToggle',
  'gutscheinAbbrechen',
  'gutscheinDateiGewaehlt',
  'gutscheineExportieren',
  'gutscheinKopieren',
  'gutscheinPdfOeffnen',
  'gutscheinPinUmschalten',
  'hideProgress',
  'kontoSprung',
  'ladeGutscheine',
  'ladeMerkliste',
  'ladePasskeys',
  'ladeZweitenFaktor',
  'lagerortGetippt',
  'lightboxBackdrop',
  'loadCatalogSets',
  'loadFinance',
  'loadGallery',
  'loadMinifigs',
  'loadParts',
  'loadPortfolioChart',
  'loadTokens',
  'oeffneMerkpostenDetail',
  'oeffneReiter',
  'oeffneSicht',
  'onScopeChange',
  'onStorageChange',
  'openAcqModal',
  'openCatModal',
  'openImageLightboxFromEl',
  'openLogViewer',
  'openManAcqModal',
  'openManDetail',
  'openModal',
  'openPdfViewerLink',
  'openSetAusItem',
  'openSetItemDetail',
  'pdfZoomIn',
  'pdfZoomOut',
  'pdfZoomReset',
  'pflichtAbmelden',
  'plAddSet',
  'plExportBricklink',
  'plExportPdf',
  'plGenerate',
  'plRemoveSet',
  'plReset',
  'printPdfViewer',
  'rbHinweisOeffnen',
  'rbHinweisWeg',
  'renderFigsAll',
  'renderGallery',
  'schliesseErfassen',
  'schliesseMerkpostenDetail',
  'schliesseUebernahme',
  'setCatFilter',
  'setChartPeriod',
  'setColorFilter',
  'setsSortieren',
  'setzeDunkel',
  'showPanel',
  'sichtAusDialog',
  'stopEvent',
  'toggleBricksetQueue',
  'updateColorDot',
  'waehrungPruefen',
  'wantedKorrekturFarbe',
  'wantedKorrekturNummer',
  'wantedKorrekturWert',
  'wantedXmlGewaehlt',
  'wantedXmlNeuLesen',
  'wantedXmlSchliessen',
  'wechsleAlarmZustand',
  'zeigeLetztenImport',
  'zfCodesKopieren',
  'zfCodesSpeichern',
  'zfPflichtFertig',
  'zfSchluesselKopieren',
]);

// File choice and import menu always lead to an upload; buttons without data-click (wired by id)
// carry data-schreibend in the markup. Login needs no lock offline, it shows its own error.
const ALWAYS_WRITING = 'input[type=file], .import-menue > summary, [data-schreibend]';

const NOT_LOCK = '#login-screen, .toast';

/** @param {Element} k */
function schreibt(k) {
  if (k.closest(NOT_LOCK)) return false;
  if (k.matches(ALWAYS_WRITING)) return true;
  return WRITING_ACTIONS.has(k.getAttribute('data-click') || '');
}

/** @type {MutationObserver|null} */
let _lockObserver = null;

/** @param {Element|Document} wurzel */
function sperreIn(wurzel) {
  const selbst = wurzel instanceof Element && wurzel.matches(SERVED) ? [wurzel] : [];
  /** @type {HTMLElement[]} */ ([...selbst, ...wurzel.querySelectorAll(SERVED)]).forEach(k => {
    if ((knowsDisabled(k) && k.disabled) || k.dataset.offlineGesperrt || !schreibt(k)) return;
    if (knowsDisabled(k)) k.disabled = true;
    else {
      k.setAttribute('aria-disabled', 'true');
      if (k.tagName === 'SUMMARY') k.parentElement?.removeAttribute('open');
    }
    k.dataset.offlineGesperrt = '1';
    k.setAttribute('aria-describedby', ((k.getAttribute('aria-describedby') || '') + ' offline-band').trim());
  });
}

/**
 * @param {Element} k
 * @returns {k is HTMLButtonElement | HTMLInputElement}
 */
function knowsDisabled(k) {
  return k instanceof HTMLButtonElement || k instanceof HTMLInputElement;
}

// <summary> and the tiles' delete cross (<span>) know no disabled: click and keyboard would otherwise still
// trigger them. Intercepted before the event delegation in actions.js.
if (typeof document !== 'undefined')
  document.addEventListener(
    'click',
    e => {
      const t = /** @type {Element} */ (e.target);
      if (t?.closest?.('[data-offline-gesperrt][aria-disabled]')) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true,
  );

/** @param {boolean} an */
function schreibenSperren(an) {
  if (typeof document === 'undefined') return;
  document.documentElement.toggleAttribute('data-offline', an);
  if (an) {
    sperreIn(document);
    if (!_lockObserver && typeof MutationObserver !== 'undefined') {
      _lockObserver = new MutationObserver(m => {
        for (const x of m) for (const n of x.addedNodes) if (n.nodeType === 1) sperreIn(/** @type {Element} */ (n));
      });
      _lockObserver.observe(document.body, { childList: true, subtree: true });
    }
    return;
  }
  _lockObserver?.disconnect();
  _lockObserver = null;
  /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('[data-offline-gesperrt]')).forEach(k => {
    if (knowsDisabled(k)) k.disabled = false;
    else k.removeAttribute('aria-disabled');
    delete k.dataset.offlineGesperrt;
    const rest = (k.getAttribute('aria-describedby') || '').split(/\s+/).filter(x => x && x !== 'offline-band');
    if (rest.length) k.setAttribute('aria-describedby', rest.join(' '));
    else k.removeAttribute('aria-describedby');
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => showConnection(false));
  window.addEventListener('online', () => showConnection(true));
}

/** A response arrived: remember the time (for "state of …") and clear the banner. */
export function receiveResponse() {
  _lastResponse = new Date();
  showConnection(true);
}
