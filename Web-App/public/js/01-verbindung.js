import { tRaw } from '../i18n.js';
import { toast } from './01-meldungen.js';
import { fmtDatum } from './01-format.js';

// Verbindungsband und Sperre der schreibenden Knöpfe ohne Netz. Die API-Hülle meldet hier jede
// Antwort und jeden Netzfehler; die Ansichten wissen davon nichts.

// ── Verbindung ──────────────────────────────────────────────────────────────
// Ohne Netz zeigt die Seite weiter den letzten Stand. Das Band sagt, dass es
// einer ist und von wann — sonst hält man alte Zahlen für aktuell.
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
    if (_offline) document.querySelectorAll('.tab.active .fehler-zustand [data-lesend]').forEach(k => /** @type {HTMLElement} */ (k).click());
    _offline = false; band.hidden = true; return;
  }
  _offline = true;
  const heute = _letzteAntwort && new Date(_letzteAntwort).toDateString() === new Date().toDateString();
  const seit = heute ? tRaw('net.heute', { zeit: fmtDatum(_letzteAntwort, 'zeit') }) : fmtDatum(_letzteAntwort, 'tagzeit');
  band.textContent = (_letzteAntwort ? tRaw('net.offline_since', { zeit: seit }) : tRaw('net.offline'))
    + ' ' + tRaw('net.offline_gesperrt');
  band.hidden = false;
  schreibenSperren(true);
}

// Ohne Verbindung scheitert jede Änderung. Statt erst nach dem Klick eine
// Meldung zu zeigen, sind die schreibenden Bedienelemente gesperrt und nennen
// per aria-describedby das Band als Grund. Eine Regel statt einer Liste:
// Hauptknöpfe, Datei-Wahl, Import-Menüs und jede Handlung, deren Name schreibt.
const BEDIENT = 'button, input[type=file], .import-menue > summary';

const IMMER_SCHREIBEND = 'button.bp, button.bd, input[type=file], .import-menue > summary';

const SCHREIB_VERBEN = /speicher|save|loesch|delete|import|hinzufueg|add|anleg|erfass|uebernehm|eintrag|abfrag|aktualis|refresh|sync|hochlad|upload|rotier|widerruf|einlad|verknuepf|aendere|bearbeit|entfern|wiederherst|restore|generier|erzeug|verschieb|qty|menge|alarm/i;

const NICHT_SPERREN = '#login-screen, .toast, [data-dialog-zu], .hinweis-zu, [data-lesend]';

/** @param {Element} k */
function schreibt(k) {
  if (k.closest(NICHT_SPERREN)) return false;
  if (k.matches(IMMER_SCHREIBEND)) return true;
  return SCHREIB_VERBEN.test(`${k.getAttribute('data-click') || ''} ${k.getAttribute('data-submit') || ''}`);
}

/** @type {MutationObserver|null} */
let _sperrBeobachter = null;

/** @param {Element|Document} wurzel */
function sperreIn(wurzel) {
  const selbst = wurzel instanceof Element && wurzel.matches(BEDIENT) ? [wurzel] : [];
  /** @type {HTMLButtonElement[]} */ ([...selbst, ...wurzel.querySelectorAll(BEDIENT)]).forEach(k => {
    if (k.disabled || k.dataset.offlineGesperrt || !schreibt(k)) return;
    if (k.tagName === 'SUMMARY') { k.setAttribute('aria-disabled', 'true'); k.parentElement?.removeAttribute('open'); }
    else k.disabled = true;
    k.dataset.offlineGesperrt = '1';
    k.setAttribute('aria-describedby', ((k.getAttribute('aria-describedby') || '') + ' offline-band').trim());
  });
}

// Ein <summary> kennt kein disabled: Klick und Tastatur öffnen es sonst trotzdem.
if (typeof document !== 'undefined')
  document.addEventListener('click', e => {
    const t = /** @type {Element} */ (e.target);
    if (t?.closest?.('summary[data-offline-gesperrt]')) { e.preventDefault(); e.stopPropagation(); }
  }, true);

/** @param {boolean} an */
function schreibenSperren(an) {
  if (typeof document === 'undefined') return;
  document.documentElement.toggleAttribute('data-offline', an);
  if (an) {
    sperreIn(document);
    if (!_sperrBeobachter && typeof MutationObserver !== 'undefined') {
      _sperrBeobachter = new MutationObserver(m => { for (const x of m) for (const n of x.addedNodes) if (n.nodeType === 1) sperreIn(/** @type {Element} */ (n)); });
      _sperrBeobachter.observe(document.body, { childList: true, subtree: true });
    }
    return;
  }
  _sperrBeobachter?.disconnect(); _sperrBeobachter = null;
  /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('[data-offline-gesperrt]')).forEach(k => {
    if (k.tagName === 'SUMMARY') k.removeAttribute('aria-disabled'); else k.disabled = false;
    delete k.dataset.offlineGesperrt;
    const rest = (k.getAttribute('aria-describedby') || '').split(/\s+/).filter(x => x && x !== 'offline-band');
    if (rest.length) k.setAttribute('aria-describedby', rest.join(' ')); else k.removeAttribute('aria-describedby');
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
