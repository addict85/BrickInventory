import { tRaw } from '../i18n.js';
import { toast } from './messages.js';
import { fmtDatum } from './format.js';

// Verbindungsband und Sperre der schreibenden Knöpfe ohne Netz. Die API-Hülle meldet hier jede Antwort und
// jeden Netzfehler; die Ansichten wissen davon nichts.

// ── Verbindung ──────────────────────────────────────────────────────────────
// Ohne Netz zeigt die Seite weiter den letzten Stand. Das Band sagt, dass es einer ist und von wann — sonst
// hält man alte Zahlen für aktuell.
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
    // Was ohne Netz nicht laden konnte, lädt jetzt von selbst.
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

// Ohne Verbindung scheitert jede Änderung. Statt erst nach dem Klick eine Meldung zu zeigen, sind die
// schreibenden Bedienelemente gesperrt und nennen per aria-describedby das Band als Grund. Ob ein Knopf
// schreibt, entscheidet seine Aktion, nicht ihr Name: Ein Wort im Namen verfehlte Handler wie revokeToken.
// Jede angemeldete Aktion steht in genau einer der beiden Listen (test/offline-einstufung-oberflaeche.test.js).
const SERVED = 'button, input[type=file], .import-menue > summary, [data-click]';

/**
 * Handler, die per POST/PUT/PATCH/DELETE Serverzustand ändern (auch über einen anderen Handler), dazu die
 * Öffner von Formularen, die nur speichern können (Erfassen, Bearbeiten, Übernehmen): Offline ausgefüllt,
 * wäre die Eingabe verloren.
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

// Lesen, Prüfen ohne Speichern (Quelle testen, Vorschau, Klartext) und alles nur Lokale bleibt offline frei.
// einrichtungWeiter meldet erst im letzten Schritt „fertig“; davor blättert es nur.
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

// Datei-Wahl und Import-Menü führen immer zu einem Hochladen; Knöpfe ohne data-click (per id verdrahtet)
// tragen data-schreibend im Markup. Die Anmeldung braucht offline keine Sperre, sie zeigt ihren eigenen Fehler.
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

// <summary> und das Löschkreuz der Kacheln (<span>) kennen kein disabled: Klick und Tastatur lösten sie sonst
// trotzdem aus. Abgefangen wird vor der Ereignis-Delegation in actions.js.
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

/** Eine Antwort kam an: Zeitpunkt merken (für „Stand von …“) und das Band abräumen. */
export function receiveResponse() {
  _lastResponse = new Date();
  showConnection(true);
}
