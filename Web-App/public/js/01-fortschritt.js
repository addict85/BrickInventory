// ── CSV-Import-Fortschrittsbalken (der Balken im Kopf der Seite) ─────────────
//
// ── Warum eine eigene Datei (Nachtrag 141) ──────────────────────────────────
//
// Der Block lag in js/01-core.js und war dort mit 211 Zeilen der zweitgrösste
// zusammenhängende Gegenstand. Er ist geschlossen: zwölf Namen, von denen drei
// nach aussen gebraucht werden — der Rest ist Innenleben (zwei Zeitgeber, ein
// EventSource, zwei Merker). Genau deshalb fiel er beim Lesen von 01-core.js
// nie auf: Wer dort nach esc() oder api() sucht, scrollt an 211 Zeilen
// Fortschrittsanzeige vorbei, ohne dass sie ihn etwas angingen.
//
// Diese Datei greift nach unten: sie holt aus 01-core.js nur Allgemeingut (G,
// api, ME) und aus 02-gallery.js die Ladefunktionen. Umgekehrt ruft 01-core.js
// GENAU ZWEI Namen von hier — gibCheckOnLoad() beim Anmelden und
// gibZuruecksetzen() beim Abmelden. Das ist ein Ring, und er ist Absicht: Der
// Balken hängt an der Sitzung, also muss die Sitzung ihn starten und stoppen
// können. Entscheidend ist, dass es zwei benannte Funktionen sind und nicht
// fünf Variablen — vorher stand das Innenleben des Balkens in showLogin()
// ausgeschrieben, und wer eine sechste Variable hinzufügte, musste daran
// denken. ES-Module tragen den Ring (01-core.js und 02-gallery.js bilden
// längst denselben); kritisch wäre nur ein const-Zugriff während der
// Auswertung, und den gibt es hier nicht.
import { registerActions } from './00-registry.js';
import { G, ME, api } from './01-core.js';
import { _csvPollActive, hideProgress, loadGallery, loadStats, showProgress } from './02-gallery.js';
import { t, tRaw } from '../i18n.js';

// ── Global CSV Import Progress Bar ───────────────────────────────────────────
export let _gibTimer       = null;   // Polling-Fallback-Timer (nur wenn SSE scheitert)
export let _gibSse         = null;   // aktive EventSource (SSE), falls verfügbar
let _gibExpanded    = false;
let _gibLastCount   = 0;

// Rendert einen Import-Status ins UI. Quelle (SSE oder Polling) ist egal.
function gibApplyStatus(s) {
  if (!s || !s.success || !s.status) { gibStop(); return; }

  const running = s.status === 'running' || s.status === 'pending';
  const done    = s.done || 0;
  const total   = s.total || 0;
  const pct     = total > 0 ? Math.round(done / total * 100) : 0;

  // Update header bar
  const _gibEl = G('global-import-bar');
  if (_gibEl) {
    if (running) _gibEl.style.display = 'flex';
    G('gib-fill').style.width = pct + '%';
    G('gib-text').textContent = running
      ? `${done}/${total} (${pct}%)`
      : `✅ ${s.ok} ok${s.warn ? ', '+s.warn+' ⚠️' : ''}${s.err ? ', '+s.err+' ❌' : ''}`;
  }

  // Update overlay whenever it's open (both browser 1 minimized+reopened, and browser 2)
  const overlayOpen = G('progress-overlay')?.classList.contains('open');
  if (overlayOpen) {
    G('prog-title-txt').textContent = tRaw('csv.import_title');
    G('prog-bar').style.width = pct + '%';
    if (running) {
      G('prog-footer').textContent = `${t('csv.sets_progress',{done,total})} (${s.ok} ok${s.warn ? ', '+s.warn+' ⚠️' : ''}${s.err ? ', '+s.err+' ❌' : ''})`;
      if (s.current) G('prog-set-name').textContent = `Verarbeite: ${s.current} (${done}/${total})`;
    } else {
      G('prog-footer').textContent = `${t('csv.finished')} ${s.ok} ok${s.warn ? ', '+s.warn+' '+t('csv.warnings') : ''}${s.err ? ', '+s.err+' '+t('csv.errors') : ''}`;
      G('prog-set-name').textContent = '';
    }
  }

  // Update detail panel
  G('gib-stats').textContent = `${s.ok||0} ✅ · ${s.warn||0} ⚠️ · ${s.err||0} ❌`;
  const gpw = G('gib-prog-wrap');
  if (gpw && running) {
    gpw.style.display = 'block';
    G('gib-panel-fill').style.width = pct + '%';
    G('gib-panel-footer').textContent = `${t('csv.sets_progress',{done,total})} (${pct}%)`;
    if(s.current) G('gib-panel-set').textContent = `Verarbeite: ${s.current}`;
  }
  G('gib-stats').textContent = `${s.ok || 0} ok · ${s.warn || 0} ${t('csv.warnings')} · ${s.err || 0} ${t('csv.errors')}`;

  // Add new log entries — but only if the CSV poll loop isn't already writing them
  // (_csvPollActive = true means this window started the import and the CSV loop handles logs)
  if (!_csvPollActive && s.results && s.results.length > _gibLastCount) {
    s.results.slice(_gibLastCount).forEach(r => {
      if (r.success) gibAddLog('✅ ' + r.set_number + ' – ' + (r.action === 'added' ? t('common.added') : t('common.updated')), true);
      else if (r.isWarning) gibAddLog('⚠️ ' + r.set_number + ': ' + r.error, false);
      else gibAddLog('❌ ' + r.set_number + ': ' + (r.error || t('settings.error')), false);
    });
  }
  if (s.results) _gibLastCount = s.results.length;

  if (!running) {
    // Import done — only hide the header bar, never auto-close the overlay dialog
    setTimeout(() => {
      G('global-import-bar').style.display='none';
      G('import-detail-panel').classList.remove('open');
      _gibExpanded = false;
      // Don't clear log or close overlay — user may still be reading results
    }, 5000);
    // Show close button so user can dismiss the overlay when ready
    const btnClose = G('btn-close-import');
    if (btnClose) btnClose.style.display = '';
    loadGallery(); loadStats();
    gibStop();
  }
}

// Polling-Fallback: einmalig den Status holen und rendern.
async function gibPoll() {
  try {
    const wt = sessionStorage.getItem('webToken');
    const headers = wt ? { 'Authorization': 'Bearer ' + wt } : {};
    const s = await fetch('/api/v1/sets/import/csv/status', { headers, credentials: 'include' }).then(r=>r.json());
    gibApplyStatus(s);
  } catch(_) {}
}

function gibToggle() {
  if (!ME) return;
  const overlay = G('progress-overlay');
  if (overlay && overlay.classList.contains('open')) {
    // Already open — minimize back to header bar
    hideProgress();
  } else if (overlay) {
    // Opening from header bar click — initialize overlay in CSV mode
    // so gibPoll() can write into it (needed when this is a 2nd browser window)
    if (!_csvPollActive) {
      showProgress(t('csv.import_title'), true);
      // Immediately fill with whatever gibPoll already knows
      gibPoll();
    } else {
      // This window already owns the import loop — just re-show
      overlay.classList.add('open');
    }
  }
}


function gibAddLog(text, ok) {
  // Write to both the overlay csv-log AND the gib detail log
  for (const logId of ['csv-log', 'gib-log']) {
    const log = G(logId);
    if (!log) continue;
    const line = document.createElement('div');
    line.className = 'csv-log-line ' + (ok ? 'ok' : 'er');
    line.textContent = text;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }
}

// Startet die Live-Überwachung: bevorzugt SSE, mit automatischem Fallback auf
// Polling, falls der Browser kein EventSource kann oder der Stream scheitert.
export function gibStart() {
  if (_gibSse || _gibTimer) return; // läuft bereits
  _gibLastCount = 0;
  G('gib-log').innerHTML = '';
  G('global-import-bar').style.display = 'flex';
  G('gib-text').textContent = tRaw('csv.running_text');
  G('gib-fill').style.width = '0%';

  // Kein Token in der Adresse. EventSource kann zwar keine Kopfzeile setzen,
  // schickt mit `withCredentials: true` aber das Sitzungs-Cookie — und genau
  // das war schon vorher der Weg, auf dem dieser Kanal wirklich lief. Der
  // angehängte `?token=` war der Sitzungstoken selbst; er hätte im
  // Reverse-Proxy-Protokoll und im Browserverlauf gestanden. Den „Bearer-Fall"
  // ohne Cookie gibt es hier nicht: `webToken` entsteht erst nach der
  // Anmeldung, die das Cookie setzt. Siehe utils/auth.ts.
  const url = '/api/v1/sets/import/csv/stream';

  if (typeof EventSource !== 'undefined') {
    try {
      const es = new EventSource(url, { withCredentials: true });
      _gibSse = es;
      es.onmessage = (e) => {
        try { gibApplyStatus(JSON.parse(e.data)); } catch(_) {}
      };
      es.onerror = () => {
        // Verbindung verloren/abgelehnt → auf Polling zurückfallen,
        // aber nur solange noch kein Fallback läuft.
        es.close();
        if (_gibSse === es) _gibSse = null;
        if (!_gibTimer) { _gibTimer = setInterval(gibPoll, 1500); gibPoll(); }
      };
      return;
    } catch(_) { /* fällt unten auf Polling zurück */ }
  }
  // Kein EventSource verfügbar → Polling
  _gibTimer = setInterval(gibPoll, 1500);
  gibPoll();
}

function gibStop() {
  if (_gibSse)   { try { _gibSse.close(); } catch(_) {} _gibSse = null; }
  if (_gibTimer) { clearInterval(_gibTimer); _gibTimer = null; }
}

// Start polling when app loads (picks up import from any window)
export async function gibCheckOnLoad() {
  if (_gibCheckTimer) return;
  let failures = 0;

  async function doCheck() {
    if (_gibTimer || _gibSse) { clearInterval(_gibCheckTimer); _gibCheckTimer=null; return; }
    // Ohne Anmeldung gibt es nichts zu prüfen — vorher lief die Abfrage auch
    // auf dem Login-Screen im Drei-Sekunden-Takt weiter.
    if (!ME) return;
    try {
      const wt = sessionStorage.getItem('webToken');
      const headers = wt ? { 'Authorization': 'Bearer ' + wt } : {};
      const r = await fetch('/api/v1/sets/import/csv/status', { headers, credentials: 'include' });

      // Antwort erst prüfen, dann parsen. Steht ein Reverse-Proxy oder Tunnel
      // davor, liefert der bei Neustart oder Aussetzer eine HTML-Fehlerseite —
      // r.json() warf dann "Unexpected token '<'". Das ist kein Fehler der
      // App, soll aber auch keinen Stacktrace in der Konsole erzeugen.
      const ct = r.headers.get('content-type') || '';
      if (!r.ok || !ct.includes('application/json')) {
        if (++failures === 3) console.warn('[gibCheck] Antwort ist kein JSON (Status ' + r.status + ') — Abfrage pausiert');
        // Nach mehreren Fehlschlägen langsamer weiterversuchen statt im
        // Drei-Sekunden-Takt gegen eine Wand zu laufen.
        if (failures >= 3 && _gibCheckTimer) {
          clearInterval(_gibCheckTimer);
          _gibCheckTimer = setInterval(doCheck, 30000);
        }
        return;
      }
      failures = 0;
      const s = await r.json();
      if (s.success && (s.status === 'running' || s.status === 'pending')) {
        clearInterval(_gibCheckTimer); _gibCheckTimer=null;
        gibStart();
      }
    } catch(e) {
      if (++failures === 3) console.warn('[gibCheck] nicht erreichbar — Abfrage verlangsamt');
    }
  }
  doCheck(); // fire immediately on login
  _gibCheckTimer = setInterval(doCheck, 3000); // then every 3s
}
let _gibCheckTimer = null;
/**
 * Setzt den Balken auf „nichts läuft" zurück: Anzeige aus, beide Abfragen
 * gestoppt, Protokoll geleert.
 *
 * Warum das eine Funktion ist und nicht beim Abmelden steht (dem einzigen
 * Aufrufer): `_gibCheckTimer` und `_gibLastCount` sind Innenleben dieses
 * Balkens. Wer sie von aussen zurückdreht, muss wissen, welche der fünf
 * Variablen dieser Datei dazugehören — und beim Hinzufügen einer sechsten
 * daran denken. Die Abmeldung soll nur sagen, WAS sie will.
 */
export function gibZuruecksetzen() {
  const balken = G('global-import-bar');
  if (balken) balken.style.display = 'none';
  gibStop();
  if (_gibCheckTimer) { clearInterval(_gibCheckTimer); _gibCheckTimer = null; }
  _gibLastCount = 0;
  const log = G('gib-log');
  if (log) log.innerHTML = '';
}

// ── Handler beim Dispatcher anmelden (siehe js/00-registry.js) ──────────────
// Der Handler gehört zu dem Modul, das ihn umsetzt (Nachtrag 130).
registerActions({
  gibToggle,
});
