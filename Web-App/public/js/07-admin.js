// Hintergrundarbeiten für Verwalter: Status des Auftrags-Workers, Katalog-
// und Bild-Nachläufe, Brickset-Warteschlange.
import { echt, registerActions } from './00-registry.js';
import { locale, t, tRaw} from '../i18n.js';
import { fmtDatum, ico, G, api, toast } from './01-core.js';
import { _settingsCache, _pnlCache } from './00-zustand.js';
import { esc } from './00-escapen.js';

// ── JOB STATUS ───────────────────────────────────────────
export let jobPollTimer = null;

function formatDur(ms) {
  if (!ms) return '';
  if (ms < 60000) return `${(ms/1000).toFixed(1)}s`;
  return `${Math.floor(ms/60000)}m ${Math.floor((ms%60000)/1000)}s`;
}

export async function pollJobStatus() {
  const d = await api('GET', '/v1/admin/job-status');
  if (!d.success) return;
  const j = d.job;
  const dot = G('job-dot');
  const stxt = G('job-status-txt');
  const sdet = G('job-status-detail');
  const pwrap = G('job-progress-wrap');
  const pbar = G('job-prog-bar');
  const ptxt = G('job-prog-txt');
  const btn = G('btn-job-trigger');

  if (j.running) {
    dot.style.background = 'var(--b500)';
    dot.style.animation = 'sp .8s linear infinite';
    stxt.textContent = tRaw('monitor.job_running');
    if (j.progress) {
      const pct = j.progress.total ? (j.progress.current / j.progress.total * 100) : 0;
      pwrap.style.display = 'flex';
      pbar.style.width = pct + '%';
      ptxt.textContent = `${j.progress.current}/${j.progress.total}`;
      sdet.textContent = j.progress.set ? t('monitor.current',{set:j.progress.set}) : '';
    }
    btn.disabled = true;
    // Poll faster while running
    if (jobPollTimer) clearTimeout(jobPollTimer);
    jobPollTimer = setTimeout(pollJobStatus, 2000);
  } else {
    dot.style.animation = '';
    pwrap.style.display = 'none';
    btn.disabled = false;
    if (j.lastRun) {
      dot.style.background = j.lastErrors > 0 ? 'var(--a500)' : 'var(--g500)';
      stxt.textContent = tRaw('monitor.last_run_at',{time:new Date(j.lastRun).toLocaleString(locale())});
      const parts = [];
      if (j.lastUpdated) parts.push(`${j.lastUpdated} ${t('common.updated')}`);
      if (j.lastErrors)  parts.push(t('monitor.errors_n',{n:j.lastErrors}));
      if (j.lastDuration) parts.push(formatDur(j.lastDuration));
      sdet.textContent = parts.join(' · ') + (j.nextRun ? ` · ${t('monitor.next_run')} ${fmtDatum(j.nextRun, 'zeit')}` : '');
    } else {
      dot.style.background = 'var(--s300)';
      stxt.textContent = tRaw('monitor.waiting_first');
      sdet.textContent = j.nextRun ? `Startet um: ${fmtDatum(j.nextRun, 'zeit')}` : '';
    }
    // Poll every 30s while idle
    if (jobPollTimer) clearTimeout(jobPollTimer);
    jobPollTimer = setTimeout(pollJobStatus, 30000);
  }
}

export async function triggerCsvSync(btn) {
  btn.disabled = true; btn.textContent = tRaw('monitor.starting');
  const d = await api('POST', '/v1/admin/trigger-csv-sync').catch(() => null);
  if (d?.success) {
    toast(tRaw('monitor.sync_started'), 'success');
    btn.textContent = tRaw('monitor.started');
    setTimeout(() => { btn.disabled = false; btn.textContent = tRaw('monitor.sync_now'); }, 5000);
  } else {
    toast(d?.error || t('settings.error'), 'error');
    btn.disabled = false; btn.textContent = tRaw('monitor.sync_now');
  }
}

/**
 * Alle fehlenden Katalogbilder einreihen.
 *
 * Marcos Wunsch: „Wenn dieser geklickt wird, sollen alle fehlenden Bilder des
 * Katalogs heruntergeladen werden resp. in die Queue gestellt werden."
 *
 * Der Server reiht nur ein — geholt wird im Hintergrund, gedrosselt
 * (jobs/imageQueue.ts). Die Rückmeldung nennt deshalb die Zahl der Aufträge,
 * nicht der Bilder: „gestartet" wäre irreführend, das dauert je nach
 * Katalogumfang Stunden.
 */
export async function queueCatalogImages(btn) {
  btn.disabled = true; btn.textContent = tRaw('monitor.starting');
  const d = await api('POST', '/v1/admin/catalog-images').catch(() => null);
  if (d?.success) {
    // Beide Zahlen nennen: was ansteht UND was schon fertig war. Ohne die
    // zweite sähe ein „0 Bilder in der Warteschlange" nach einem Fehlschlag
    // aus, obwohl es die beste aller Meldungen ist — alles ist da.
    const n = (d.pending ?? 0).toLocaleString(locale());
    const fertig = d.skipped ?? 0;
    const teile = [fertig > 0
      ? tRaw('monitor.catalog_images_queued_skipped',
             { n, fertig: fertig.toLocaleString(locale()) })
      : tRaw('monitor.catalog_images_queued', { n })];
    // Zurückgenommene Fehlanzeigen und die geschätzte Dauer nur nennen, wenn es
    // etwas zu nennen gibt — sonst wächst die Meldung um zwei Nullen.
    if (d.verworfen > 0)
      teile.push(tRaw('monitor.catalog_images_retried',
                      { n: d.verworfen.toLocaleString(locale()) }));
    if (d.dauer_minuten > 0)
      teile.push(tRaw('monitor.catalog_images_eta',
                      { n: d.dauer_minuten.toLocaleString(locale()) }));
    toast(teile.join(' · '), 'success');
    btn.innerHTML = ico('ok');
    setTimeout(() => { btn.disabled = false; btn.textContent = tRaw('monitor.catalog_images'); }, 5000);
  } else {
    toast(d?.error || t('settings.error'), 'error');
    btn.disabled = false; btn.textContent = tRaw('monitor.catalog_images');
  }
}

export async function redownloadMissingImages(btn) {
  btn.disabled = true; btn.textContent = tRaw('monitor.starting');
  const d = await api('POST', '/v1/admin/redownload-missing-images').catch(() => null);
  if (d?.success) {
    toast(tRaw('monitor.redownload_started'), 'success');
    btn.innerHTML = ico('ok');
    setTimeout(() => { btn.disabled = false; btn.textContent = tRaw('monitor.redownload_missing'); }, 5000);
  } else {
    toast(d?.error || t('settings.error'), 'error');
    btn.disabled = false; btn.textContent = tRaw('monitor.redownload_missing');
  }
}

export async function reimportMissingInstructions(btn) {
  btn.disabled = true; btn.textContent = tRaw('common.loading');
  const d = await api('POST', '/v1/admin/reimport-instructions').catch(() => null);
  if (d?.success) {
    toast(tRaw('monitor.enqueued',{n:d.enqueued}), 'success');
    btn.textContent = tRaw('monitor.enqueued_short',{n:d.enqueued});
    setTimeout(() => { btn.disabled = false; btn.textContent = tRaw('monitor.import_missing'); }, 4000);
  } else {
    toast(d?.error || t('settings.error'), 'error');
    btn.disabled = false; btn.textContent = tRaw('monitor.import_missing');
  }
}

export async function toggleBricksetQueue(btn) {
  const panel = G('brickset-queue-panel');
  if (!panel) return;
  if (panel.style.display !== 'none') {
    panel.style.display = 'none';
    const lbl = btn.querySelector('span') || btn; lbl.textContent = tRaw('monitor.show');
    return;
  }
  btn.textContent = tRaw('common.loading');
  await loadBricksetQueue();
  btn.textContent = tRaw('monitor.collapse');
}

/**
 * Warteschlange holen und zeichnen — ohne Umschalten.
 *
 * Aus toggleBricksetQueue() herausgelöst, damit Retry und Löschen die Liste
 * nachladen können. Vorher ging beides nur über das Umschalten, und ein Aufruf
 * hätte die Anzeige zugeklappt statt aktualisiert — deshalb blieben Eintrag,
 * Versuchszähler und retry_after nach einem Klick sichtbar unverändert stehen.
 */
export async function loadBricksetQueue() {
  const panel = G('brickset-queue-panel');
  if (!panel) return;
  const d = await api('GET', '/v1/admin/brickset-queue').catch(() => null);
  if (!d?.success) { panel.innerHTML = `<div data-stil="color:var(--r500)">${t('monitor.load_error')}</div>`; panel.style.display='block'; return; }
  if (!d.entries?.length) { panel.innerHTML = `<div data-stil="font-size:var(--fs-2);color:var(--mut)">${t('monitor.no_entries')}</div>`; panel.style.display='block'; return; }
  panel.innerHTML = `
    <div data-stil="font-size:var(--fs-1);font-weight:700;color:var(--mut);margin-bottom:.5rem;text-transform:uppercase;letter-spacing:.5px">${t('monitor.queue_entries',{n:d.count})}</div>
    <div data-stil="display:flex;flex-direction:column;gap:.4rem;max-height:400px;overflow-y:auto">
      ${d.entries.map(e => `
        <div id="bsq-${esc(e.set_number)}" data-stil="display:flex;align-items:flex-start;gap:.5rem;padding:.5rem .6rem;background:var(--s50);border-radius:6px;font-size:var(--fs-2)">
          <div data-stil="flex:1;min-width:0">
            <div data-stil="font-weight:600">${esc(e.set_number)}${e.name ? ` — ${esc(e.name)}` : ''}</div>
            <div data-stil="color:var(--mut);margin-top:.15rem">${t('monitor.attempt',{a:e.attempts,r:e.retry_after})}</div>
            ${e.last_error ? `
            <details data-stil="margin-top:.25rem">
              <summary data-stil="cursor:pointer;color:var(--r500);font-size:var(--fs-1);user-select:none">${t('monitor.show_last_error')}</summary>
              <div data-stil="margin-top:.2rem;padding:.3rem .4rem;background:var(--s100);border-radius:4px;font-family:monospace;font-size:var(--fs-1);white-space:pre-wrap;word-break:break-all;color:var(--r600);max-height:100px;overflow-y:auto">${esc(e.last_error)}</div>
            </details>` : ''}
          </div>
          <div data-stil="display:flex;flex-direction:column;gap:.3rem;flex-shrink:0">
            <button class="btn bs btn-sm" data-stil="padding:2px 8px;font-size:var(--fs-1)"
              data-click="retryBricksetQueueEntry" data-arg="${esc(e.set_number)}" data-self="1">${ico('aktualisieren')}</button>
            <button class="btn bd btn-sm" data-stil="padding:2px 8px;font-size:var(--fs-1)"
              data-click="deleteBricksetQueueEntry"${echt()} data-arg="${esc(e.set_number)}" data-self="1">${ico('loeschen')}</button>
          </div>
        </div>`).join('')}
    </div>`;
  panel.style.display = 'block';
}

/**
 * ── Argumentreihenfolge ─────────────────────────────────────────────────────
 * Der Dispatcher (js/11-actions.js) legt bei data-self="1" ZUERST das Element
 * an und hängt danach die data-arg-Werte an:
 *
 *     if (el.dataset.self === '1') args.push(el);
 *     for (const key of ['data-arg', …]) args.push(…);
 *
 * Die Signatur lautete (setNumber, btn) — genau verdreht. Folge: setNumber war
 * das Knopf-Element. Die Meldung zeigte deshalb
 * "[object HTMLButtonElement] wird erneut versucht", und die Adresse lautete
 * /v1/admin/brickset-queue/[object%20HTMLButtonElement]/retry — der Server
 * fand unter diesem Namen nie einen Eintrag und setzte dessen retry_after
 * folglich nie zurück.
 *
 * Die übrigen data-self-Handler (triggerCsvSync, toggleBricksetQueue, …) haben
 * kein data-arg und waren deshalb nie betroffen.
 */
async function retryBricksetQueueEntry(btn, setNumber) {
  btn.disabled = true; btn.innerHTML = ico('uhr');
  const d = await api('POST', `/v1/admin/brickset-queue/${setNumber}/retry`).catch(() => null);
  if (d?.success) {
    btn.innerHTML = ico('ok');
    toast(tRaw('monitor.retrying',{set:setNumber}), 'success');
    // Warteschlange neu zeichnen — retry_after und Versuchszähler haben sich
    // geändert. Vorher blieb der Eintrag mit den alten Werten stehen, was wie
    // ein wirkungsloser Klick aussah.
    loadBricksetQueue();
    setTimeout(() => { btn.disabled = false; btn.innerHTML = ico('aktualisieren'); }, 3000);
  } else {
    btn.disabled = false; btn.innerHTML = ico('aktualisieren');
    toast(tRaw('monitor.retry_error'), 'error');
  }
}

// Gleiche Reihenfolge wie retryBricksetQueueEntry oben — Element zuerst.
async function deleteBricksetQueueEntry(btn, setNumber) {
  const row = G(`bsq-${setNumber}`);
  // Remove immediately from UI
  if (row) row.style.opacity = '0.4';
  btn.disabled = true; btn.innerHTML = ico('uhr');
  const d = await api('DELETE', `/v1/admin/brickset-queue/${setNumber}`).catch(() => null);
  if (d?.success) {
    if (row) row.remove();
    toast(tRaw('monitor.removed_fallback',{set:setNumber}), 'success');
  } else {
    if (row) row.style.opacity = '1';
    btn.disabled = false; btn.innerHTML = ico('loeschen');
    toast(tRaw('monitor.delete_error'), 'error');
  }
}

G('btn-job-trigger').onclick = async () => {
  const d = await api('POST', '/v1/admin/trigger-price-job');
  if (d.success && d.started) { toast(tRaw('monitor.job_started'), 'info'); setTimeout(pollJobStatus, 1000); }
  else if (d.success && !d.started) toast(tRaw('monitor.job_already'), 'info');
  else toast(d.error || t('settings.error'), 'error');
};


// ── Handler beim Dispatcher anmelden (siehe js/00-registry.js) ──────────────
registerActions({
  deleteBricksetQueueEntry,
  redownloadMissingImages,
  queueCatalogImages,
  reimportMissingInstructions,
  retryBricksetQueueEntry,
  toggleBricksetQueue,
  triggerCsvSync,
});

/**
 * Setter für jobPollTimer — importierte Bindungen sind in ES-Modulen schreibgeschützt.
 * Ersetzt die frühere direkte Zuweisung aus einer anderen Datei, die mit
 * globalen Variablen noch möglich war.
 * @param {any} v
 */
export function set_jobPollTimer(v) { jobPollTimer = v; }


