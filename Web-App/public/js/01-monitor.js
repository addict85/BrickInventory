// ── Überwachung: Jobliste im Reiter „Monitoring" und das Protokollfenster ────
//
// ── Warum eine eigene Datei (Nachtrag 141) ──────────────────────────────────
//
// Dieser Block lag in js/01-core.js. Deren Kopfzeile nennt als Inhalt „Utils,
// i18n-Glue, Auth & Panels, Login/Logout, CSV-Import-Fortschrittsbalken" — die
// Überwachung stand nicht darin. Sie war damit nicht nur gross, sondern in
// einer Datei, die selbst behauptete, sie nicht zu enthalten.
//
// Dass openLogViewer() zwischen dem Fortschrittsbalken und der Jobliste
// eingekeilt war, statt bei ihr, ist das Merkmal einer Ablage: Wer etwas
// hinzufügt, hängt es dort an, wo er gerade liest. Hier stehen jetzt beide
// Seiten der Überwachung beieinander — die Liste, die zeigt, was läuft, und
// das Fenster, das zeigt, was dabei protokolliert wurde.
import { registerActions } from './00-registry.js';
import { G, api, esc, escHtmlAttr, toast } from './01-core.js';
import { LANG, locale, t, tRaw } from '../i18n.js';

/**
 * Zeitgeber, der die Jobliste nachzieht, solange der Reiter offen ist.
 *
 * Er steht hier und nicht in 01-core.js, weil nur diese Datei ihn setzt —
 * js/02-gallery.js hält ihn beim Reiterwechsel an, dafür gibt es den Setter
 * unten.
 */
export let _monitorTimer = null;

function openLogViewer() {
  const win = window.open('', '_blank', 'width=1200,height=750,resizable=yes,scrollbars=yes');
  if (!win) { alert(tRaw('popup.blocked')); return; }
  const token = localStorage.getItem('authToken') || '';
  const base  = window.location.origin;

  const css = [
    '*{box-sizing:border-box;margin:0;padding:0}',
    'body{font-family:monospace;background:#0d1117;color:#e6edf3;display:flex;flex-direction:column;height:100vh;overflow:hidden}',
    'header{background:#161b22;border-bottom:1px solid #30363d;padding:10px 16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;flex-shrink:0}',
    'h1{font-size:.95rem;font-weight:700;color:#58a6ff;white-space:nowrap}',
    'select,input[type=text]{font-family:monospace;font-size:.8rem;padding:4px 8px;border-radius:5px;border:1px solid #30363d;background:#21262d;color:#e6edf3}',
    'input[type=text]{width:200px}input[type=text]::placeholder{color:#8b949e}',
    'button{font-family:monospace;font-size:.8rem;padding:4px 10px;border-radius:5px;border:1px solid #30363d;background:#21262d;color:#e6edf3;cursor:pointer;white-space:nowrap}',
    'button:hover{background:#30363d}button.active{background:#1f6feb;border-color:#388bfd;color:#fff}',
    '.sep{color:#30363d;font-size:.8rem}#status{font-size:.75rem;color:#8b949e;white-space:nowrap}',
    '#log-wrap{flex:1;overflow-y:auto;padding:4px 0}',
    '.ll{padding:1px 14px;font-size:.76rem;line-height:1.55;white-space:pre-wrap;word-break:break-all;border-left:3px solid transparent;display:flex;gap:8px}',
    '.ll:hover{background:#161b22}.ll.warn{color:#e3b341;border-left-color:#e3b341}',
    '.ll.error{color:#f85149;border-left-color:#f85149;background:#16040a}',
    '.ll.info{color:#c9d1d9;border-left-color:#21262d}',
    '.ts{color:#8b949e;flex-shrink:0;user-select:none}.lv{flex-shrink:0;width:38px;font-weight:700;text-transform:uppercase;font-size:.68rem}',
    '.lv.info{color:#58a6ff}.lv.warn{color:#e3b341}.lv.error{color:#f85149}.msg{flex:1}',
    'mark{background:#e3b34133;color:inherit;border-radius:2px}',
    '.toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
    '.lvbtn{padding:3px 9px;font-size:.75rem}',
    '.lvbtn.info-btn.active{background:#1f3b6e;border-color:#58a6ff;color:#58a6ff}',
    '.lvbtn.warn-btn.active{background:#3b2f0e;border-color:#e3b341;color:#e3b341}',
    '.lvbtn.error-btn.active{background:#3b0f0f;border-color:#f85149;color:#f85149}',
  ].join('\n');

  // Die Zeitspannen als Daten statt als sechs ausgeschriebene <option>: So
  // steht die Beschriftung EINMAL da, in der Sprache des Nutzers. Vorher
  // waren es sechs deutsche Literale — in einem Fenster, das ein englischer
  // Verwalter genauso oeffnet.
  const spannen = [15, 30, 60, 360, 1440, 2880].map((min) => {
    const text = min < 60 ? t('log.minutes_n', { n: min })
      : min === 60 ? t('log.hour_1')
      : t('log.hours_n', { n: min / 60 });
    return '<option value="' + min + '">' + text + '</option>';
  }).join('');

  const html = '<!DOCTYPE html><html lang="' + escHtmlAttr(LANG) + '"><head>' +
    '<meta charset="UTF-8"><title>' + esc(t('log.title')) + '</title>' +
    '<style>' + css + '</style>' +
    '</head><body' +
      ' data-auth="' + escHtmlAttr(token) + '"' +
      ' data-base="' + escHtmlAttr(base) + '"' +
      ' data-i18n="' + escHtmlAttr(JSON.stringify({
        'common.loading':       t('common.loading'),
        'common.network_error': t('common.network_error'),
        'log.none_found':       t('log.none_found'),
        'log.entries':          t('log.entries'),
        'toast.error':          t('toast.error'),
        // Die beiden Beschriftungen des Auto-Knopfes wechseln zur Laufzeit;
        // logviewer.js hatte sie deshalb als deutsche Literale.
        'log.auto':             t('log.auto'),
        'log.stop':             t('log.stop'),
      })) + '">' +
    '<header>' +
      '<h1>' + esc(t('log.title')) + '</h1>' +
      '<div class="toolbar">' +
        '<select id="period" data-change="loadLogs">' + spannen + '</select>' +
        '<span class="sep">|</span>' +
        '<button class="lvbtn info-btn" id="btn-info" data-click="toggleLevel" data-arg="info">\u2139 Info</button>' +
        '<button class="lvbtn warn-btn active" id="btn-warn" data-click="toggleLevel" data-arg="warn">\u26A0 Warn</button>' +
        '<button class="lvbtn error-btn active" id="btn-error" data-click="toggleLevel" data-arg="error">\u2716 Error</button>' +
        '<span class="sep">|</span>' +
        '<input id="search" type="text" placeholder="' + escHtmlAttr(t('log.search')) + '" data-input="renderLogs">' +
        '<span class="sep">|</span>' +
        '<button data-click="loadLogs">'+t('log.reload')+'</button>' +
        '<button data-click="toggleAuto" id="btn-auto">' + esc(t('log.auto')) + '</button>' +
        '<span id="status">\u2013</span>' +
      '</div>' +
    '</header>' +
    '<div id="log-wrap"></div>' +
    '<script src="/js/logviewer.js?v=' + (window.__APP_VERSION || Date.now()) + '"><\/script>' +
    '</body></html>';

  win.document.write(html);
  win.document.close();
}

// Übersetzt Server-seitige Job-Sub-Texte (background jobs kennen die
// Nutzersprache nicht). Bekannte Muster werden clientseitig ersetzt.
function translateJobSub(sub) {
  if (!sub) return '';
  let m;
  m = sub.match(/^Alle (\d+) gemappt$/);
  if (m) return t('monitor.sub.all_mapped', {n: m[1]});
  if (sub === 'Alle erledigt') return t('monitor.sub.all_done');
  m = sub.match(/^Alle (\d+) Bilder gecacht$/);
  if (m) return t('monitor.sub.imgs_cached', {n: m[1]});
  if (sub === 'Alle Bilder gecacht') return t('monitor.sub.imgs_cached', {n: '✓'});
  if (/^Keine aktiven/.test(sub)) return t('monitor.sub.no_active');
  m = sub.match(/^(\d+) Sets bereit zum Retry, (\d+) warten$/);
  if (m) return t('monitor.sub.retry_ready', {n: m[1], w: m[2]});
  m = sub.match(/^(\d+) aktualisiert, (\d+) Fehler — ([\d.]+)s$/);
  if (m) return t('monitor.sub.updated_errors', {upd: m[1], err: m[2], sec: m[3]});
  if (sub === 'Starte\u2026' || sub === 'Starte...') return t('monitor.starting');
  return sub; // unrecognised: pass through as-is
}

// Speichert den Zeitplan eines Jobs (Monitoring). payload = {time:"HH:MM"} oder {minutes:n}.
export async function saveJobSchedule(name, payload) {
  const d = await api('POST', '/v1/admin/job-schedule', { name, ...payload }).catch(() => null);
  if (d?.success) toast(tRaw('monitor.sched.saved'), 'success');
  else toast(d?.error || t('settings.error'), 'error');
}


export async function loadMonitor() {
  const el = G('monitor-content');
  if (!el) return;
  if (_monitorTimer) clearInterval(_monitorTimer);
  const render = async () => {
    const d = await fetch('/api/v1/admin/jobs').then(r=>r.json()).catch(()=>null);
    if (!d?.success) return;
    // Nicht neu rendern, während der Nutzer gerade eine Zeitplan-Eingabe bearbeitet
    // (sonst würde das 3s-Re-Render die Eingabe/den Fokus verwerfen).
    const _ae = document.activeElement;
    if (_ae && _ae.classList && _ae.classList.contains('job-sched-input')) return;
    const { jobs, db: dbStats, schedules } = d;
    // Zeitplan-Control je Job: tägliche Jobs -> Uhrzeit (HH:MM), Preis-Job -> Intervall (min).
    // ── Warum die Werte durch esc() gehen ─────────────────────────────────
    //
    // Der Server prueft den Zeitplan (routes/api_v1/admin.ts: /^(\d{1,2}):(\d{2})$/
    // fuer die Uhrzeit, parseInt fuer die Minuten) — heute kann hier also
    // nichts Boesartiges ankommen.
    //
    // Trotzdem: `data-arg="${esc(k)}"` in derselben Zeile geht durch esc(),
    // diese beiden gingen es nicht. Eine Zeile, die dieselbe Regel zweimal
    // verschieden anwendet, ist der Anfang der naechsten Luecke — und die
    // Absicherung laege sonst in einer anderen Datei, die niemand mitliest,
    // wenn er hier etwas aendert.
    const schedInput = (k) => {
      const sc = schedules?.[k];
      if (!sc) return '';
      if (sc.type === 'daily') {
        return `<input type="time" class="job-sched-input" value="${esc(sc.time)}" title="${t('monitor.sched.daily_hint')}" data-change="saveJobTime" data-arg="${esc(k)}" style="font-size:.75rem;padding:2px 5px;border:1px solid var(--bdr);border-radius:6px;background:var(--sur);color:var(--txt)">`;
      }
      if (sc.type === 'interval') {
        return `<span style="display:inline-flex;align-items:center;gap:3px;font-size:.72rem;color:var(--mut)" title="${t('monitor.sched.interval_hint')}"><input type="number" min="5" class="job-sched-input" value="${esc(sc.minutes)}" data-change="saveJobMinutes" data-arg="${esc(k)}" style="width:54px;font-size:.75rem;padding:2px 5px;border:1px solid var(--bdr);border-radius:6px;background:var(--sur);color:var(--txt)"> ${t('monitor.sched.min')}</span>`;
      }
      return '';
    };
    const jobIconSvg = (k) => {
      const svgs = {
        // CSV-Import (Rebrickable): kleine Tabelle/Raster mit farbigen Zeilen
        csvImport: '<rect x="12" y="20" width="96" height="18" rx="2" fill="#0055BF"/><rect x="12" y="44" width="96" height="18" rx="2" fill="#F2CD37"/><rect x="12" y="68" width="96" height="18" rx="2" fill="#E63329"/><rect x="12" y="92" width="96" height="18" rx="2" fill="#9BA19D"/>',
        // BrickLink IDs nachladen: zwei verbundene Ringe (Verknüpfung/Mapping)
        blIds: '<path d="M40,45 a20,20 0 1,0 0.1,0" fill="none" stroke="#0055BF" stroke-width="12"/><path d="M80,75 a20,20 0 1,0 0.1,0" fill="none" stroke="#E63329" stroke-width="12"/>',
        // Handbücher herunterladen: kleines aufgeschlagenes Buch
        instrQueue: '<path d="M60,28 C50,22 30,20 16,24 L16,92 C30,88 50,90 60,96 Z" fill="#E63329"/><path d="M60,28 C70,22 90,20 104,24 L104,92 C90,88 70,90 60,96 Z" fill="#CC2A21"/><rect x="24" y="38" width="28" height="4" rx="2" fill="#fff"/><rect x="24" y="50" width="28" height="4" rx="2" fill="#fff"/><rect x="24" y="62" width="20" height="4" rx="2" fill="#fff"/>',
        // Preise aktualisieren: Preisschild (Gold) mit Loch
        priceJob: '<path d="M18,60 L58,20 L100,20 Q108,20 108,28 L108,70 Q108,78 100,78 L58,100 Z" fill="#F2CD37"/><circle cx="84" cy="42" r="9" fill="#fff"/>',
      };
      return svgs[k] ? `<svg width="16" height="16" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0">${svgs[k]}</svg>` : '';
    };
    const statusIcon = (s, j) => {
      if (s === 'running') return '⏳';
      if (s === 'done')    return '✅';
      if (s === 'error')   return '❌';
      // idle: show warning if there's pending work (total > progress or sub mentions pending)
      if (s === 'idle' && j.total > 0 && j.progress < j.total) return '⚠️';
      return '💤';
    };
    const bar = (v,t) => {
      if (!t) return '';
      const pct = Math.min(100, Math.round(v/t*100));
      return `<div style="background:var(--s100);border-radius:4px;height:6px;margin-top:4px"><div style="background:var(--b500);height:100%;border-radius:4px;width:${pct}%;transition:width .3s"></div></div>`;
    };
    // Preserve brickset queue panel if currently open
    const existingPanel = G('brickset-queue-panel');
    const panelOpen     = existingPanel && existingPanel.style.display !== 'none';
    const panelHTML     = panelOpen ? existingPanel.innerHTML : null;

    el.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
        ${Object.entries(jobs).map(([k,j])=>`
          <div class="card" style="padding:1rem">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem">
              <span style="font-weight:600;font-size:.9rem;display:inline-flex;align-items:center;gap:6px">${k==='bricksetRetry' ? '<svg width="16" height="16" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0"><rect x="10" y="48" width="28" height="24" rx="3" fill="#0055BF"/><circle cx="24" cy="48" r="4.5" fill="#0055BF"/><rect x="46" y="48" width="28" height="24" rx="3" fill="#F2CD37"/><circle cx="60" cy="48" r="4.5" fill="#F2CD37"/><rect x="82" y="48" width="28" height="24" rx="3" fill="#E63329"/><circle cx="96" cy="48" r="4.5" fill="#E63329"/></svg>' : jobIconSvg(k)}${t('monitor.job.'+k, {}) !== 'monitor.job.'+k ? t('monitor.job.'+k) : (j.label||'')}</span>
              <div style="display:flex;align-items:center;gap:.5rem">
                ${schedInput(k)}
                ${k==='priceJob' ? `<button class="btn bs btn-sm" style="padding:2px 10px;font-size:.75rem" data-click="clickJobTrigger">${t('monitor.run_now')}</button>` : ''}
                ${k==='instrQueue' ? `<button class="btn bs btn-sm" style="padding:2px 10px;font-size:.75rem" data-click="reimportMissingInstructions" data-self="1">${t('monitor.import_missing')}</button>` : ''}
                ${k==='csvImport' ? `<button class="btn bs btn-sm" style="padding:2px 10px;font-size:.75rem" data-click="triggerCsvSync" data-self="1">${t('monitor.sync_now')}</button>` : ''}
                ${k==='imgDl' && j.canRedownload ? `<button class="btn bs btn-sm" style="padding:2px 10px;font-size:.75rem" data-click="redownloadMissingImages" data-self="1">${t('monitor.redownload_missing')}</button>` : ''}
                ${k==='imgDl' ? `<button class="btn bs btn-sm" style="padding:2px 10px;font-size:.75rem" data-click="queueCatalogImages" data-self="1">${t('monitor.catalog_images')}</button>` : ''}
                ${k==='bricksetRetry' && j.total > 0 ? `<button class="btn bs btn-sm" style="padding:2px 10px;font-size:.75rem;display:inline-flex;align-items:center;gap:5px" data-click="toggleBricksetQueue" data-self="1"><svg width="14" height="14" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0"><rect x="10" y="48" width="28" height="24" rx="3" fill="#0055BF"/><circle cx="24" cy="48" r="4.5" fill="#0055BF"/><rect x="46" y="48" width="28" height="24" rx="3" fill="#F2CD37"/><circle cx="60" cy="48" r="4.5" fill="#F2CD37"/><rect x="82" y="48" width="28" height="24" rx="3" fill="#E63329"/><circle cx="96" cy="48" r="4.5" fill="#E63329"/></svg> ${t('monitor.show')}</button>` : ''}
                <span title="${esc(j.status)}">${statusIcon(j.status, j)}</span>
              </div>
            </div>
            ${j.sub ? `<div style="font-size:.8rem;color:var(--mut)">${translateJobSub(j.sub)}</div>` : ''}
            ${j.total > 0 ? bar(j.progress, j.total) : ''}
            ${j.lastRun ? `<div style="font-size:.72rem;color:var(--mut);margin-top:.4rem">${t('monitor.last_run')} ${new Date(j.lastRun).toLocaleTimeString(locale())}</div>` : ''}
            ${k==='bricksetRetry' ? `<div id="brickset-queue-panel" style="display:none;margin-top:.75rem"></div>` : ''}
          </div>`).join('')}
      </div>
      <div class="card" style="padding:1rem;margin-top:.5rem">
        <div style="font-weight:600;margin-bottom:.75rem">${t('monitor.db')}</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem;font-size:.83rem">
          <div><div style="color:var(--mut)">${t('monitor.last_sync')}</div><div style="font-weight:600">${dbStats.csvCache.lastSync||'–'}</div></div>
          <div><div style="color:var(--mut)">${t('monitor.parts_cached')}</div><div style="font-weight:600">${(dbStats.csvCache.parts||0).toLocaleString(locale())}</div></div>
          <div><div style="color:var(--mut)">${t('monitor.inventory_parts')}</div><div style="font-weight:600">${(dbStats.csvCache.inventoryParts||0).toLocaleString(locale())}</div></div>
          <div><div style="color:var(--mut)">${t('monitor.bl_mapped')}</div><div style="font-weight:600">${(dbStats.blMapping.mapped||0).toLocaleString(locale())} / ${(dbStats.blMapping.total||0).toLocaleString(locale())}</div></div>
        </div>
      </div>`;

    // Restore panel state if it was open before re-render
    if (panelOpen && panelHTML !== null) {
      const newPanel = G('brickset-queue-panel');
      if (newPanel) {
        newPanel.innerHTML = panelHTML;
        newPanel.style.display = 'block';
        // Update toggle button text
        const toggleBtn = newPanel.closest('.card')?.querySelector('button.btn.bs');
        if (toggleBtn && toggleBtn.textContent.includes(t('monitor.show'))) toggleBtn.textContent = tRaw('monitor.collapse');
      }
    }

    // Refresh faster when img-dl or PDF jobs are actively running
    const anyActive = Object.values(jobs).some(j => j.status === 'running');
    const interval = anyActive ? 2000 : 5000;
    if (_monitorTimer) clearInterval(_monitorTimer);
    _monitorTimer = setInterval(render, interval);
  };
  await render();
}

/**
 * Setter für _monitorTimer — importierte Bindungen sind in ES-Modulen schreibgeschützt.
 * Ersetzt die frühere direkte Zuweisung aus einer anderen Datei, die mit
 * globalen Variablen noch möglich war.
 * @param {any} v
 */
export function set_monitorTimer(v) { _monitorTimer = v; }

// ── Handler beim Dispatcher anmelden (siehe js/00-registry.js) ──────────────
// Der Handler gehört zu dem Modul, das ihn umsetzt (Nachtrag 130).
registerActions({
  openLogViewer,
});
