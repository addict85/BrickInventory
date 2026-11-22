// The import bar in the page header is a closed subject: to the outside gibCheckOnLoad() and
// resetGive() count, the rest is internals.
import { html } from './escaping.js';
import { registerActions } from './registry.js';
import { apiRaw, api, apiData, stream } from './api.js';
import { ico, G, setHtml } from './dom.js';
import { fmtPct } from './format.js';
import { toast } from './messages.js';
import { emit } from './events.js';
import { LANG, tRaw } from '../i18n.js';
import { loggedInAccount } from './state.js';

// ── Global CSV Import Progress Bar ───────────────────────────────────────────
/** @type {ReturnType<typeof setInterval> | null} */
let _gibTimer = null; // Polling fallback timer (only if SSE fails)
/**
 * An entry in an import's result. The contract does not name `results` (CsvImportStatus is open); this is how
 * src/sets/csvImportRun.ts writes it.
 * @typedef {{ set_number?: string, zeile?: number, success?: boolean, action?: string, isWarning?: boolean, error?: string | null, menge?: number, katalog_offen?: boolean }} ImportResult
 * @typedef {import('../../frontend-types/contract').CsvImportStatus & { results?: ImportResult[] }} ImportStatus
 */
/** @type {{ close: () => void } | null} */
let _gibSse = null; // active stream (SSE), if available
let _gibLastCount = 0;

// Renders an import status into the UI. The source (SSE or polling) does not matter.
/**
 * "2 ok, 1 error": number and word from one key, so that the singular is right ("1 Errors").
 * @param {{ ok?: number | null, warn?: number | null, err?: number | null }} s
 * @param {string} [warnKey] own label for the warnings
 */
export function importCounter(s, warnKey = 'csv.warnings_n') {
  return [
    `${s.ok || 0} ok`,
    ...(s.warn ? [tRaw(warnKey, { n: s.warn })] : []),
    ...(s.err ? [tRaw('csv.errors_n', { n: s.err })] : []),
  ].join(', ');
}

/** @param {ImportStatus | null | undefined} s */
function gibApplyStatus(s) {
  if (!s?.success || !s.status) {
    gibStop();
    return;
  }

  const running = s.status === 'running' || s.status === 'pending';
  const done = s.done || 0;
  const total = s.total || 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  // update the header bar
  const _gibEl = G('global-import-bar');
  if (_gibEl) {
    if (running) _gibEl.style.display = 'flex';
    G('gib-fill').style.width = pct + '%';
    G('gib-text').textContent = running
      ? `${done}/${total} (${fmtPct(pct, { sign: false, places: 0 })})`
      : importCounter(s);
  }

  // Update the overlay while it is open (also in the second window or after minimizing)
  const overlayOpen = G('progress-overlay')?.classList.contains('open');
  if (overlayOpen) {
    G('prog-title-txt').textContent = tRaw('csv.import_title');
    setProgBar(pct);
    if (running) {
      G('prog-footer').textContent = `${tRaw('csv.items_progress', { done, total })} (${importCounter(s)})`;
      G('prog-set-name').textContent = s.current
        ? tRaw('csv.processing', { set: s.current, done, total })
        : done === 0
          ? tRaw('csv.waiting')
          : '';
    } else {
      G('prog-footer').textContent = `${tRaw('csv.finished')} ${importCounter(s)}`;
      G('prog-set-name').textContent = '';
    }
  }

  // update the detail area
  setHtml(
    G('gib-stats'),
    html`${Number(s.ok) || 0} ${ico('ok')} · ${Number(s.warn) || 0} ${ico('warning')} · ${Number(s.err) || 0} ${ico('error')}`,
  );
  const gpw = G('gib-prog-wrap');
  if (gpw && running) {
    gpw.style.display = 'block';
    G('gib-panel-fill').style.width = pct + '%';
    G('gib-panel-footer').textContent =
      `${tRaw('csv.items_progress', { done, total })} (${fmtPct(pct, { sign: false, places: 0 })})`;
    if (s.current) G('gib-panel-set').textContent = tRaw('csv.processing', { set: s.current, done, total });
  }
  G('gib-stats').textContent = [
    `${s.ok || 0} ok`,
    tRaw('csv.warnings_n', { n: s.warn || 0 }),
    tRaw('csv.errors_n', { n: s.err || 0 }),
  ].join(' · ');

  // Append new log lines — only if the CSV polling loop does not already write them (_csvPollActive = true
  // means: this window started the import, the loop writes the log)
  if (!_csvPollActive && s.results && s.results.length > _gibLastCount) {
    s.results.slice(_gibLastCount).forEach(r => {
      const z = logRow(r);
      if (z) gibAddLog(z.text, z.art);
    });
  }
  if (s.results) _gibLastCount = s.results.length;

  if (!running) {
    rememberLastImport(s);
    // Import finished: only hide the header bar, never close the overlay by itself
    setTimeout(() => {
      G('global-import-bar').style.display = 'none';
      G('import-detail-panel').classList.remove('open');
      // Don't clear log or close overlay — user may still be reading results
    }, 5000);
    showImportCompletion();
    emit('setsChanged');
    gibStop();
  }
}

// Polling fallback: fetch the status once and render it.
async function gibPoll() {
  try {
    const s = await apiData('GET', '/v1/sets/import/csv/status');
    if (s) gibApplyStatus(s);
  } catch (_) {}
}

function gibToggle() {
  if (!loggedInAccount) return;
  const overlay = G('progress-overlay');
  if (overlay?.classList.contains('open')) {
    // Already open — minimize back to header bar
    hideProgress();
  } else if (overlay) {
    // Opening from header bar click — initialize overlay in CSV mode so gibPoll() can write into it (needed
    // if this is a second browser window)
    if (!_csvPollActive) {
      showProgress(tRaw('csv.import_title'), true);
      // Immediately fill with whatever gibPoll already knows
      gibPoll();
    } else {
      // This window already runs the import loop — only show it again
      overlay.classList.add('open');
    }
  }
}

/**
 * A line for the import log, or null: a line without a set number says nothing (it appeared 322 times
 * as "undefined – updated"). One version for both logs, so that the guard is not missing in one
 * place.
 * @param {ImportResult | null | undefined} r
 * @param {string} [warnExtra]
 */
export function logRow(r, warnExtra = '') {
  if (!r?.set_number && !r?.zeile) return null;
  // With the line number one finds the spot in the file; a line without a set number otherwise has no name.
  const wo = (r.zeile ? tRaw('csv.row', { n: r.zeile }) + (r.set_number ? ' · ' : '') : '') + (r.set_number || '');
  if (r.success) {
    // A known set gets another copy; "updated" concealed that.
    const was =
      r.action === 'added'
        ? tRaw('common.added')
        : r.menge
          ? tRaw('csv.log_more', { n: r.menge })
          : tRaw('common.updated');
    // Booked, but unknown to the catalog: yellow instead of green, otherwise a typo would look like a success.
    if (r.katalog_offen)
      return {
        ok: false,
        art: /** @type {const} */ ('warn'),
        text: wo + ' – ' + was + ' — ' + tRaw('csv.log_unknown'),
      };
    return { ok: true, art: /** @type {const} */ ('ok'), text: wo + ' – ' + was };
  }
  // `warnExtra` only for the CSV import: there a note means
  // "timeout, will be retried". In the wanted list import it means "open, no
  // Rebrickable number" — the same sentence would simply be wrong there. The addition therefore comes from the caller and
  // not from here.
  if (r.isWarning) {
    return {
      ok: false,
      art: /** @type {const} */ ('warn'),
      text: wo + ': ' + (r.error || '') + (warnExtra ? ' (' + warnExtra + ')' : ''),
    };
  }
  return { ok: false, art: /** @type {const} */ ('er'), text: wo + ': ' + (r.error || tRaw('settings.error')) };
}

/**
 * @param {string} text
 * @param {'ok' | 'warn' | 'er'} kind
 */
function gibAddLog(text, kind) {
  // Write into the overlay's CSV log AND into the detail log
  for (const logId of ['csv-log', 'gib-log']) {
    const log = G(logId);
    if (!log) continue;
    const line = document.createElement('div');
    line.className = 'csv-log-line ' + kind;
    line.textContent = text;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }
}

// Starts the live monitoring: preferably SSE, with automatic fallback to polling if the browser cannot do
// EventSource or the stream fails.
export function gibStart() {
  if (_gibSse || _gibTimer) return; // already running
  _gibLastCount = 0;
  G('gib-log').replaceChildren();
  G('global-import-bar').style.display = 'flex';
  G('gib-text').textContent = tRaw('csv.running_text');
  G('gib-fill').style.width = '0%';

  // No token in the address: with withCredentials EventSource sends the session cookie, and a ?token=
  // would appear in the proxy log and in the history.
  const s = stream(`/v1/sets/import/csv/stream?sprache=${encodeURIComponent(LANG)}`, {
    event: gibApplyStatus,
    // Connection lost/rejected → fall back to polling as long as no fallback is running yet.
    fehler: () => {
      if (_gibSse === s) _gibSse = null;
      if (!_gibTimer) {
        _gibTimer = setInterval(gibPoll, 1500);
        gibPoll();
      }
    },
  });
  if (s) {
    _gibSse = s;
    return;
  }
  // No EventSource available → polling
  _gibTimer = setInterval(gibPoll, 1500);
  gibPoll();
}

function gibStop() {
  if (_gibSse) {
    _gibSse.close();
    _gibSse = null;
  }
  if (_gibTimer) {
    clearInterval(_gibTimer);
    _gibTimer = null;
  }
}

// Start polling on load (finds an import from any window)
export async function gibCheckOnLoad() {
  if (_gibCheckTimer) return;
  let failures = 0;

  async function doCheck() {
    if (_gibTimer || _gibSse) {
      clearInterval(_gibCheckTimer);
      _gibCheckTimer = null;
      return;
    }
    // Without login there is nothing to check; in a hidden tab every query counted against the budget.
    if (!loggedInAccount || document.hidden) return;
    try {
      const r = await apiRaw('GET', '/v1/sets/import/csv/status');

      // Check the response first, then parse. If a reverse proxy or tunnel stands in front, it delivers an HTML error page
      // on restart or dropout — r.json() then threw "Unexpected token '<'". That is not an error
      // of the app, but it should not produce a stack trace in the console either.
      const ct = r.headers.get('content-type') || '';
      if (!r.ok || !ct.includes('application/json')) {
        if (++failures === 3)
          console.warn('[gibCheck] response is not JSON (status ' + r.status + ') — polling paused');
        // After several failures keep retrying more slowly instead of running against a wall in a three-second
        // tick.
        if (failures >= 3 && _gibCheckTimer) {
          clearInterval(_gibCheckTimer);
          _gibCheckTimer = setInterval(doCheck, 30000);
        }
        return;
      }
      failures = 0;
      const s = await r.json();
      rememberLastImport(s);
      if (s.success && (s.status === 'running' || s.status === 'pending')) {
        clearInterval(_gibCheckTimer);
        _gibCheckTimer = null;
        gibStart();
      }
    } catch {
      if (++failures === 3) console.warn('[gibCheck] unreachable — polling slowed down');
    }
  }
  doCheck();
  // Every 10 s: an import from another window appears somewhat later, the own one starts the bar itself.
  _gibCheckTimer = setInterval(doCheck, 10000);
}
/** @type {number | null} */
let _gibCheckTimer = null;

/** The result of the last completed import, as long as it is at most one day old. */
/** @type {ImportStatus | null} */
let _lastImport = null;
const LAST_IMPORT_MS = 24 * 3600_000;

/**
 * An entry in the import menu leads back to the result list after reloading; the server keeps it in
 * import_stand, only the way there was missing.
 * @param {ImportStatus | null | undefined} s
 */
function rememberLastImport(s) {
  const done = !!s?.success && (s.status === 'done' || s.status === 'cancelled') && (s.results?.length ?? 0) > 0;
  const alter = s?.beendet_am ? Date.now() - Date.parse(String(s.beendet_am)) : Infinity;
  _lastImport = done && alter < LAST_IMPORT_MS ? /** @type {ImportStatus} */ (s) : null;
  const button = /** @type {HTMLButtonElement | null} */ (document.getElementById('last-import'));
  if (!button) return;
  button.hidden = !_lastImport;
  if (_lastImport) G('last-import-text').textContent = tRaw('csv.last_import', { counter: importCounter(_lastImport) });
}

/** Opens the progress dialog with the stored result. */
function showLastImport() {
  const s = _lastImport;
  if (!s) return;
  const menu = document.querySelector('#tab-gallery details.import-menu');
  if (menu instanceof HTMLDetailsElement) menu.open = false;
  showProgress(tRaw('csv.import_title'), true);
  setProgBar(100);
  for (const r of s.results || []) {
    const z = logRow(r);
    if (z) addCsvLog(z.text, z.art);
  }
  G('prog-footer').textContent = `${tRaw('csv.rows_read', { n: s.total ?? 0 })} · ${importCounter(s)}`;
  showImportCompletion();
}

/** Finished: "close" instead of "minimize" — a finished import does not keep running in the background. */
export function showImportCompletion() {
  const close = G('btn-close-import');
  if (close) close.style.display = '';
  const small = /** @type {HTMLElement | null} */ (document.querySelector('#progress-overlay .prog-minimize'));
  if (small && document.activeElement === small) close?.focus();
  if (small) small.hidden = true;
}
/**
 * Sets the bar to "nothing running". A function instead of lines at logout: whoever resets from outside
 * would otherwise have to know the internals of this file and keep every new variable in mind.
 */
export function resetGive() {
  const bar = G('global-import-bar');
  if (bar) bar.style.display = 'none';
  gibStop();
  if (_gibCheckTimer) {
    clearInterval(_gibCheckTimer);
    _gibCheckTimer = null;
  }
  _gibLastCount = 0;
  const log = G('gib-log');
  if (log) log.replaceChildren();
}

// ── Register handlers with the dispatcher (see js/registry.js) ─────────────
// The handler belongs to the module that implements it.
registerActions({
  gibToggle,
  hideProgress,
  showLastImport,
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
  // The background hint only applies to capturing a single set. In the CSV import the step list is
  // hidden anyway, there the log (`csv-log`) shows a real result per row.
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
  const small = /** @type {HTMLElement | null} */ (document.querySelector('#progress-overlay .prog-minimize'));
  if (small) small.hidden = false;
}

export function hideProgress() {
  G('progress-overlay').classList.remove('open');
  G('prog-steps').style.display = '';
  // When minimizing, show the header bar if an import is running
  if ((_gibTimer || _gibSse) && loggedInAccount) {
    G('global-import-bar').style.display = 'flex';
  }
}

// `extra` was dropped: it wrote into a `.step-count` field that only the
// removed parts/part image steps had. Without these steps there is no element left it
// could have written into.
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
  const value = Math.max(0, Math.min(100, pct));
  G('prog-bar').style.width = value + '%';
  G('prog-bar-wrap')?.setAttribute('aria-valuenow', String(Math.round(value)));
}

/**
 * @param {string} text
 * @param {'ok' | 'warn' | 'er'} kind
 */
export function addCsvLog(text, kind) {
  const d = G('csv-log'),
    line = document.createElement('div');
  line.className = 'csv-log-line ' + kind;
  line.textContent = text;
  d.appendChild(line);
  d.scrollTop = d.scrollHeight;
}

/** An event of the stream when capturing; `step` says which fields it carries.
 * @typedef {{ step?: string, set?: string, set_number?: string, action?: string, error?: string, [feld: string]: unknown }} SseEvent */

// SSE events when capturing a set. Only set data and image are waited for; instructions, parts and
// price run in the background afterwards, and a bar for work nobody is waiting for would be a
// claim.
/**
 * @param {SseEvent} ev
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
/** Is the CSV import running from this window (then its loop shows the log)? */
export function csvPollActive() {
  return _csvPollActive;
}
/** @param {boolean} v */
export function setCsvPollActive(v) {
  _csvPollActive = v;
}

/** The running event stream (capture set) — so that "cancel" can end it. */
/** @type {AbortController | null} */
let _activeAbort = null;

export function streamDone() {
  _activeAbort = null;
  G('btn-cancel-import').style.display = 'none';
}

function cancelImport() {
  _csvPollActive = false;
  _activeAbort?.abort();
  _activeAbort = null;
  api('POST', '/v1/sets/import/csv/cancel');
  G('btn-cancel-import').style.display = 'none';
  hideProgress();
  toast(tRaw('csv.cancelled'), 'info');
  emit('setsChanged');
}

/** Cancelable event stream (POST with JSON body); a cancel ends without an error.
 * @param {string} path @param {object} body @param {(ev: SseEvent) => void} onEvent
 * @returns {Promise<void>} */
export function streamRequest(path, body, onEvent) {
  const ac = new AbortController();
  _activeAbort = ac;
  G('btn-cancel-import').style.display = 'inline-flex';
  return apiRaw('POST', path, { body, signal: ac.signal })
    .then(res => readSSE(res, onEvent, ac.signal))
    .catch(e => {
      if (e.name !== 'AbortError') throw e;
    });
}

/**
 * @param {Response} res
 * @param {(ev: SseEvent) => void} onEvent
 * @param {AbortSignal} signal
 */
async function readSSE(res, onEvent, signal) {
  // If the server answers with JSON instead of a stream, the matter is decided (e.g.: set already in
  // scope). The response goes through as one event; otherwise the display would wait for a data: line that
  // never comes.
  if ((res.headers.get('content-type') || '').includes('application/json')) {
    const data = await res.json().catch(() => null);
    if (data) onEvent({ step: data.success === false ? 'error' : 'done', ...data });
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
