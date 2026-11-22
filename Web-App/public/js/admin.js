// Background work for admins: job worker status, catalog and image follow-ups, Brickset queue.
import { genuine, registerActions } from './registry.js';
import { locale, t, tRaw } from '../i18n.js';
import { api } from './api.js';
import { ico, G, setHtml, ifVisible } from './dom.js';
import { fmtDate } from './format.js';
import { toast } from './messages.js';
import { html } from './escaping.js';

// ── JOB STATUS ───────────────────────────────────────────
/** @type {ReturnType<typeof setInterval> | null} */
let jobPollTimer = null;

/** Duration in the UI's own style ("1.5 s", "2 min 5 s"), not as "1.5s". @param {number | null | undefined} ms */
function formatDuration(ms) {
  if (!ms) return '';
  const num = (/** @type {number} */ n, digits = 0) =>
    n.toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });
  if (ms < 60000) return `${num(ms / 1000, 1)} s`;
  return `${num(Math.floor(ms / 60000))} min ${num(Math.floor((ms % 60000) / 1000))} s`;
}

/** The contract doesn't name the progress shape (PriceJobState.job is open); the service writes it this way.
 * @param {{ total?: number, current?: number, set?: string } | undefined} progress */
function showJobProgress(progress) {
  if (!progress) return;
  const pct = progress.total ? ((progress.current ?? 0) / progress.total) * 100 : 0;
  G('job-progress-wrap').style.display = 'flex';
  G('job-prog-bar').style.width = pct + '%';
  G('job-prog-txt').textContent = `${progress.current}/${progress.total}`;
  G('job-status-detail').textContent = progress.set ? tRaw('monitor.current', { set: progress.set }) : '';
}

/** The last run with its result, or the wait for the first one. @param {import('../../frontend-types/api').ApiSuccess<'GET', '/v2/admin/job-status'>['job']} j */
function showLastJobRun(j) {
  const dot = G('job-dot');
  const stxt = G('job-status-txt');
  const sdet = G('job-status-detail');
  const nextRun = j.nextRun ? `${tRaw('monitor.next_run')} ${fmtDate(j.nextRun, 'when')}` : '';
  if (!j.lastRun) {
    dot.style.background = 'var(--s300)';
    stxt.textContent = tRaw('monitor.waiting_first');
    sdet.textContent = nextRun;
    return;
  }
  dot.style.background = j.lastErrors > 0 ? 'var(--a500)' : 'var(--g500)';
  stxt.textContent = tRaw('monitor.last_run_at', { time: fmtDate(j.lastRun, 'datetime') });
  const parts = [];
  if (j.lastUpdated) parts.push(`${j.lastUpdated} ${tRaw('common.updated')}`);
  if (j.lastErrors) parts.push(tRaw('monitor.errors_n', { n: j.lastErrors }));
  if (j.lastDuration) parts.push(formatDuration(Number(j.lastDuration)));
  sdet.textContent = parts.join(' · ') + (nextRun ? ` · ${nextRun}` : '');
}

export async function pollJobStatus() {
  const d = await api('GET', '/v2/admin/job-status');
  if (!d.success) return;
  const j = d.job;
  const dot = G('job-dot');
  const btn = G('btn-job-trigger');
  btn.disabled = !!j.running;
  if (j.running) {
    dot.style.background = 'var(--b500)';
    dot.style.animation = 'sp .8s linear infinite';
    G('job-status-txt').textContent = tRaw('monitor.job_running');
    showJobProgress(/** @type {{ total?: number, current?: number, set?: string } | undefined} */ (j.progress));
    nextJobPoll(2000);
    return;
  }
  dot.style.animation = '';
  G('job-progress-wrap').style.display = 'none';
  showLastJobRun(j);
  nextJobPoll(30000);
}
/** Fast while the price run is active; polling rests in a hidden tab (ifVisible). @param {number} ms */
function nextJobPoll(ms) {
  if (jobPollTimer) clearTimeout(jobPollTimer);
  const timer = setTimeout(() => ifVisible(() => jobPollTimer === timer && pollJobStatus()), ms);
  jobPollTimer = timer;
}

/** @param {HTMLButtonElement} btn */
export async function triggerCsvSync(btn) {
  btn.disabled = true;
  btn.textContent = tRaw('monitor.starting');
  const d = await api('POST', '/v2/admin/trigger-csv-sync');
  if (d?.success) {
    toast(tRaw('monitor.sync_started'), 'success');
    btn.textContent = tRaw('monitor.started');
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = tRaw('monitor.sync_now');
    }, 5000);
  } else {
    toast(d?.error || t('settings.error'), 'error');
    btn.disabled = false;
    btn.textContent = tRaw('monitor.sync_now');
  }
}

/**
 * Queue all missing catalog images. The server only enqueues and fetches throttled in the background; the
 * response therefore names jobs, not images — "done" would be misleading over hours of runtime.
 */
/** @param {HTMLButtonElement} btn */
export async function queueCatalogImages(btn) {
  btn.disabled = true;
  btn.textContent = tRaw('monitor.starting');
  // The contract doesn't name these numbers (GenericAdminResponse); the service supplies them this way.
  const d =
    /** @type {{ success?: boolean, error?: string, pending?: number, skipped?: number, discarded?: number, duration_minutes?: number } | null} */ (
      await api('POST', '/v2/admin/catalog-images')
    );
  if (d?.success) {
    // Name both numbers: what's pending AND what was already done. Without the second, a "0 images
    // queued" would look like a failure, even though it's the best possible message — everything's there.
    const n = (d.pending ?? 0).toLocaleString(locale());
    const done = d.skipped ?? 0;
    const parts = [
      done > 0
        ? tRaw('monitor.catalog_images_queued_skipped', { n, done: done.toLocaleString(locale()) })
        : tRaw('monitor.catalog_images_queued', { n }),
    ];
    // Only name retried failures and the estimated duration when there's something to name — otherwise
    // the message grows by two zeros.
    if (d.discarded && d.discarded > 0)
      parts.push(tRaw('monitor.catalog_images_retried', { n: d.discarded.toLocaleString(locale()) }));
    if (d.duration_minutes && d.duration_minutes > 0)
      parts.push(tRaw('monitor.catalog_images_eta', { n: d.duration_minutes.toLocaleString(locale()) }));
    toast(parts.join(' · '), 'success');
    setHtml(btn, ico('ok'));
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = tRaw('monitor.catalog_images');
    }, 5000);
  } else {
    toast(d?.error || t('settings.error'), 'error');
    btn.disabled = false;
    btn.textContent = tRaw('monitor.catalog_images');
  }
}

/** @param {HTMLButtonElement} btn */
export async function redownloadMissingImages(btn) {
  btn.disabled = true;
  btn.textContent = tRaw('monitor.starting');
  const d = await api('POST', '/v2/admin/redownload-missing-images');
  if (d?.success) {
    toast(tRaw('monitor.redownload_started'), 'success');
    setHtml(btn, ico('ok'));
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = tRaw('monitor.redownload_missing');
    }, 5000);
  } else {
    toast(d?.error || t('settings.error'), 'error');
    btn.disabled = false;
    btn.textContent = tRaw('monitor.redownload_missing');
  }
}

/** @param {HTMLButtonElement} btn */
export async function reimportMissingInstructions(btn) {
  btn.disabled = true;
  btn.textContent = tRaw('common.loading');
  const d = await api('POST', '/v2/admin/reimport-instructions');
  if (d?.success) {
    toast(tRaw('monitor.enqueued', { n: d.enqueued }), 'success');
    btn.textContent = tRaw('monitor.enqueued_short', { n: d.enqueued });
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = tRaw('monitor.import_missing');
    }, 4000);
  } else {
    toast(d?.error || t('settings.error'), 'error');
    btn.disabled = false;
    btn.textContent = tRaw('monitor.import_missing');
  }
}

/** @param {HTMLButtonElement} btn */
export async function toggleBricksetQueue(btn) {
  const panel = G('brickset-queue-panel');
  if (!panel) return;
  if (panel.style.display !== 'none') {
    panel.style.display = 'none';
    const lbl = btn.querySelector('span') || btn;
    lbl.textContent = tRaw('monitor.show');
    return;
  }
  btn.textContent = tRaw('common.loading');
  await loadBricksetQueue();
  btn.textContent = tRaw('monitor.collapse');
}

/**
 * Fetch and render the queue — without toggling.
 *
 * Pulled out of toggleBricksetQueue() so retry and delete can reload the list. Before, both only went
 * through the toggle, and calling it would have collapsed the view instead of refreshing it — so the
 * entry, attempt counter and retry_after stayed visibly unchanged after a click.
 */
export async function loadBricksetQueue() {
  const panel = G('brickset-queue-panel');
  if (!panel) return;
  const d = await api('GET', '/v2/admin/brickset-queue');
  if (!d?.success) {
    setHtml(panel, html`<div data-style="color:var(--r500)">${tRaw('monitor.load_error')}</div>`);
    panel.style.display = 'block';
    return;
  }
  if (!d.entries?.length) {
    setHtml(panel, html`<div data-style="font-size:var(--fs-2);color:var(--mut)">${tRaw('monitor.no_entries')}</div>`);
    panel.style.display = 'block';
    return;
  }
  setHtml(
    panel,
    html`
    <div data-style="font-size:var(--fs-1);font-weight:700;color:var(--mut);margin-bottom:.5rem;text-transform:uppercase;letter-spacing:.5px">${tRaw('monitor.queue_entries', { n: d.count })}</div>
    <div data-style="display:flex;flex-direction:column;gap:.4rem;max-height:400px;overflow-y:auto">
      ${d.entries.map(
        e => html`
        <div id="bsq-${e.set_number}" data-style="display:flex;align-items:flex-start;gap:.5rem;padding:.5rem .6rem;background:var(--s50);border-radius:6px;font-size:var(--fs-2)">
          <div data-style="flex:1;min-width:0">
            <div data-style="font-weight:600">${e.set_number}${e.name ? html` — ${e.name}` : ''}</div>
            <div data-style="color:var(--mut);margin-top:.15rem">${tRaw('monitor.attempt', { a: e.attempts, r: e.retry_after })}</div>
            ${
              e.last_error
                ? html`
            <details data-style="margin-top:.25rem">
              <summary data-style="cursor:pointer;color:var(--r500);font-size:var(--fs-1);user-select:none">${tRaw('monitor.show_last_error')}</summary>
              <div data-style="margin-top:.2rem;padding:.3rem .4rem;background:var(--s100);border-radius:4px;font-family:monospace;font-size:var(--fs-1);white-space:pre-wrap;word-break:break-all;color:var(--r600);max-height:100px;overflow-y:auto">${e.last_error}</div>
            </details>`
                : ''
            }
          </div>
          <div data-style="display:flex;flex-direction:column;gap:.3rem;flex-shrink:0">
            <button class="btn bs btn-sm" data-style="padding:2px 8px;font-size:var(--fs-1)"
              data-click="retryBricksetQueueEntry" data-arg="${e.set_number}" data-self="1">${ico('refresh')}</button>
            <button class="btn bd btn-sm" data-style="padding:2px 8px;font-size:var(--fs-1)"
              data-click="deleteBricksetQueueEntry"${genuine()} data-arg="${e.set_number}" data-self="1">${ico('delete')}</button>
          </div>
        </div>`,
      )}
    </div>`,
  );
  panel.style.display = 'block';
}

/**
 * The element first, then data-arg: with data-self="1" the dispatcher (js/actions.js) puts the button
 * there first. Reversed, the button ended up as the set number in the address, and the server never found
 * an entry.
 */
/** @param {HTMLButtonElement} btn @param {string} setNumber */
async function retryBricksetQueueEntry(btn, setNumber) {
  btn.disabled = true;
  setHtml(btn, ico('clock'));
  const d = await api('POST', `/v2/admin/brickset-queue/${setNumber}/retry`);
  if (d?.success) {
    setHtml(btn, ico('ok'));
    toast(tRaw('monitor.retrying', { set: setNumber }), 'success');
    // Redraw the queue — retry_after and the attempt counter have changed. Before, the entry stayed with
    // its old values, which looked like a click with no effect.
    loadBricksetQueue();
    setTimeout(() => {
      btn.disabled = false;
      setHtml(btn, ico('refresh'));
    }, 3000);
  } else {
    btn.disabled = false;
    setHtml(btn, ico('refresh'));
    toast(tRaw('monitor.retry_error'), 'error');
  }
}

// Same order as retryBricksetQueueEntry above — element first.
/** @param {HTMLButtonElement} btn @param {string} setNumber */
async function deleteBricksetQueueEntry(btn, setNumber) {
  const row = G(`bsq-${setNumber}`);
  // Remove immediately from UI
  if (row) row.style.opacity = '0.4';
  btn.disabled = true;
  setHtml(btn, ico('clock'));
  const d = await api('DELETE', `/v2/admin/brickset-queue/${setNumber}`);
  if (d?.success) {
    if (row) row.remove();
    toast(tRaw('monitor.removed_fallback', { set: setNumber }), 'success');
  } else {
    if (row) row.style.opacity = '1';
    btn.disabled = false;
    setHtml(btn, ico('delete'));
    toast(tRaw('monitor.delete_error'), 'error');
  }
}

G('btn-job-trigger').onclick = async () => {
  const d = await api('POST', '/v2/admin/trigger-price-job');
  if (d.success && d.started) {
    toast(tRaw('monitor.job_started'), 'info');
    setTimeout(pollJobStatus, 1000);
  } else if (d.success && !d.started) toast(tRaw('monitor.job_already'), 'info');
  else toast(d.error || t('settings.error'), 'error');
};

// ── Register handlers with the dispatcher (see js/registry.js) ──────────────
registerActions({
  deleteBricksetQueueEntry,
  redownloadMissingImages,
  queueCatalogImages,
  reimportMissingInstructions,
  retryBricksetQueueEntry,
  toggleBricksetQueue,
  triggerCsvSync,
});

/** Stop the running job-status poll (tab switch). */
export function stopJobPolling() {
  if (jobPollTimer) clearTimeout(jobPollTimer);
  jobPollTimer = null;
}
