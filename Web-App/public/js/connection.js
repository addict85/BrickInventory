import { tRaw } from '../i18n.js';
import { toast } from './messages.js';
import { fmtDate } from './format.js';

// Connection banner and locking of writing buttons without network. The API wrapper reports every response and
// every network error here; the views know nothing about it.

// ── Connection ──────────────────────────────────────────────────────────────
// Without network the page keeps showing the last state. The banner says that it is one and from when — otherwise
// one takes old numbers for current ones.
/** @type {Date | null} */
let _lastResponse = null;

let _offline = false;

/** @param {boolean} reachable */
export function showConnection(reachable) {
  if (reachable && typeof navigator !== 'undefined' && navigator.onLine === false) reachable = false;
  const band = typeof document !== 'undefined' ? document.getElementById('offline-band') : null;
  if (!band) return;
  if (reachable) {
    if (_offline) toast(tRaw('net.back'), 'success');
    if (_offline) lockWrites(false);
    // Whatever could not load without network now loads by itself.
    if (_offline)
      document.querySelectorAll('.tab.active .error-state [data-reading]').forEach(k => {
        /** @type {HTMLElement} */ (k).click();
      });
    _offline = false;
    band.hidden = true;
    return;
  }
  _offline = true;
  const today = _lastResponse && new Date(_lastResponse).toDateString() === new Date().toDateString();
  const since = today
    ? tRaw('net.today', { time: fmtDate(_lastResponse, 'time') })
    : fmtDate(_lastResponse, 'datetime');
  band.textContent =
    (_lastResponse ? tRaw('net.offline_since', { time: since }) : tRaw('net.offline')) +
    ' ' +
    tRaw('net.offline_locked');
  band.hidden = false;
  lockWrites(true);
}

// Without a connection every change fails. Instead of showing a message only after the click, the
// writing controls are locked and name the banner as the reason via aria-describedby. Whether a button
// writes is decided by its action, not by its name: a word in the name missed handlers like revokeToken.
// Every registered action is in exactly one of the two lists (test/offline-rating-ui.test.js).
// Fields that save on change (autosave) count as well: offline their input would be lost without a word.
const SERVED = 'button, input[type=file], .import-menu > summary, [data-click], [data-change], [data-input]';

/**
 * Handlers that change server state via POST/PUT/PATCH/DELETE (also via another handler), plus the
 * openers of forms that can only save (capture, edit, adopt): filled in offline,
 * the input would be lost.
 */
export const WRITING_ACTIONS = new Set([
  'acqDelete',
  'acqSave',
  'changeAlertThreshold',
  'alertTyped',
  'cancelJob',
  'runJobKindNow',
  'emptyJobKind',
  'autosaveSet',
  'renameLocation',
  'confirmTakeover',
  'resendConfirmation',
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
  'setupPassword',
  'setupSource',
  'queryBalance',
  'queryAllBalances',
  'editVoucher',
  'saveVoucherCountry',
  'deleteVoucher',
  'saveVoucher',
  'importAlertsCsv',
  'importConfig',
  'importFigsCsv',
  'importWantedCsv',
  'importPartsCsv',
  'catalogToWanted',
  'unlockAccount',
  'locationSelected',
  'locationKeydown',
  'createAlert',
  'createLocation',
  'deleteAlert',
  'deleteLocation',
  'manAcqDelete',
  'manAcqSave',
  'manQtyChange',
  'manQtySave',
  'quantityPerAccount',
  'deleteWantedDetail',
  'takeOverWantedDetail',
  'addWantedItem',
  'wantedOwnerSelected',
  'deleteWantedItem',
  'stopDeleteWantedItem',
  'takeOverWantedItem',
  'mQtyDec',
  'mQtyInc',
  'openCapture',
  'openRpw',
  'deleteFromTrashPermanently',
  'emptyTrash',
  'restoreFromTrash',
  'passkeyLogin',
  'addPasskey',
  'deletePasskey',
  'passkeySecondFactor',
  'plFillStock',
  'rejectQrPairing',
  'confirmQrPairing',
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
  'toggleLocationDefault',
  'setLangFromEl',
  'setOwnDesign',
  'saveAlert',
  'saveAppDesign',
  'saveCacheTtl',
  'saveSetLocation',
  'saveStandardState',
  'savePartColor',
  'savePartLocation',
  'saveCurrency',
  'saveState',
  'startSetCsvImport',
  'reimportOpenSetParts',
  'toggleAdmin',
  'toggleActive',
  'triggerCsvSync',
  'unlinkFromParent',
  'unlinkHousehold',
  'uploadInstr',
  'writeWantedXml',
  'disableSecondFactor',
  'confirmSecondFactor',
  'setupSecondFactor',
  'newRecoveryCodes',
  'resetSecondFactor',
]);

// Reading, checking without saving (test source, preview, plaintext) and everything purely local stays free offline.
// setupNext only reports "done" in the last step; before that it only pages.
export const READING_ACTIONS = new Set([
  'chooseView',
  'userMenu',
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
  'checkSetup',
  'setupLater',
  'setupStatusNew',
  'closeSetupStatus',
  'setupNext',
  'setupTarget',
  'setupBack',
  'settingsSection',
  'checkSettingsSource',
  'captureForSet',
  'focusField',
  'filterFigs',
  'toggleFilter',
  'resetFilter',
  'finFilter',
  'finSort',
  'finSearch',
  'toggleSecret',
  'gibToggle',
  'cancelVoucher',
  'voucherFileSelected',
  'exportVouchers',
  'copyVoucher',
  'openVoucherPdf',
  'toggleVoucherPin',
  'hideProgress',
  'jumpToAccount',
  'loadVouchers',
  'loadWanted',
  'loadPasskeys',
  'loadSecondFactor',
  'locationTyped',
  'lightboxBackdrop',
  'loadCatalogSets',
  'loadFinance',
  'loadGallery',
  'loadMinifigs',
  'loadParts',
  'loadPortfolioChart',
  'loadTokens',
  'openWantedDetail',
  'openTab',
  'openView',
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
  'openSetFromItem',
  'openSetItemDetail',
  'pdfZoomIn',
  'pdfZoomOut',
  'pdfZoomReset',
  'requiredLogout',
  'plAddSet',
  'plExportBricklink',
  'plExportPdf',
  'plGenerate',
  'plRemoveSet',
  'plReset',
  'printPdfViewer',
  'openRbHint',
  'dismissRbHint',
  'renderFigsAll',
  'renderGallery',
  'closeCapture',
  'closeWantedDetail',
  'closeTakeover',
  'setCatFilter',
  'setChartPeriod',
  'setColorFilter',
  'sortSets',
  'setDark',
  'showPanel',
  'viewFromDialog',
  'stopEvent',
  'toggleBricksetQueue',
  'updateColorDot',
  'checkCurrency',
  'wantedCorrectionColor',
  'wantedCorrectionNumber',
  'wantedCorrectionValue',
  'wantedXmlSelected',
  'rereadWantedXml',
  'closeWantedXml',
  'toggleAlertState',
  'showLastImport',
  'copyRecoveryCodes',
  'saveRecoveryCodes',
  'secondFactorRequiredDone',
  'copySecondFactorKey',
]);

// File choice and import menu always lead to an upload; buttons without data-click (wired by id)
// carry data-writing in the markup. Login needs no lock offline, it shows its own error.
const ALWAYS_WRITING = 'input[type=file], .import-menu > summary, [data-writing]';

const NOT_LOCK = '#login-screen, .toast';

/** @param {Element} k */
function writes(k) {
  if (k.closest(NOT_LOCK)) return false;
  if (k.matches(ALWAYS_WRITING)) return true;
  return ['data-click', 'data-change', 'data-input'].some(a => WRITING_ACTIONS.has(k.getAttribute(a) || ''));
}

/** @type {MutationObserver|null} */
let _lockObserver = null;

/** @param {Element|Document} root */
function lockWithin(root) {
  const self = root instanceof Element && root.matches(SERVED) ? [root] : [];
  /** @type {HTMLElement[]} */ ([...self, ...root.querySelectorAll(SERVED)]).forEach(k => {
    if ((knowsDisabled(k) && k.disabled) || k.dataset.offlineLocked || !writes(k)) return;
    if (knowsDisabled(k)) k.disabled = true;
    else {
      k.setAttribute('aria-disabled', 'true');
      if (k.tagName === 'SUMMARY') k.parentElement?.removeAttribute('open');
    }
    k.dataset.offlineLocked = '1';
    k.setAttribute('aria-describedby', ((k.getAttribute('aria-describedby') || '') + ' offline-band').trim());
  });
}

/**
 * @param {Element} k
 * @returns {k is HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement}
 */
function knowsDisabled(k) {
  return (
    k instanceof HTMLButtonElement ||
    k instanceof HTMLInputElement ||
    k instanceof HTMLSelectElement ||
    k instanceof HTMLTextAreaElement
  );
}

// <summary> and the tiles' delete cross (<span>) know no disabled: click and keyboard would otherwise still
// trigger them. Intercepted before the event delegation in actions.js.
if (typeof document !== 'undefined')
  document.addEventListener(
    'click',
    e => {
      const t = /** @type {Element} */ (e.target);
      if (t?.closest?.('[data-offline-locked][aria-disabled]')) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true,
  );

/** @param {boolean} on */
function lockWrites(on) {
  if (typeof document === 'undefined') return;
  document.documentElement.toggleAttribute('data-offline', on);
  if (on) {
    lockWithin(document);
    if (!_lockObserver && typeof MutationObserver !== 'undefined') {
      _lockObserver = new MutationObserver(m => {
        for (const x of m) for (const n of x.addedNodes) if (n.nodeType === 1) lockWithin(/** @type {Element} */ (n));
      });
      _lockObserver.observe(document.body, { childList: true, subtree: true });
    }
    return;
  }
  _lockObserver?.disconnect();
  _lockObserver = null;
  /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('[data-offline-locked]')).forEach(k => {
    if (knowsDisabled(k)) k.disabled = false;
    else k.removeAttribute('aria-disabled');
    delete k.dataset.offlineLocked;
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
