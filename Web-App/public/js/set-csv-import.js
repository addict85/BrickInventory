import { emit } from './events.js';
import { registerActions } from './registry.js';
import { LANG, t, tRaw } from '../i18n.js';
import { fehlerMeldung, api, apiDaten, strom } from './api.js';
import { G } from './dom.js';
import { fmtPct } from './format.js';
import { toast } from './meldungen.js';
import {
  gibStart,
  importZaehler,
  protokollZeile,
  csvPollAktiv,
  addCsvLog,
  hideProgress,
  setProgBar,
  showProgress,
  setzeCsvPollAktiv,
  zeigeImportAbschluss,
} from './fortschritt.js';
import { confirmDelete } from './rueckfrage.js';

// Set CSV import from the gallery: preflight check, the job's stream, and polling if the stream drops.
// CSV import via SSE stream — choosing a file starts the import directly (like the parts import)
async function startSetCsvImport() {
  const fi = G('csv-file');
  const file = fi.files?.[0];
  if (!file) {
    toast(tRaw('csv.select_file'), 'error');
    return;
  }
  const formData = () => {
    const fd = new FormData();
    fd.append('file', file);
    return fd;
  };
  // Let it read first, then ask: the import increases the quantity for existing sets, while adding a
  // single set rejects the same set. Anyone who picks a file twice should find out beforehand.
  const preflight = await api('POST', '/v1/sets/import/csv?pruefen=1', formData());
  if (!preflight.success) {
    toast(preflight.error || tRaw('settings.error'), 'error');
    fi.value = '';
    return;
  }
  if (
    (preflight.vorhanden ?? 0) > 0 &&
    !(await confirmDelete(
      tRaw('csv.vorhanden_titel'),
      tRaw('csv.vorhanden_text', {
        n: preflight.vorhanden ?? 0,
        nummern: (preflight.vorhanden_nummern || []).slice(0, 5).join(', '),
      }),
      'import',
      { knopf: 'csv.vorhanden_knopf', art: 'bp' },
    ))
  ) {
    fi.value = '';
    return;
  }
  showProgress(tRaw('csv.import_title'), true);
  try {
    // Start import job (returns immediately)
    const startData = await api('POST', '/v1/sets/import/csv', formData());
    if (!startData.success) {
      hideProgress();
      toast(startData.error || t('settings.error'), 'error');
      return;
    }
    const total = startData.total;
    // Name any skipped rows — the import keeps running regardless, but anyone who sends 500 rows and
    // gets 498 imported should find out.
    if (startData.skipped_hint) toast(startData.skipped_hint, 'info');
    G('prog-footer').textContent = tRaw('csv.items_progress', { done: 0, total });
    G('prog-set-name').textContent = tRaw('csv.wartet');

    setzeCsvPollAktiv(true);
    gibStart(); // show the global bar (this window and others)
    G('btn-cancel-import').style.display = 'inline-flex';

    // Progress preferably via SSE; a polling fallback only on failure.
    const ctx = { total: total ?? 0, prevDone: /** @type {number | null | undefined} */ (-1), prevResultCount: 0 };
    // Without `?token=`: the cookie carries the channel, a token in the address would just be the
    // session token sitting in the log.

    await /** @type {Promise<void>} */ (
      new Promise(resolve => {
        let settled = false;
        const finish = () => {
          if (!settled) {
            settled = true;
            resolve();
          }
        };

        const s = strom(`/v1/sets/import/csv/stream?sprache=${encodeURIComponent(LANG)}`, {
          ereignis: state => {
            if (csvApplyOverlayStatus(state, ctx, fi)) {
              s?.schliesse();
              finish();
            }
          },
          // Stream gone → fall back to polling
          fehler: () => {
            if (!settled) csvPollLoop(ctx, fi).then(finish);
          },
        });
        if (!s) csvPollLoop(ctx, fi).then(finish);
      })
    );
  } catch (e) {
    hideProgress();
    toast(fehlerMeldung(e), 'error');
  }
}

// Processes a CSV status object for the starting window's overlay. Returns true once the import is done.
/**
 * @param {import('./fortschritt.js').ImportStand} s
 * @param {{ total: number, prevDone: number | null | undefined, prevResultCount: number }} ctx
 * @param {HTMLInputElement | null} fi
 */
function csvApplyOverlayStatus(s, ctx, fi) {
  if (!s.success) return true;
  const total = ctx.total;
  if (s.done !== ctx.prevDone) {
    ctx.prevDone = s.done;
    const done = s.done ?? 0;
    const pct = total > 0 ? (done / total) * 95 : 0;
    setProgBar(pct);
    G('prog-footer').textContent = `${tRaw('csv.items_progress', { done, total })} (${importZaehler(s)})`;
    G('prog-set-name').textContent = s.current
      ? tRaw('csv.verarbeite', { set: s.current, done, total })
      : done === 0 && s.status === 'running'
        ? tRaw('csv.wartet')
        : '';
    // Update the progress bar in the header directly
    {
      const _p = total > 0 ? Math.round((done / total) * 100) : 0;
      const _b = G('global-import-bar');
      if (_b) {
        _b.style.display = 'flex';
        G('gib-fill').style.width = _p + '%';
        G('gib-text').textContent = done + '/' + total + ' (' + fmtPct(_p, { vorzeichen: false, stellen: 0 }) + ')';
      }
    }
    // Show live results as they come in
    if (s.results && s.results.length > ctx.prevResultCount) {
      const newResults = s.results.slice(ctx.prevResultCount);
      newResults.forEach(r => {
        // Same builder as in fortschritt.js — the reasoning lives there.
        const z = protokollZeile(r);
        if (z) addCsvLog(z.text, z.art);
      });
      ctx.prevResultCount = s.results.length;
    }
  }
  if (s.status === 'done' || s.status === 'cancelled' || s.status === 'error') {
    setzeCsvPollAktiv(false);
    G('btn-cancel-import').style.display = 'none';
    setProgBar(100);
    if (s.status === 'error') {
      hideProgress();
      toast(s.error || t('csv.import_error'), 'error');
    } else {
      // Add any remaining results not yet shown in live log
      if (s.results) {
        const remaining = s.results.slice(ctx.prevResultCount);
        remaining.forEach(r => {
          // Same row builder as in fortschritt.js. No esc(), because addCsvLog sets textContent; the
          // timeout-retry hint only applies here.
          const z = protokollZeile(r, tRaw('csv.timeout_retry'));
          if (z) addCsvLog(z.text, z.art);
        });
        ctx.prevResultCount = s.results.length;
      }
      if ((s.err ?? 0) > 0) {
        const errorSets = (s.results || []).filter(r => !r.success);
        const errorList = errorSets.map(r => r.set_number + ': ' + (r.error || '?')).join('; ');
        console.warn('[CSV Import] Fehler: ' + errorList);
      }
      const counter = importZaehler(s, 'csv.warnings_n');
      G('prog-footer').textContent = `${tRaw('csv.zeilen_gelesen', { n: s.total ?? 0 })} · ${counter}`;
      zeigeImportAbschluss();
      emit('sammlungLaden');
      toast(tRaw('csv.import_meldung', { ergebnis: counter }), s.err ? 'error' : s.warn ? 'info' : 'success');
      if (fi) fi.value = '';
    }
    return true;
  }
  return false;
}

// Polling fallback for the starting window (only when SSE is unavailable).
/**
 * @param {{ total: number, prevDone: number | null | undefined, prevResultCount: number }} ctx
 * @param {HTMLInputElement | null} fi
 */
async function csvPollLoop(ctx, fi) {
  while (csvPollAktiv()) {
    await new Promise(r => setTimeout(r, 1500));
    if (!csvPollAktiv()) break;
    try {
      // apiDaten instead of api: api() would overwrite the `status` field with the HTTP status, and the
      // loop would never end.
      const s = await apiDaten('GET', '/v1/sets/import/csv/status');
      if (s && csvApplyOverlayStatus(/** @type {import('./fortschritt.js').ImportStand} */ (s), ctx, fi)) break;
    } catch (e) {
      console.warn('Poll error:', e);
    }
  }
}

// ── Register handlers with the dispatcher (see js/registry.js) ──────────────
registerActions({
  startSetCsvImport,
});
