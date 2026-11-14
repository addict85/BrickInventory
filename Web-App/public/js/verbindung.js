import { tRaw } from '../i18n.js';
import { toast } from './meldungen.js';
import { fmtDatum } from './format.js';

// Verbindungsband und Sperre der schreibenden Knöpfe ohne Netz. Die API-Hülle meldet hier jede Antwort und
// jeden Netzfehler; die Ansichten wissen davon nichts.

// ── Verbindung ──────────────────────────────────────────────────────────────
// Ohne Netz zeigt die Seite weiter den letzten Stand. Das Band sagt, dass es einer ist und von wann — sonst
// hält man alte Zahlen für aktuell.
/** @type {Date | null} */
let _letzteAntwort = null;

let _offline = false;

/** @param {boolean} erreichbar */
export function zeigeVerbindung(erreichbar) {
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
  const heute = _letzteAntwort && new Date(_letzteAntwort).toDateString() === new Date().toDateString();
  const seit = heute
    ? tRaw('net.heute', { zeit: fmtDatum(_letzteAntwort, 'zeit') })
    : fmtDatum(_letzteAntwort, 'tagzeit');
  band.textContent =
    (_letzteAntwort ? tRaw('net.offline_since', { zeit: seit }) : tRaw('net.offline')) +
    ' ' +
    tRaw('net.offline_gesperrt');
  band.hidden = false;
  schreibenSperren(true);
}

// Ohne Verbindung scheitert jede Änderung. Statt erst nach dem Klick eine Meldung zu zeigen, sind die
// schreibenden Bedienelemente gesperrt und nennen per aria-describedby das Band als Grund. Ob ein Knopf
// schreibt, entscheidet seine Aktion, nicht ihr Name: Ein Wort im Namen verfehlte Handler wie revokeToken.
// Jede angemeldete Aktion steht in genau einer der beiden Listen (test/offline-einstufung-oberflaeche.test.js).
const BEDIENT = 'button, input[type=file], .import-menue > summary, [data-click]';

/**
 * Handler, die per POST/PUT/PATCH/DELETE Serverzustand ändern (auch über einen anderen Handler), dazu die
 * Öffner von Formularen, die nur speichern können (Erfassen, Bearbeiten, Übernehmen): Offline ausgefüllt,
 * wäre die Eingabe verloren.
 */
export const SCHREIBENDE_AKTIONEN = new Set([
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
export const LESENDE_AKTIONEN = new Set([
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
]);

// Datei-Wahl und Import-Menü führen immer zu einem Hochladen; Knöpfe ohne data-click (per id verdrahtet)
// tragen data-schreibend im Markup. Die Anmeldung braucht offline keine Sperre, sie zeigt ihren eigenen Fehler.
const IMMER_SCHREIBEND = 'input[type=file], .import-menue > summary, [data-schreibend]';

const NICHT_SPERREN = '#login-screen, .toast';

/** @param {Element} k */
function schreibt(k) {
  if (k.closest(NICHT_SPERREN)) return false;
  if (k.matches(IMMER_SCHREIBEND)) return true;
  return SCHREIBENDE_AKTIONEN.has(k.getAttribute('data-click') || '');
}

/** @type {MutationObserver|null} */
let _sperrBeobachter = null;

/** @param {Element|Document} wurzel */
function sperreIn(wurzel) {
  const selbst = wurzel instanceof Element && wurzel.matches(BEDIENT) ? [wurzel] : [];
  /** @type {HTMLElement[]} */ ([...selbst, ...wurzel.querySelectorAll(BEDIENT)]).forEach(k => {
    if ((kenntDisabled(k) && k.disabled) || k.dataset.offlineGesperrt || !schreibt(k)) return;
    if (kenntDisabled(k)) k.disabled = true;
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
function kenntDisabled(k) {
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
    if (!_sperrBeobachter && typeof MutationObserver !== 'undefined') {
      _sperrBeobachter = new MutationObserver(m => {
        for (const x of m) for (const n of x.addedNodes) if (n.nodeType === 1) sperreIn(/** @type {Element} */ (n));
      });
      _sperrBeobachter.observe(document.body, { childList: true, subtree: true });
    }
    return;
  }
  _sperrBeobachter?.disconnect();
  _sperrBeobachter = null;
  /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('[data-offline-gesperrt]')).forEach(k => {
    if (kenntDisabled(k)) k.disabled = false;
    else k.removeAttribute('aria-disabled');
    delete k.dataset.offlineGesperrt;
    const rest = (k.getAttribute('aria-describedby') || '').split(/\s+/).filter(x => x && x !== 'offline-band');
    if (rest.length) k.setAttribute('aria-describedby', rest.join(' '));
    else k.removeAttribute('aria-describedby');
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => zeigeVerbindung(false));
  window.addEventListener('online', () => zeigeVerbindung(true));
}

/** Eine Antwort kam an: Zeitpunkt merken (für „Stand von …“) und das Band abräumen. */
export function antwortErhalten() {
  _letzteAntwort = new Date();
  zeigeVerbindung(true);
}
