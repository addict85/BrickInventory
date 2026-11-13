// Der Importbalken im Seitenkopf ist ein geschlossener Gegenstand: Nach aussen zählen gibCheckOnLoad() und
// gibZuruecksetzen(), der Rest ist Innenleben.
import { html } from './escapen.js';
import { registerActions } from './registry.js';
import { apiRoh, api, apiDaten } from './api.js';
import { ico, G, setzeHtml } from './dom.js';
import { fmtPct } from './format.js';
import { toast } from './meldungen.js';
import { melde } from './ereignisse.js';
import { LANG, tRaw } from '../i18n.js';
import { ME } from './zustand.js';

// ── Global CSV Import Progress Bar ───────────────────────────────────────────
/** @type {ReturnType<typeof setInterval> | null} */
let _gibTimer = null; // Polling-Fallback-Timer (nur wenn SSE scheitert)
/**
 * Ein Eintrag im Ergebnis eines Imports. `results` nennt der Vertrag nicht (CsvImportStatus ist offen); so
 * schreibt ihn src/sets/csvImportLauf.ts.
 * @typedef {{ set_number?: string, zeile?: number, success?: boolean, action?: string, isWarning?: boolean, error?: string | null, menge?: number, katalog_offen?: boolean }} ImportErgebnis
 * @typedef {import('../../frontend-typen/vertrag').CsvImportStatus & { results?: ImportErgebnis[] }} ImportStand
 */
/** @type {EventSource | null} */
let _gibSse = null; // aktive EventSource (SSE), falls verfügbar
let _gibLastCount = 0;

// Rendert einen Import-Status ins UI. Quelle (SSE oder Polling) ist egal.
/**
 * „2 ok, 1 Fehler“: Zahl und Wort aus einem Schlüssel, damit die Einzahl stimmt („1 Errors“).
 * @param {{ ok?: number | null, warn?: number | null, err?: number | null }} s
 * @param {string} [warnSchluessel] eigene Bezeichnung der Warnungen
 */
export function importZaehler(s, warnSchluessel = 'csv.warnings_n') {
  return [
    `${s.ok || 0} ok`,
    ...(s.warn ? [tRaw(warnSchluessel, { n: s.warn })] : []),
    ...(s.err ? [tRaw('csv.errors_n', { n: s.err })] : []),
  ].join(', ');
}

/** @param {ImportStand | null | undefined} s */
function gibApplyStatus(s) {
  if (!s?.success || !s.status) {
    gibStop();
    return;
  }

  const running = s.status === 'running' || s.status === 'pending';
  const done = s.done || 0;
  const total = s.total || 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  // Kopfleiste nachführen
  const _gibEl = G('global-import-bar');
  if (_gibEl) {
    if (running) _gibEl.style.display = 'flex';
    G('gib-fill').style.width = pct + '%';
    G('gib-text').textContent = running
      ? `${done}/${total} (${fmtPct(pct, { vorzeichen: false, stellen: 0 })})`
      : importZaehler(s);
  }

  // Überlagerung nachführen, solange sie offen ist (auch im zweiten Fenster oder nach Minimieren)
  const overlayOpen = G('progress-overlay')?.classList.contains('open');
  if (overlayOpen) {
    G('prog-title-txt').textContent = tRaw('csv.import_title');
    setProgBar(pct);
    if (running) {
      G('prog-footer').textContent = `${tRaw('csv.items_progress', { done, total })} (${importZaehler(s)})`;
      G('prog-set-name').textContent = s.current
        ? tRaw('csv.verarbeite', { set: s.current, done, total })
        : done === 0
          ? tRaw('csv.wartet')
          : '';
    } else {
      G('prog-footer').textContent = `${tRaw('csv.finished')} ${importZaehler(s)}`;
      G('prog-set-name').textContent = '';
    }
  }

  // Detailbereich nachführen
  setzeHtml(
    G('gib-stats'),
    html`${Number(s.ok) || 0} ${ico('ok')} · ${Number(s.warn) || 0} ${ico('warnung')} · ${Number(s.err) || 0} ${ico('fehler')}`,
  );
  const gpw = G('gib-prog-wrap');
  if (gpw && running) {
    gpw.style.display = 'block';
    G('gib-panel-fill').style.width = pct + '%';
    G('gib-panel-footer').textContent =
      `${tRaw('csv.items_progress', { done, total })} (${fmtPct(pct, { vorzeichen: false, stellen: 0 })})`;
    if (s.current) G('gib-panel-set').textContent = tRaw('csv.verarbeite', { set: s.current, done, total });
  }
  G('gib-stats').textContent = [
    `${s.ok || 0} ok`,
    tRaw('csv.warnings_n', { n: s.warn || 0 }),
    tRaw('csv.errors_n', { n: s.err || 0 }),
  ].join(' · ');

  // Neue Protokollzeilen anhängen — nur wenn die CSV-Abfrageschleife sie nicht schon schreibt (_csvPollActive = true
  // heisst: dieses Fenster hat den Import gestartet, die Schleife schreibt das Protokoll)
  if (!_csvPollActive && s.results && s.results.length > _gibLastCount) {
    s.results.slice(_gibLastCount).forEach(r => {
      const z = protokollZeile(r);
      if (z) gibAddLog(z.text, z.art);
    });
  }
  if (s.results) _gibLastCount = s.results.length;

  if (!running) {
    merkeLetztenImport(s);
    // Import fertig: nur die Kopfleiste ausblenden, die Überlagerung nie selbst schliessen
    setTimeout(() => {
      G('global-import-bar').style.display = 'none';
      G('import-detail-panel').classList.remove('open');
      // Don't clear log or close overlay — user may still be reading results
    }, 5000);
    // Schliessen-Knopf zeigen, damit man die Überlagerung selbst schliesst
    const btnClose = G('btn-close-import');
    if (btnClose) btnClose.style.display = '';
    melde('setsGeaendert');
    gibStop();
  }
}

// Polling-Fallback: einmalig den Status holen und rendern.
async function gibPoll() {
  try {
    const s = await apiDaten('GET', '/v1/sets/import/csv/status');
    if (s) gibApplyStatus(s);
  } catch (_) {}
}

function gibToggle() {
  if (!ME) return;
  const overlay = G('progress-overlay');
  if (overlay?.classList.contains('open')) {
    // Already open — minimize back to header bar
    hideProgress();
  } else if (overlay) {
    // Opening from header bar click — initialize overlay in CSV mode so gibPoll() can write into it (needed
    // wenn dies ein zweites Browserfenster ist)
    if (!_csvPollActive) {
      showProgress(tRaw('csv.import_title'), true);
      // Immediately fill with whatever gibPoll already knows
      gibPoll();
    } else {
      // Dieses Fenster führt die Importschleife schon — nur wieder zeigen
      overlay.classList.add('open');
    }
  }
}

/**
 * Eine Zeile fürs Import-Protokoll, oder null: Eine Zeile ohne Setnummer sagt nichts (sie erschien 322-mal
 * als „undefined – aktualisiert“). Eine Fassung für beide Protokolle, damit die Schranke nicht an einer
 * Stelle fehlt.
 * @param {ImportErgebnis | null | undefined} r
 * @param {string} [warnZusatz]
 */
export function protokollZeile(r, warnZusatz = '') {
  if (!r?.set_number && !r?.zeile) return null;
  // Mit Zeilennummer findet man die Stelle in der Datei; eine Zeile ohne Setnummer hat sonst keinen Namen.
  const wo = (r.zeile ? tRaw('csv.zeile', { n: r.zeile }) + (r.set_number ? ' · ' : '') : '') + (r.set_number || '');
  if (r.success) {
    // Ein bekanntes Set bekommt ein weiteres Exemplar; „aktualisiert“ verschwieg das.
    const was =
      r.action === 'added'
        ? tRaw('common.added')
        : r.menge
          ? tRaw('csv.log_mehr', { n: r.menge })
          : tRaw('common.updated');
    // Gebucht, aber dem Katalog unbekannt: gelb statt grün, sonst sähe ein Tippfehler wie ein Erfolg aus.
    if (r.katalog_offen)
      return {
        ok: false,
        art: /** @type {const} */ ('warn'),
        text: wo + ' – ' + was + ' — ' + tRaw('csv.log_unbekannt'),
      };
    return { ok: true, art: /** @type {const} */ ('ok'), text: wo + ' – ' + was };
  }
  // `warnZusatz` nur fuer den CSV-Import: Dort heisst eine Anmerkung
  // „Zeitueberschreitung, wird erneut versucht". Beim Wanted-Listen-Import heisst sie „offen, keine
  // Rebrickable-Nummer" — derselbe Satz waere dort schlicht falsch. Der Zusatz kommt deshalb vom Aufrufer und
  // nicht von hier.
  if (r.isWarning) {
    return {
      ok: false,
      art: /** @type {const} */ ('warn'),
      text: wo + ': ' + (r.error || '') + (warnZusatz ? ' (' + warnZusatz + ')' : ''),
    };
  }
  return { ok: false, art: /** @type {const} */ ('er'), text: wo + ': ' + (r.error || tRaw('settings.error')) };
}

/**
 * @param {string} text
 * @param {'ok' | 'warn' | 'er'} art
 */
function gibAddLog(text, art) {
  // In das CSV-Protokoll der Überlagerung UND in das Detailprotokoll schreiben
  for (const logId of ['csv-log', 'gib-log']) {
    const log = G(logId);
    if (!log) continue;
    const line = document.createElement('div');
    line.className = 'csv-log-line ' + art;
    line.textContent = text;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }
}

// Startet die Live-Überwachung: bevorzugt SSE, mit automatischem Fallback auf Polling, falls der Browser kein
// EventSource kann oder der Stream scheitert.
export function gibStart() {
  if (_gibSse || _gibTimer) return; // läuft bereits
  _gibLastCount = 0;
  G('gib-log').replaceChildren();
  G('global-import-bar').style.display = 'flex';
  G('gib-text').textContent = tRaw('csv.running_text');
  G('gib-fill').style.width = '0%';

  // Kein Token in der Adresse: EventSource schickt mit withCredentials das Sitzungscookie, und ein ?token=
  // stünde im Proxy-Protokoll und im Verlauf.
  const url = `/api/v1/sets/import/csv/stream?sprache=${encodeURIComponent(LANG)}`;

  if (typeof EventSource !== 'undefined') {
    try {
      const es = new EventSource(url, { withCredentials: true });
      _gibSse = es;
      es.onmessage = e => {
        try {
          gibApplyStatus(JSON.parse(e.data));
        } catch (_) {}
      };
      es.onerror = () => {
        // Verbindung verloren/abgelehnt → auf Polling zurückfallen, aber nur solange noch kein Fallback
        // läuft.
        es.close();
        if (_gibSse === es) _gibSse = null;
        if (!_gibTimer) {
          _gibTimer = setInterval(gibPoll, 1500);
          gibPoll();
        }
      };
      return;
    } catch (_) {
      /* fällt unten auf Polling zurück */
    }
  }
  // Kein EventSource verfügbar → Polling
  _gibTimer = setInterval(gibPoll, 1500);
  gibPoll();
}

function gibStop() {
  if (_gibSse) {
    try {
      _gibSse.close();
    } catch (_) {}
    _gibSse = null;
  }
  if (_gibTimer) {
    clearInterval(_gibTimer);
    _gibTimer = null;
  }
}

// Beim Laden mit dem Abfragen beginnen (findet einen Import aus jedem Fenster)
export async function gibCheckOnLoad() {
  if (_gibCheckTimer) return;
  let failures = 0;

  async function doCheck() {
    if (_gibTimer || _gibSse) {
      clearInterval(_gibCheckTimer);
      _gibCheckTimer = null;
      return;
    }
    // Ohne Anmeldung gibt es nichts zu prüfen — vorher lief die Abfrage auch auf dem Login-Screen im
    // Drei-Sekunden-Takt weiter.
    if (!ME) return;
    try {
      const r = await apiRoh('GET', '/v1/sets/import/csv/status');

      // Antwort erst prüfen, dann parsen. Steht ein Reverse-Proxy oder Tunnel davor, liefert der bei Neustart
      // oder Aussetzer eine HTML-Fehlerseite — r.json() warf dann "Unexpected token '<'". Das ist kein Fehler
      // der App, soll aber auch keinen Stacktrace in der Konsole erzeugen.
      const ct = r.headers.get('content-type') || '';
      if (!r.ok || !ct.includes('application/json')) {
        if (++failures === 3)
          console.warn('[gibCheck] Antwort ist kein JSON (Status ' + r.status + ') — Abfrage pausiert');
        // Nach mehreren Fehlschlägen langsamer weiterversuchen statt im Drei-Sekunden-Takt gegen eine Wand zu
        // laufen.
        if (failures >= 3 && _gibCheckTimer) {
          clearInterval(_gibCheckTimer);
          _gibCheckTimer = setInterval(doCheck, 30000);
        }
        return;
      }
      failures = 0;
      const s = await r.json();
      merkeLetztenImport(s);
      if (s.success && (s.status === 'running' || s.status === 'pending')) {
        clearInterval(_gibCheckTimer);
        _gibCheckTimer = null;
        gibStart();
      }
    } catch {
      if (++failures === 3) console.warn('[gibCheck] nicht erreichbar — Abfrage verlangsamt');
    }
  }
  doCheck(); // fire immediately on login
  _gibCheckTimer = setInterval(doCheck, 3000); // then every 3s
}
/** @type {number | null} */
let _gibCheckTimer = null;

/** Das Ergebnis des letzten abgeschlossenen Imports, solange es höchstens einen Tag alt ist. */
/** @type {ImportStand | null} */
let _letzterImport = null;
const LETZTER_IMPORT_MS = 24 * 3600_000;

/**
 * Ein Eintrag im Import-Menü führt nach dem Neuladen zur Ergebnisliste zurück; der Server hält sie in
 * import_stand, nur der Weg dorthin fehlte.
 * @param {ImportStand | null | undefined} s
 */
function merkeLetztenImport(s) {
  const fertig = !!s?.success && (s.status === 'done' || s.status === 'cancelled') && (s.results?.length ?? 0) > 0;
  const alter = s?.beendet_am ? Date.now() - Date.parse(String(s.beendet_am)) : Infinity;
  _letzterImport = fertig && alter < LETZTER_IMPORT_MS ? /** @type {ImportStand} */ (s) : null;
  const knopf = /** @type {HTMLButtonElement | null} */ (document.getElementById('letzter-import'));
  if (!knopf) return;
  knopf.hidden = !_letzterImport;
  if (_letzterImport)
    G('letzter-import-text').textContent = tRaw('csv.letzter_import', { zaehler: importZaehler(_letzterImport) });
}

/** Öffnet den Fortschrittsdialog mit dem gespeicherten Ergebnis. */
function zeigeLetztenImport() {
  const s = _letzterImport;
  if (!s) return;
  const menue = document.querySelector('#tab-gallery details.import-menue');
  if (menue instanceof HTMLDetailsElement) menue.open = false;
  showProgress(tRaw('csv.import_title'), true);
  setProgBar(100);
  for (const r of s.results || []) {
    const z = protokollZeile(r);
    if (z) addCsvLog(z.text, z.art);
  }
  G('prog-footer').textContent = `${tRaw('csv.zeilen_gelesen', { n: s.total ?? 0 })} · ${importZaehler(s)}`;
  const zu = G('btn-close-import');
  if (zu) zu.style.display = '';
}
/**
 * Setzt den Balken auf „nichts läuft“. Eine Funktion statt Zeilen beim Abmelden: Wer von aussen zurücksetzt,
 * müsste sonst das Innenleben dieser Datei kennen und bei jeder neuen Variable mitdenken.
 */
export function gibZuruecksetzen() {
  const balken = G('global-import-bar');
  if (balken) balken.style.display = 'none';
  gibStop();
  if (_gibCheckTimer) {
    clearInterval(_gibCheckTimer);
    _gibCheckTimer = null;
  }
  _gibLastCount = 0;
  const log = G('gib-log');
  if (log) log.replaceChildren();
}

// ── Handler beim Dispatcher anmelden (siehe js/registry.js) ──────────────
// Der Handler gehört zu dem Modul, das ihn umsetzt.
registerActions({
  gibToggle,
  hideProgress,
  zeigeLetztenImport,
});

// ── PROGRESS OVERLAY ─────────────────────────────────
/**
 * @param {string} title
 * @param {boolean} csvMode
 */
export function showProgress(title, csvMode) {
  G('prog-title-txt').textContent = title;
  setProgBar(0);
  G('prog-footer').textContent = tRaw('common.please_wait');
  G('prog-set-name').textContent = '';
  G('csv-log').style.display = csvMode ? 'block' : 'none';
  G('csv-log').replaceChildren();
  G('prog-steps').style.display = csvMode ? 'none' : '';
  // Der Hintergrund-Hinweis gilt nur fürs Erfassen eines einzelnen Sets. Beim CSV-Import ist die Schrittliste
  // ohnehin ausgeblendet, dort zeigt das Protokoll (`csv-log`) je Zeile ein echtes Ergebnis.
  if (G('prog-hint')) G('prog-hint').style.display = csvMode ? 'none' : '';
  ['ps-meta', 'ps-image'].forEach(id => {
    const el = G(id);
    el.classList.remove('active', 'done', 'err');
  });
  G('progress-overlay').classList.add('open');
  // Reset buttons for new import
  G('btn-cancel-import').style.display = 'none';
  const btnClose = G('btn-close-import');
  if (btnClose) btnClose.style.display = 'none';
}

export function hideProgress() {
  G('progress-overlay').classList.remove('open');
  G('prog-steps').style.display = '';
  // Beim Minimieren die Kopfleiste zeigen, wenn ein Import läuft
  if ((_gibTimer || _gibSse) && ME) {
    G('global-import-bar').style.display = 'flex';
  }
}

// `extra` fiel weg: Es schrieb in ein `.step-count`-Feld, das nur die
// entfernten Teile-/Teilbilder-Schritte hatten. Ohne diese Schritte gibt es kein Element mehr, in das es
// hätte schreiben können.
/**
 * @param {string} stepId
 * @param {string} state
 */
function setStep(stepId, state) {
  const el = G('ps-' + stepId);
  if (!el) return;
  el.classList.remove('active', 'done', 'err');
  el.classList.add(state);
}

/**
 * @param {number} pct
 */
export function setProgBar(pct) {
  const wert = Math.max(0, Math.min(100, pct));
  G('prog-bar').style.width = wert + '%';
  G('prog-bar-wrap')?.setAttribute('aria-valuenow', String(Math.round(wert)));
}

/**
 * @param {string} text
 * @param {'ok' | 'warn' | 'er'} art
 */
export function addCsvLog(text, art) {
  const d = G('csv-log'),
    line = document.createElement('div');
  line.className = 'csv-log-line ' + art;
  line.textContent = text;
  d.appendChild(line);
  d.scrollTop = d.scrollHeight;
}

/** Ein Ereignis des Stroms beim Erfassen; `step` sagt, welche Felder es trägt.
 * @typedef {{ step?: string, set?: string, set_number?: string, action?: string, error?: string, [feld: string]: unknown }} SseEreignis */

// SSE-Ereignisse beim Erfassen eines Sets. Gewartet wird nur auf Set-Daten und Bild; Anleitungen, Teile und
// Preis laufen danach im Hintergrund, und ein Balken für Arbeit, auf die niemand wartet, wäre eine
// Behauptung.
/**
 * @param {SseEreignis} ev
 * @param {string} singleSetName
 */
export function handleSseEvent(ev, singleSetName) {
  switch (ev.step) {
    case 'meta':
      setStep('meta', 'active');
      setProgBar(10);
      G('prog-set-name').textContent = ev.set || singleSetName || '';
      break;
    case 'image':
      setStep('meta', 'done');
      setStep('image', 'active');
      setProgBar(35);
      break;
    case 'done_meta':
      setStep('image', 'done');
      setProgBar(90);
      break;
    case 'done':
      setProgBar(100);
      G('prog-footer').textContent =
        `${ev.action === 'added' ? tRaw('common.added_cap') : tRaw('common.updated_cap')}: ${ev.set_number ?? ''}`;
      break;
    case 'error':
      G('prog-footer').textContent = String(ev.error ?? '');
      break;
  }
}

// ── CSV import polling state ─────────────────────────────────────────────────
let _csvPollActive = false;
/** Läuft der CSV-Import aus diesem Fenster (dann zeigt dessen Schleife das Protokoll)? */
export function csvPollAktiv() {
  return _csvPollActive;
}
/** @param {boolean} v */
export function setzeCsvPollAktiv(v) {
  _csvPollActive = v;
}

/** Der laufende Ereignisstrom (Set erfassen) — damit „Abbrechen" ihn beenden kann. */
/** @type {AbortController | null} */
let _activeAbort = null;

export function streamFertig() {
  _activeAbort = null;
  G('btn-cancel-import').style.display = 'none';
}

function cancelImport() {
  _csvPollActive = false;
  _activeAbort?.abort();
  _activeAbort = null;
  api('POST', '/v1/sets/import/csv/cancel').catch(() => {});
  G('btn-cancel-import').style.display = 'none';
  hideProgress();
  toast(tRaw('csv.cancelled'), 'info');
  melde('setsGeaendert');
}

/** Abbrechbarer Ereignisstrom (POST mit JSON-Körper); ein Abbruch endet ohne Fehler.
 * @param {string} path @param {object} body @param {(ev: SseEreignis) => void} onEvent
 * @returns {Promise<void>} */
export function streamRequest(path, body, onEvent) {
  const ac = new AbortController();
  _activeAbort = ac;
  G('btn-cancel-import').style.display = 'inline-flex';
  return apiRoh('POST', path, { body, signal: ac.signal })
    .then(res => readSSE(res, onEvent, ac.signal))
    .catch(e => {
      if (e.name !== 'AbortError') throw e;
    });
}

/**
 * @param {Response} res
 * @param {(ev: SseEreignis) => void} onEvent
 * @param {AbortSignal} signal
 */
async function readSSE(res, onEvent, signal) {
  // Antwortet der Server mit JSON statt einem Strom, ist die Sache entschieden (etwa: Set schon im
  // Blickfeld). Die Antwort geht als ein Ereignis durch; sonst wartete die Anzeige auf eine data:-Zeile, die
  // nie kommt.
  if ((res.headers.get('content-type') || '').includes('application/json')) {
    const daten = await res.json().catch(() => null);
    if (daten) onEvent({ step: daten.success === false ? 'error' : 'done', ...daten });
    return;
  }
  if (!res.body) return;
  const reader = res.body.getReader(),
    dec = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            onEvent(JSON.parse(line.slice(6)));
          } catch {}
        }
      }
    }
  } catch (e) {
    if (/** @type {Error} */ (e).name !== 'AbortError') throw e;
  } finally {
    try {
      reader.cancel();
    } catch (_) {}
  }
}

G('btn-cancel-import').onclick = cancelImport;
