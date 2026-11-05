// ── CSV-Import-Fortschrittsbalken (der Balken im Kopf der Seite) ─────────────
//
// ── Warum eine eigene Datei ──────────────────────────────────
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
import { ico, G, apiRoh, fmtPct, api, toast } from './01-core.js';
import { melde } from './00-ereignisse.js';
import { t, tRaw } from '../i18n.js';
import { ME } from './00-zustand.js';

// ── Global CSV Import Progress Bar ───────────────────────────────────────────
/** @type {ReturnType<typeof setInterval> | null} */
let _gibTimer       = null;   // Polling-Fallback-Timer (nur wenn SSE scheitert)
/** @type {EventSource | null} */
let _gibSse         = null;   // aktive EventSource (SSE), falls verfügbar
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
      ? `${done}/${total} (${fmtPct(pct, { vorzeichen: false, stellen: 0 })})`
      : `${s.ok} ok${s.warn ? ', '+s.warn+' '+t('csv.warnings') : ''}${s.err ? ', '+s.err+' '+t('csv.errors') : ''}`;
  }

  // Update overlay whenever it's open (both browser 1 minimized+reopened, and browser 2)
  const overlayOpen = G('progress-overlay')?.classList.contains('open');
  if (overlayOpen) {
    G('prog-title-txt').textContent = tRaw('csv.import_title');
    G('prog-bar').style.width = pct + '%';
    if (running) {
      G('prog-footer').textContent = `${t('csv.items_progress',{done,total})} (${s.ok} ok${s.warn ? ', '+s.warn+' '+t('csv.warnings') : ''}${s.err ? ', '+s.err+' '+t('csv.errors') : ''})`;
      if (s.current) G('prog-set-name').textContent = `Verarbeite: ${s.current} (${done}/${total})`;
    } else {
      G('prog-footer').textContent = `${t('csv.finished')} ${s.ok} ok${s.warn ? ', '+s.warn+' '+t('csv.warnings') : ''}${s.err ? ', '+s.err+' '+t('csv.errors') : ''}`;
      G('prog-set-name').textContent = '';
    }
  }

  // Update detail panel
  G('gib-stats').innerHTML = `${Number(s.ok)||0} ${ico('ok')} · ${Number(s.warn)||0} ${ico('warnung')} · ${Number(s.err)||0} ${ico('fehler')}`;
  const gpw = G('gib-prog-wrap');
  if (gpw && running) {
    gpw.style.display = 'block';
    G('gib-panel-fill').style.width = pct + '%';
    G('gib-panel-footer').textContent = `${t('csv.items_progress',{done,total})} (${fmtPct(pct, { vorzeichen: false, stellen: 0 })})`;
    if(s.current) G('gib-panel-set').textContent = `Verarbeite: ${s.current}`;
  }
  G('gib-stats').textContent = `${s.ok || 0} ok · ${s.warn || 0} ${t('csv.warnings')} · ${s.err || 0} ${t('csv.errors')}`;

  // Add new log entries — but only if the CSV poll loop isn't already writing them
  // (_csvPollActive = true means this window started the import and the CSV loop handles logs)
  if (!_csvPollActive && s.results && s.results.length > _gibLastCount) {
    s.results.slice(_gibLastCount).forEach(r => {
      const z = protokollZeile(r);
      if (z) gibAddLog(z.text, z.ok);
    });
  }
  if (s.results) _gibLastCount = s.results.length;

  if (!running) {
    // Import done — only hide the header bar, never auto-close the overlay dialog
    setTimeout(() => {
      G('global-import-bar').style.display='none';
      G('import-detail-panel').classList.remove('open');
      // Don't clear log or close overlay — user may still be reading results
    }, 5000);
    // Show close button so user can dismiss the overlay when ready
    const btnClose = G('btn-close-import');
    if (btnClose) btnClose.style.display = '';
    melde('setsGeaendert');
    gibStop();
  }
}

// Polling-Fallback: einmalig den Status holen und rendern.
async function gibPoll() {
  try {
    const s = await apiRoh('GET', '/v1/sets/import/csv/status').then(r=>r.json());
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


/**
 * Eine Zeile fuers Import-Protokoll — oder null, wenn es nichts zu sagen gibt.
 *
 * ── Marcos Befund vom 21.10. ────────────────────────────────────────────────
 *
 *   „Nach dem Import erscheint dann ganz viele Zeilen mit
 *    Undefined - aktualisiert"
 *
 * `results` traegt zweierlei: beim CSV-Import je Set ein echtes Ergebnis, beim
 * Wanted-Listen-Import bis zum 21.10. nur Zaehl-Platzhalter (`{success:true}`),
 * aus denen buildJobStatus ok/warn/err rechnet. Die hatten kein `set_number` —
 * und daraus wurde 322-mal „undefined – aktualisiert".
 *
 * Die Platzhalter sind weg (beendeAuftrag bekommt jetzt echte Zeilen, siehe
 * src/auftraege/importAuftrag.ts), aber die Schranke bleibt: Eine Zeile, die nichts
 * benennt, sagt dem Betrachter nichts und kostet ihn das Vertrauen in die
 * uebrigen. Die ZAEHLUNG darueber ist davon unberuehrt — sie kommt aus
 * `s.ok`/`s.warn`/`s.err` und nicht von hier.
 *
 * ── Warum EINE Fassung ──────────────────────────────────────────────────────
 *
 * Diese drei Zeilen standen zweimal: hier fuer die zuschauende Sitzung und in
 * public/js/02-gallery.js fuer die, die den Import gestartet hat. Zwei
 * Fassungen heissen zwei Stellen, an denen die naechste Schranke fehlt — und
 * genau das war hier der Fall. Der SCHREIBER bleibt verschieden (gibAddLog
 * schreibt in beide Protokolle, addCsvLog nur in das des Dialogs); gemeinsam
 * ist, WAS dasteht.
 */
export function protokollZeile(r, warnZusatz = '') {
  if (!r?.set_number) return null;
  if (r.success) {
    return { ok: true, text: r.set_number + ' – '
      + (r.action === 'added' ? t('common.added') : t('common.updated')) };
  }
  // `warnZusatz` nur fuer den CSV-Import: Dort heisst eine Anmerkung
  // „Zeitueberschreitung, wird erneut versucht". Beim Wanted-Listen-Import
  // heisst sie „offen, keine Rebrickable-Nummer" — derselbe Satz waere dort
  // schlicht falsch. Der Zusatz kommt deshalb vom Aufrufer und nicht von hier.
  if (r.isWarning) {
    return { ok: false, text: r.set_number + ': ' + (r.error || '')
      + (warnZusatz ? ' (' + warnZusatz + ')' : '') };
  }
  return { ok: false, text: r.set_number + ': ' + (r.error || t('settings.error')) };
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
  // Anmeldung, die das Cookie setzt. Siehe src/konto/auth.ts.
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
      const r = await apiRoh('GET', '/v1/sets/import/csv/status');

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
/** @type {number | null} */
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
// Der Handler gehört zu dem Modul, das ihn umsetzt.
registerActions({
  gibToggle,
  hideProgress,
});

// ── PROGRESS OVERLAY ─────────────────────────────────
export function showProgress(title, csvMode){
  G('prog-title-txt').textContent=title;
  G('prog-bar').style.width='0%';
  G('prog-footer').textContent=tRaw('common.please_wait');
  G('prog-set-name').textContent='';
  G('csv-log').style.display=csvMode?'block':'none';
  G('csv-log').innerHTML='';
  G('prog-steps').style.display=csvMode?'none':'';
  // Der Hintergrund-Hinweis gilt nur fürs Erfassen eines einzelnen Sets. Beim
  // CSV-Import ist die Schrittliste ohnehin ausgeblendet, dort zeigt das
  // Protokoll (`csv-log`) je Zeile ein echtes Ergebnis.
  if (G('prog-hint')) G('prog-hint').style.display=csvMode?'none':'';
  ['ps-meta','ps-image'].forEach(id=>{
    const el=G(id); el.classList.remove('active','done','err');
  });
  G('progress-overlay').classList.add('open');
  // Reset buttons for new import
  G('btn-cancel-import').style.display='none';
  const btnClose = G('btn-close-import');
  if (btnClose) btnClose.style.display='none';
}

export function hideProgress(){
  G('progress-overlay').classList.remove('open');
  G('prog-steps').style.display='';
  // Show header bar when minimizing if import is polling
  if ((_gibTimer || _gibSse) && ME) {
    G('global-import-bar').style.display = 'flex';
  }
}

// `extra` fiel weg: Es schrieb in ein `.step-count`-Feld, das nur die
// entfernten Teile-/Teilbilder-Schritte hatten. Ohne diese Schritte gibt es
// kein Element mehr, in das es hätte schreiben können.
function setStep(stepId, state){
  const el=G('ps-'+stepId); if(!el) return;
  el.classList.remove('active','done','err'); el.classList.add(state);
}

export function setProgBar(pct){ G('prog-bar').style.width=Math.min(100,pct)+'%'; }

export function addCsvLog(text, ok){
  const d=G('csv-log'), line=document.createElement('div');
  line.className='csv-log-line '+(ok?'ok':'er');
  line.textContent=text; d.appendChild(line); d.scrollTop=d.scrollHeight;
}

// Verarbeitet die SSE-Ereignisse beim Erfassen EINES Sets.
//
// ── Warum hier nur noch zwei Schritte stehen ────────────────────────────────
// Der Dialog listete früher sechs Schritte: Set-Infos, Bild, Anleitungen,
// Teile, Teilbilder, Preis. Davon wartet der Aufrufer heute nur noch auf die
// ersten beiden — `addSet()` (src/sets/setService.ts) holt Set-Daten und Bild
// synchron und schiebt alles Übrige in ein `setTimeout`, das erst nach der
// Antwort läuft. Die vier hinteren Schritte konnten den Browser deshalb gar
// nicht mehr erreichen:
//   • `instructions` wurde zwar noch gesendet, aber der Download lief bereits
//     in einem `setImmediate` — der Punkt sprang auf „aktiv" und blieb dort
//     stehen, weil ihn nie ein Abschluss erreichte.
//   • `parts_start`, `parts_importing`, `parts_done`, `parts_images` und
//     `parts_error` stammen aus `importPartsForSet()`. NACHGEMESSEN: alle fünf
//     Aufrufstellen übergeben dort `null` als Fortschritts-Melder.
//   • `step:'price'` wurde von KEINER Serverstelle je gesendet.
// Ein Fortschrittsbalken, der Arbeit anzeigt, auf die niemand wartet, ist
// keine Auskunft, sondern eine Behauptung. Statt der vier Punkte steht jetzt
// ein fester Hinweis im Dialog (`prog-hint`), dass diese Arbeit im Hintergrund
// weiterläuft — was zutrifft und den Dialog nicht künstlich offen hält.
//
// `done_meta` markiert die Stelle, an der der synchrone Teil fertig ist. Der
// Schritt wurde bisher gesendet und vom Browser verworfen; er schliesst jetzt
// den Bild-Schritt ab. Ohne ihn bliebe „Bild herunterladen" bis zum Ende auf
// „aktiv", weil das früher der `instructions`-Zweig erledigt hat.
export function handleSseEvent(ev, singleSetName){
  switch(ev.step){
    case 'meta':      setStep('meta','active'); setProgBar(10); G('prog-set-name').textContent=ev.set||singleSetName||''; break;
    case 'image':     setStep('meta','done'); setStep('image','active'); setProgBar(35); break;
    case 'done_meta': setStep('image','done'); setProgBar(90); break;
    case 'done':      setProgBar(100); G('prog-footer').textContent=`${ev.action==='added'?tRaw('common.added_cap'):tRaw('common.updated_cap')}: ${ev.set_number ?? ''}`; break;
    case 'error':     G('prog-footer').textContent=String(ev.error ?? ''); break;
  }
}

// ── CSV import polling state ─────────────────────────────────────────────────
let _csvPollActive = false;
/** Läuft der CSV-Import aus diesem Fenster (dann zeigt dessen Schleife das Protokoll)? */
export function csvPollAktiv() { return _csvPollActive; }
/** @param {boolean} v */
export function setzeCsvPollAktiv(v) { _csvPollActive = v; }

/** Der laufende Ereignisstrom (Set erfassen) — damit „Abbrechen" ihn beenden kann. */
/** @type {AbortController | null} */
let _activeAbort = null;

export function streamFertig(){ _activeAbort = null; G('btn-cancel-import').style.display='none'; }

function cancelImport(){
  _csvPollActive = false;
  _activeAbort?.abort();
  _activeAbort = null;
  api('POST','/v1/sets/import/csv/cancel').catch(()=>{});
  G('btn-cancel-import').style.display='none';
  hideProgress();
  toast(tRaw('csv.cancelled'),'info');
  melde('setsGeaendert');
}

/** Abbrechbarer Ereignisstrom (POST mit JSON-Körper); ein Abbruch endet ohne Fehler.
 * @param {string} path @param {object} body @param {(ev: any) => void} onEvent
 * @returns {Promise<void>} */
export function streamRequest(path, body, onEvent){
  const ac = _activeAbort = new AbortController();
  G('btn-cancel-import').style.display='inline-flex';
  return apiRoh('POST', path, { body, signal: ac.signal })
    .then(res=>readSSE(res,onEvent,ac.signal))
    .catch(e=>{ if(e.name!=='AbortError') throw e; });
}

async function readSSE(res, onEvent, signal){
  // Antwortet der Server mit gewöhnlichem JSON statt einem Ereignisstrom, ist
  // die Sache schon entschieden — beim Erfassen etwa, wenn das Set bereits im
  // Blickfeld steht (src/sets/setAdd.ts). Dann gibt es nichts zu verfolgen, und
  // die eine Antwort wird wie ein einzelnes Ereignis durchgereicht. Ohne
  // diesen Zweig liefe der Leser über JSON-Text, fände keine `data:`-Zeile und
  // der Aufrufer bekäme nie ein Ereignis — die Anzeige bliebe hängen.
  if ((res.headers.get('content-type') || '').includes('application/json')) {
    const daten = await res.json().catch(() => null);
    if (daten) onEvent({ step: daten.success === false ? 'error' : 'done', ...daten });
    return;
  }
  const reader=res.body.getReader(), dec=new TextDecoder(); let buf='';
  try{
    while(true){
      if(signal?.aborted) break;
      const {done,value}=await reader.read();
      if(done) break;
      buf+=dec.decode(value,{stream:true});
      const lines=buf.split('\n'); buf=lines.pop();
      for(const line of lines){
        if(line.startsWith('data: ')){
          try{ onEvent(JSON.parse(line.slice(6))); }catch(e){}
        }
      }
    }
  } catch(e){
    if(e.name!=='AbortError') throw e;
  } finally {
    try{ reader.cancel(); }catch(_){}
  }
}

G('btn-cancel-import').onclick = cancelImport;
