// Both sides of the monitoring together: the list of services and the log window.
import { genuine, registerActions } from './registry.js';
import { asHtml, escHtmlAttr, esc, html, rawHtml } from './escaping.js';
import { api, apiData } from './api.js';
import { ico, G, setHtml, ifVisible } from './dom.js';
import { fmtDate } from './format.js';
import { reportAtField, toast } from './messages.js';
import { LANG, locale, t, tRaw } from '../i18n.js';
/** @typedef {import('../../frontend-types/contract').AuftragPause} AuftragPause */
/** @typedef {import('../../frontend-types/contract').Auftrag} Auftrag */
/** @typedef {import('../../frontend-types/contract').JobStatus} JobStatus */

/** Timer of the job list while the tab is open. @type {ReturnType<typeof setTimeout> | null} */
let _monitorTimer = null;
/** Counts the runs: a response after stopping schedules no new round. */
let _monitorRun = 0;

// What logviewer.js writes at runtime, e.g. the changing label of the auto button.
const WINDOW_TEXTS = ['common.loading', 'common.network_error', 'log.none_found', 'log.entries', 'toast.error'].concat(
  ['log.auto', 'log.stop', 'log.level.info', 'log.level.warn', 'log.level.error', 'log.more_rows'],
  ['log.more_rows_one'],
);

/** @param {'info' | 'warn' | 'error'} level @param {string} char @param {boolean} on */
function levelsButton(level, char, on) {
  return (
    `<button type="button" class="lvbtn ${level}-btn${on ? ' active' : ''}" id="btn-${level}" data-click="toggleLevel"` +
    ` data-arg="${level}" aria-pressed="${on}"><span aria-hidden="true">${char}</span> ` +
    `${esc(tRaw(`log.level.${level}`))}</button>`
  );
}

function openLogViewer() {
  const win = window.open('', '_blank', 'width=1200,height=750,resizable=yes,scrollbars=yes');
  if (!win) {
    toast(tRaw('popup.blocked'), 'error');
    return;
  }
  const base = window.location.origin;

  // The time spans as data: the label stands there once, in the user's language.
  const spans = [15, 30, 60, 360, 1440, 2880]
    .map(min => {
      const text =
        min < 60 ? t('log.minutes_n', { n: min }) : min === 60 ? t('log.hour_1') : t('log.hours_n', { n: min / 60 });
      return '<option value="' + min + '">' + text + '</option>';
    })
    .join('');

  // The window follows the app's theme and light/dark; werkbank is dark without a variant.
  const root = document.documentElement;
  const design = root.getAttribute('data-theme') || '';
  const dark = root.hasAttribute('data-dark') || design === 'werkbank';
  const markup =
    '<!DOCTYPE html><html lang="' +
    escHtmlAttr(LANG) +
    '"' +
    (design ? ' data-theme="' + escHtmlAttr(design) + '"' : '') +
    (dark ? ' data-dark=""' : '') +
    '><head>' +
    '<meta charset="UTF-8"><title>' +
    esc(tRaw('log.title')) +
    '</title>' +
    '<link rel="stylesheet" href="/tokens.css?v=' +
    (window.__APP_VERSION || Date.now()) +
    '">' +
    '<link rel="stylesheet" href="/logviewer.css?v=' +
    (window.__APP_VERSION || Date.now()) +
    '">' +
    '</head><body' +
    ' data-base="' +
    escHtmlAttr(base) +
    '"' +
    ' data-i18n="' +
    escHtmlAttr(JSON.stringify(Object.fromEntries(WINDOW_TEXTS.map(k => [k, tRaw(k)])))) +
    '">' +
    '<header>' +
    '<h1>' +
    esc(tRaw('log.title')) +
    '</h1>' +
    '<div class="toolbar">' +
    '<label class="vh" for="period">' +
    esc(tRaw('log.period')) +
    '</label>' +
    '<select id="period" data-change="loadLogs">' +
    spans +
    '</select>' +
    '<span class="sep">|</span>' +
    levelsButton('info', '\u2139', false) +
    levelsButton('warn', '\u26A0', true) +
    levelsButton('error', '\u2716', true) +
    '<span class="sep">|</span>' +
    '<input id="search" type="search" aria-label="' +
    escHtmlAttr(tRaw('log.search')) +
    '" placeholder="' +
    escHtmlAttr(tRaw('log.search')) +
    '" data-input="renderLogs">' +
    '<span class="sep">|</span>' +
    '<button type="button" data-click="loadLogs">' +
    esc(tRaw('log.reload')) +
    '</button>' +
    '<button type="button" data-click="toggleAuto" id="btn-auto" aria-pressed="false">' +
    esc(tRaw('log.auto')) +
    '</button>' +
    '<span id="status" role="status">\u2013</span>' +
    '</div>' +
    '</header>' +
    '<main id="log-wrap" tabindex="0" aria-label="' +
    escHtmlAttr(tRaw('log.title')) +
    '"></main>' +
    '<script src="/js/logviewer.js?v=' +
    (window.__APP_VERSION || Date.now()) +
    '"></script>' +
    '</body></html>';

  win.document.write(asHtml(rawHtml(markup)));
  win.document.close();
}

/** One spelled-out key per server code: that way test/i18n-calls.test.js checks that it exists. */
/** @type {Record<string, (w?: Record<string, string | number>) => string>} */
const SUB_TEXTS = {
  teil_gemappt: w => tRaw('monitor.sub.part_mapped', w),
  // At 0 the plural form said "all 0 …".
  all_mapped: w => tRaw(Number(w?.n) === 0 ? 'monitor.sub.nichts_to_assign' : 'monitor.sub.all_mapped', w),
  ausstehend: w => tRaw('monitor.sub.pending', w),
  all_done: w => tRaw('monitor.sub.all_done', w),
  keine_ausstehenden: w => tRaw('monitor.sub.none_pending', w),
  retry_ready: w => tRaw('monitor.sub.retry_ready', w),
  warten_morgen: w => tRaw('monitor.sub.wait_morgen', w),
  bilder_laden: w => tRaw('monitor.sub.images_load', w),
  bilder_offen: w => tRaw('monitor.sub.images_open', w),
  imgs_cached: w => tRaw(Number(w?.n) === 0 ? 'monitor.sub.none_images' : 'monitor.sub.imgs_cached', w),
  katalog_warteschlange: w => tRaw('monitor.sub.catalog_warteschlange', w),
  job_nie: w => tRaw('monitor.sub.job_nie', w),
  kein_durchgang: w => tRaw('monitor.sub.no_run', w),
  neu_suche: w => tRaw('monitor.sub.new_search', w),
  neu_geladen: w => tRaw('monitor.sub.new_loaded', w),
  pdf_laufend: w => tRaw('monitor.sub.pdf_running', w),
  pdf_bereit: w => tRaw('monitor.sub.pdf_ready', w),
  no_active: w => tRaw('monitor.sub.no_active', w),
  bestand: w => tRaw('monitor.sub.stock', w),
};

/**
 * Subtitle from the server's codes (src/management/service.ts); the sentences are only in the language files.
 * An unknown code (newer server) falls back to the server's text.
 * @param {{ code: string, werte?: Record<string, string | number>, vor?: string }[]} parts @param {string} sub
 */
function subFromCodes(parts, sub) {
  const text = (/** @type {string} */ code, /** @type {Record<string, string | number> | undefined} */ values) => {
    const f = Object.hasOwn(SUB_TEXTS, code) ? SUB_TEXTS[code] : null;
    return f ? f(values) : null;
  };
  const pieces = parts.map(t => {
    const s = text(t.code, t.werte);
    return s === null ? null : (t.vor ? (text(t.vor, undefined) ?? '') + ' ' : '') + s;
  });
  return pieces.includes(null) ? translateJobSub(sub) : pieces.join(' · ');
}

/** The server's job subtitle in the user's language: the jobs do not know it. @param {string} sub */
function translateJobSub(sub) {
  if (!sub) return '';
  let m;
  m = sub.match(/^Alle (\d+) gemappt$/);
  if (m) return SUB_TEXTS.all_mapped({ n: Number(m[1]) });
  if (sub === 'Alle erledigt') return tRaw('monitor.sub.all_done');
  m = sub.match(/^Alle (\d+) Bilder gecacht$/);
  if (m) return SUB_TEXTS.imgs_cached({ n: Number(m[1]) });
  if (sub === 'Alle Bilder gecacht') return tRaw('monitor.sub.imgs_cached', { n: '' }).trim();
  if (/^Keine aktiven/.test(sub)) return tRaw('monitor.sub.no_active');
  m = sub.match(/^(\d+) Sets bereit zum Retry, (\d+) warten$/);
  if (m) return tRaw('monitor.sub.retry_ready', { n: m[1], w: m[2] });
  m = sub.match(/^(\d+) aktualisiert, (\d+) Fehler — ([\d.]+)s$/);
  if (m) return tRaw('monitor.sub.updated_errors', { upd: m[1], err: m[2], sec: m[3] });
  if (sub === 'Starte\u2026' || sub === 'Starte...') return tRaw('monitor.starting');
  return sub; // unknown: unchanged
}

// Saves a service's schedule. payload = {time:"HH:MM"} or {minutes:n}; confirmed at the field.
/**
 * @param {string} name
 * @param {{ time?: string, minutes?: number }} payload
 * @param {Element} [field]
 */
export async function saveJobSchedule(name, payload, field) {
  const d = await api('POST', '/v1/admin/job-schedule', { name, ...payload });
  if (d?.success) reportAtField(field);
  else toast(d?.error || t('settings.error'), 'error');
}

// The schedules are in the settings (field); here, under "background jobs", only as text with a
// link there: observing and configuring in one place were three save paths side by side.
// The time as a text field in 24 h form: <input type="time"> shows the browser's form ("03:00 AM").
/** @param {Record<string, import('../../frontend-types/contract').JobSchedule> | null | undefined} schedules @param {string} k */
const schedInput = (schedules, k) => {
  const sc = schedules?.[k];
  if (!sc) return html`<span class="mon-quiet">${tRaw('monitor.sched.none')}</span>`;
  if (sc.type === 'daily') {
    return html`<label class="mon-plan">${tRaw('monitor.sched.daily')} <input type="text" inputmode="numeric" maxlength="5" placeholder="HH:MM" class="job-sched-input mon-time" value="${sc.time}" aria-label="${tRaw('monitor.sched.daily_hint')}" data-change="saveJobTime" data-arg="${k}"></label>`;
  }
  if (sc.type === 'interval') {
    return html`<label class="mon-plan">${tRaw('monitor.sched.all')} <input inputmode="numeric" type="number" min="5" class="job-sched-input mon-minutes" aria-label="${tRaw('monitor.sched.interval_hint')}" value="${sc.minutes}" data-change="saveJobMinutes" data-arg="${k}"> ${tRaw('monitor.sched.min')}</label>`;
  }
  return '';
};
/** @param {Record<string, import('../../frontend-types/contract').JobSchedule> | null | undefined} schedules @param {string} k */
const schedText = (schedules, k) => {
  const sc = schedules?.[k];
  if (!sc) return html`<span class="mon-quiet">${tRaw('monitor.sched.none')}</span>`;
  const when =
    sc.type === 'daily'
      ? `${tRaw('monitor.sched.daily')} ${sc.time}`
      : sc.type === 'interval'
        ? `${tRaw('monitor.sched.all')} ${sc.minutes} ${tRaw('monitor.sched.min')}`
        : '';
  return html`<span class="mon-plan">${when}</span> <a class="close-view" href="#/einstellungen/hintergrund">${tRaw('monitor.sched.change')}</a>`;
};

/** The schedules as fields in settings › background jobs. */
export async function loadSchedules() {
  const el = G('settings-schedules');
  if (!el) return;
  const d = await apiData('GET', '/v1/admin/jobs');
  if (!d?.success || !d.jobs) return;
  const rows = Object.entries(d.jobs).filter(([k]) => d.schedules?.[k]);
  setHtml(
    el,
    html`<div class="tw"><table class="dt mon-table" aria-label="${tRaw('settings.schedules')}">
      <thead><tr><th>${tRaw('monitor.col.service')}</th><th>${tRaw('monitor.col.schedule')}</th></tr></thead>
      <tbody>${rows.map(([k, j]) => html`<tr><td>${serviceName(k, j)}</td><td>${schedInput(d.schedules, k)}</td></tr>`)}</tbody>
    </table></div>`,
  );
}
/** Line icons from the sprite as everywhere else; colored pictures looked like emojis next to them. */
const JOB_SYMBOL = /** @type {Record<string, string>} */ ({
  csvImport: 'import',
  blIds: 'link',
  instrQueue: 'file',
  brickset: 'refresh',
  priceJob: 'finances',
  imgDl: 'image',
  pdfJobs: 'printer',
});
const jobIconSvg = (/** @type {string} */ k) =>
  html`<svg class="ico mon-icon" aria-hidden="true"><use href="#i-${JOB_SYMBOL[k] || 'clock'}"/></svg>`;
const jobState = (/** @type {string} */ s) =>
  ({ running: tRaw('monitor.state.running'), done: tRaw('monitor.state.done'), error: tRaw('monitor.state.error') })[
    s
  ] || tRaw('monitor.state.idle');
const statusIcon = (/** @type {string} */ s, /** @type {JobStatus} */ j) => {
  if (s === 'running') return ico('clock');
  if (s === 'done') return ico('ok');
  if (s === 'error') return ico('error');
  // idle: show warning if there's pending work (total > progress or sub mentions pending)
  if (s === 'idle' && j.total > 0 && j.progress < j.total) return ico('warning');
  return ico('pause');
};
/** Only with running work: a standing bar read like a hanging run. */
const bar = (/** @type {number} */ v, /** @type {number} */ total) => {
  if (!total) return '';
  const pct = Math.min(100, Math.round((v / total) * 100));
  return html`<div class="mon-bar"><div data-width="${pct}"></div></div>`;
};
const actions = (/** @type {string} */ k, /** @type {JobStatus} */ j) =>
  [
    k === 'priceJob'
      ? html`<button class="btn bs btn-sm" type="button" data-click="clickJobTrigger">${tRaw('monitor.run_now')}</button>`
      : '',
    k === 'instrQueue'
      ? html`<button class="btn bs btn-sm" type="button" data-click="reimportMissingInstructions" data-self="1">${tRaw('monitor.import_missing')}</button>`
      : '',
    k === 'csvImport'
      ? html`<button class="btn bs btn-sm" type="button" data-click="triggerCsvSync" data-self="1">${tRaw('monitor.sync_now')}</button>`
      : '',
    k === 'imgDl' && j.canRedownload
      ? html`<button class="btn bs btn-sm" type="button" data-click="redownloadMissingImages" data-self="1">${tRaw('monitor.redownload_missing')}</button>`
      : '',
    k === 'imgDl'
      ? html`<button class="btn bs btn-sm" type="button" data-click="queueCatalogImages" data-self="1">${tRaw('monitor.catalog_images')}</button>`
      : '',
    k === 'bricksetRetry' && j.total > 0
      ? html`<button class="btn bs btn-sm" type="button" data-click="toggleBricksetQueue" data-self="1"><span>${tRaw('monitor.show')}</span></button>`
      : '',
  ].filter(Boolean);
const serviceName = (/** @type {string} */ k, /** @type {JobStatus} */ j) =>
  tRaw('monitor.job.' + k) !== 'monitor.job.' + k ? tRaw('monitor.job.' + k) : j.label || k;

/** Fixed keys instead of composed ones (test/i18n-calls.test.js); text as in the log (src/http/proxyHint.ts). */
const PROXY_HINT = {
  gateway: 'monitor.proxy.gateway',
  docker_netz: 'monitor.proxy.docker_network',
  eine_adresse: 'monitor.proxy.one_address',
};

export async function loadMonitor() {
  const el = G('monitor-content');
  if (!el) return;
  stopMonitor();
  const run = ++_monitorRun;
  // Calm every 15 s, every 5 s while something is running; a failed fetch still schedules the next round.
  const round = async () => {
    const active = await render();
    if (run !== _monitorRun) return;
    _monitorTimer = setTimeout(() => ifVisible(() => run === _monitorRun && round()), active ? 5000 : 15000);
  };
  const render = async () => {
    const d = await apiData('GET', '/v1/admin/jobs');
    if (!d?.success) return false;
    const { jobs, schedules } = d;
    // The contract does not name db and lastRun (JobsResponse); the server sends them along.
    const dbStats =
      /** @type {{ csvCache: { lastSync?: string, parts?: number, inventoryParts?: number }, blMapping: { mapped?: number, total?: number } }} */ (
        d.db
      );
    const panel = G('brickset-queue-panel');
    const panelHTML = panel && panel.style.display !== 'none' ? panel.innerHTML : null;
    const number = (/** @type {number | null | undefined} */ n) => (n || 0).toLocaleString(locale());
    const set = (/** @type {string} */ id, /** @type {string} */ v) => {
      const e = G(id);
      if (e) e.textContent = v;
    };
    set('mon-db-sync', dbStats.csvCache.lastSync ? fmtDate(dbStats.csvCache.lastSync) : '–');
    set('mon-db-parts', number(dbStats.csvCache.parts));
    set('mon-db-inventory', number(dbStats.csvCache.inventoryParts));
    set('mon-db-bl', `${number(dbStats.blMapping.mapped)} / ${number(dbStats.blMapping.total)}`);

    setHtml(
      el,
      html`
      <p class="mon-hint">${tRaw('monitor.services_hint')}</p>
      ${d.degradiert?.length ? html`<p class="mon-hint" role="status">${tRaw('monitor.degraded', { teile: d.degradiert.join(', ') })}</p>` : ''}
      ${d.proxy_hinweis ? html`<p class="mon-warning" role="status" id="mon-proxy-hint">${ico('warning')} ${tRaw(PROXY_HINT[d.proxy_hinweis.art], d.proxy_hinweis.vars)}</p>` : ''}
      <div class="tw"><table class="dt mon-table mon-services" aria-label="${tRaw('table.services')}">
        <thead><tr><th>${tRaw('monitor.col.service')}</th><th>${tRaw('monitor.col.state')}</th><th>${tRaw('monitor.col.schedule')}</th><th>${tRaw('monitor.col.last')}</th><th>${tRaw('monitor.col.actions')}</th></tr></thead>
        <tbody>${Object.entries(jobs).map(
          ([k, j]) => html`<tr>
          <td><span class="mon-name">${jobIconSvg(k === 'bricksetRetry' ? 'brickset' : k)}${serviceName(k, j)}</span></td>
          <td><span class="mon-state mon-${j.status || 'idle'}">${statusIcon(j.status, j)} ${jobState(j.status)}</span>
            ${j.sub_teile?.length || j.sub ? html`<div class="mon-quiet">${j.sub_teile?.length ? subFromCodes(j.sub_teile, j.sub ?? '') : translateJobSub(j.sub ?? '')}</div>` : ''}${j.status === 'running' && j.total > 0 ? bar(j.progress, j.total) : ''}</td>
          <td>${schedText(schedules, k)}</td>
          <td>${j.lastRun ? fmtDate(/** @type {string} */ (j.lastRun), 'when') : ''}</td>
          <td><div class="mon-buttons">${actions(k, j).length ? actions(k, j) : html`<span class="mon-quiet">–</span>`}</div></td>
        </tr>`,
        )}</tbody>
      </table></div>
      ${jobs.bricksetRetry ? html`<div id="brickset-queue-panel" class="mon-panel" data-style="display:none"></div>` : ''}`,
    );

    if (panelHTML !== null) {
      const newValue = G('brickset-queue-panel');
      if (newValue) {
        setHtml(newValue, rawHtml(panelHTML));
        newValue.style.display = 'block';
        const button = el.querySelector('[data-click="toggleBricksetQueue"] span');
        if (button) button.textContent = tRaw('monitor.collapse');
      }
    }

    await showJobs();
    return Object.values(jobs).some(j => j.status === 'running');
  };
  await round();
}

/**
 * Names of the job kinds and statuses — spelled out, so that every key stands checkably in the dictionary.
 * @type {Record<string, () => string>}
 */
const KIND_NAMES = {
  nacharbeit: () => tRaw('monitor.kind.rework'),
  bilder: () => tRaw('monitor.kind.images'),
  pdf: () => tRaw('monitor.kind.pdf'),
  csv_import: () => tRaw('monitor.kind.csv_import'),
  wechselkurse: () => tRaw('monitor.kind.wechselkurse'),
  anleitung: () => tRaw('monitor.kind.instructions'),
  brickset: () => tRaw('monitor.kind.brickset'),
  bildbedarf: () => tRaw('monitor.kind.bildbedarf'),
  bilder_neu_laden: () => tRaw('monitor.kind.images_new_load'),
  nachlauf: () => tRaw('monitor.kind.follow_up'),
  csv_sync: () => tRaw('monitor.kind.csv_sync'),
  preise: () => tRaw('monitor.kind.prices'),
  preise_nachladen: () => tRaw('monitor.kind.prices_reload'),
  bild_nachlauf: () => tRaw('monitor.kind.image_follow_up'),
  aufraeumen: () => tRaw('monitor.kind.cleanup'),
  aufraeumen_taeglich: () => tRaw('monitor.kind.cleanup_daily'),
  konto_dateien: () => tRaw('monitor.kind.account_files'),
  widerrufsliste: () => tRaw('monitor.kind.revocation_list'),
  katalog_nachzug: () => tRaw('monitor.kind.catalog_catch_up'),
};
/** @type {Record<string, () => string>} */
const STATUS_NAMES = {
  offen: () => tRaw('monitor.jobs.open'),
  laeuft: () => tRaw('monitor.jobs.running'),
  fehler: () => tRaw('monitor.jobs.error'),
  abgebrochen: () => tRaw('monitor.jobs.cancelled'),
};
/** The name of a job kind in the UI language, already escaped; unknown ones stay as they are. */
const kindName = (/** @type {string} */ kind) => (Object.hasOwn(KIND_NAMES, kind) ? KIND_NAMES[kind]() : kind);

/** A server error message in one sentence without networking knowledge; the original stays expandable for debugging.
 * @param {unknown} text */
export function errorShort(text) {
  const s = String(text || '');
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|fetch failed|network|socket hang up/i.test(s))
    return tRaw('monitor.err.net');
  if (/timed? ?out|ETIMEDOUT|Zeitüberschreitung/i.test(s)) return tRaw('monitor.err.timeout');
  if (/\b429\b|rate.?limit|too many/i.test(s)) return tRaw('monitor.err.limit');
  if (/\b40[13]\b|unauthori[sz]ed|forbidden|api.?key|schlüssel/i.test(s)) return tRaw('monitor.err.auth');
  if (/\b404\b|not found/i.test(s)) return tRaw('monitor.err.missing');
  return tRaw('monitor.err.other');
}

/** @param {unknown} text */
function errorBox(text) {
  return html`<details class="error-box"><summary>${ico('warning')} ${errorShort(text)}</summary><code>${text}</code></details>`;
}

// Seven identical "start now" are indistinguishable for screen readers: the name names the kind too.
const button = (/** @type {string} */ action, /** @type {string} */ arg, /** @type {string} */ text, purpose = '') =>
  html`<button class="btn bs btn-sm" type="button" data-click="${action}"${genuine()} data-arg="${arg}"${purpose ? html` aria-label="${text}: ${purpose}"` : ''}>${text}</button>`;
const statusName = (/** @type {string} */ s) => (Object.hasOwn(STATUS_NAMES, s) ? STATUS_NAMES[s]() : s);
/** A row of the individual jobs. If a kind is open several times, the role at the name says which entry
 * is a retry and which is the regular run. @param {Auftrag} a @param {Set<string>} multiple */
const jobRow = (a, multiple) => {
  const open = a.status === 'offen' || a.status === 'laeuft';
  const role =
    !open || !multiple.has(a.type)
      ? ''
      : a.geplant
        ? tRaw('monitor.jobs.regular')
        : a.attempts > 1 || a.error_message
          ? tRaw('monitor.jobs.retry')
          : '';
  const time = fmtDate(a.status === 'laeuft' ? a.started_at : a.due_at, 'when');
  // Postponed is not failed: the server says so (wartet), not the text of the reason.
  const waiting = a.status === 'offen' && a.waiting && !!a.due_at && new Date(a.due_at) > new Date();
  const when = waiting
    ? t('monitor.jobs.waiting_bis', { time })
    : a.status === 'offen'
      ? t(a.geplant ? 'monitor.jobs.scheduled' : 'monitor.jobs.due', { time })
      : a.status === 'laeuft'
        ? time
        : '';
  const status = a.progress?.gesamt
    ? `${Math.round(a.progress.erledigt ?? 0)} / ${a.progress.gesamt}`
    : a.progress?.text || '';
  const hint = [
    waiting && a.error_message ? html`<span class="mon-quiet">${a.error_message}</span>` : '',
    !waiting && a.error_message && (a.status === 'offen' || a.status === 'fehler') ? errorBox(a.error_message) : '',
    a.attempts > 1 && !waiting
      ? html`<span class="mon-quiet">${tRaw('monitor.jobs.attempt', { n: a.attempts, max: a.max_attempts })}</span>`
      : '',
    status ? html`<span class="mon-quiet">${status}</span>` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const action =
    a.status === 'offen' || a.status === 'laeuft' ? button('cancelJob', a.id, tRaw('monitor.jobs.cancel')) : '';
  return html`<tr>
    <td><strong>${kindName(a.type)}</strong>${a.set_number ? html` <span class="mon-quiet">${a.set_number}</span>` : ''}${role ? html` <span class="mon-role">${role}</span>` : ''}</td>
    <td><span class="mon-state mon-${waiting ? 'waiting' : a.status}">${waiting ? tRaw('monitor.jobs.waiting') : statusName(a.status)}</span></td>
    <td>${rawHtml(when)}</td>
    <td>${rawHtml(hint)}</td>
    <td><div class="mon-buttons">${action}</div></td>
  </tr>`;
};

/** The card "background jobs": per kind the numbers with "now" and "clear", below the individual
 * running, waiting and failed jobs (GET /api/v1/admin/auftraege). */
async function showJobs() {
  const el = G('jobs-card');
  if (!el) return;
  const d = await api('GET', '/v1/admin/auftraege');
  if (!d?.success) {
    el.replaceChildren();
    return;
  }
  /** @type {Record<string, Record<string, number>>} */
  const number = {};
  for (const z of d.zusammenfassung) {
    number[z.type] ||= {};
    number[z.type][z.status] = z.anzahl;
  }
  // The next run per kind: the earliest waiting job of that kind.
  /** @type {Record<string, string>} */
  const next = {};
  for (const a of d.auftraege)
    if (a.status === 'offen' && a.due_at && (!next[a.type] || a.due_at < next[a.type])) next[a.type] = a.due_at;
  const kinds = Object.keys(number).sort((a, b) => kindName(a).localeCompare(kindName(b), locale()));
  const digit = (/** @type {number | undefined} */ n, cls = '') =>
    html`<span class="mon-digit${n ? html`${' '}${rawHtml(cls)}` : ' null'}">${n || 0}</span>`;
  const more = d.auftraege.length - 40;
  /** @type {Record<string, number>} */
  const afterError = {};
  for (const a of d.auftraege)
    if (a.status === 'offen' && (a.attempts > 1 || a.error_message)) afterError[a.type] = (afterError[a.type] || 0) + 1;
  const perKind = d.auftraege.filter(a => a.status === 'offen' || a.status === 'laeuft').map(a => a.type);
  const multiple = new Set(perKind.filter((kind, i) => perKind.indexOf(kind) !== i));
  const pause = (/** @type {AuftragPause} */ p) =>
    t('monitor.jobs.pause', { art: kindName(p.type), bis: fmtDate(p.until_at, 'when'), grund: p.reason || '' });
  setHtml(
    el,
    html`
    <h2 class="mon-title" id="mon-t-jobs" tabindex="-1">${ico('list')}<span>${tRaw('monitor.jobs.title')}</span></h2>
    <p class="mon-hint">${tRaw('monitor.jobs.hint')}</p>
    ${d.job_prozess.laeuft ? '' : html`<p class="mon-warning">${ico('warning')} ${tRaw('monitor.jobs.no_process')}</p>`}
    ${d.pausen.map(p => html`<p class="mon-quiet">${ico('pause')} ${pause(p)}</p>`)}
    ${d.bildbedarf ? html`<p class="mon-quiet">${tRaw('monitor.jobs.bildbedarf', { n: d.bildbedarf })}</p>` : ''}
    ${
      kinds.length
        ? html`<div class="tw"><table class="dt mon-table mon-kinds" aria-label="${tRaw('table.job_kinds')}">
      <thead><tr><th>${tRaw('monitor.col.kind')}</th><th class="number">${tRaw('monitor.col.open')}</th><th class="number">${tRaw('monitor.col.running')}</th><th class="number">${tRaw('monitor.col.error')}</th><th>${tRaw('monitor.col.next')}</th><th>${tRaw('monitor.col.actions')}</th></tr></thead>
      <tbody>${kinds.map(
        kind => html`<tr>
        <td>${kindName(kind)}</td>
        <td class="number">${digit(number[kind].offen)}${afterError[kind] ? html`<span class="mon-quiet mon-extra">${tRaw('monitor.jobs.of_which_nach_error', { n: afterError[kind] })}</span>` : ''}</td>
        <td class="number">${digit(number[kind].laeuft, 'mon-running')}</td>
        <td class="number">${digit(number[kind].fehler, 'mon-error')}</td>
        <td>${next[kind] ? fmtDate(next[kind], 'when') : ''}</td>
        <td><div class="mon-buttons">${button('runJobKindNow', kind, tRaw('monitor.jobs.now'), kindName(kind))}${number[kind].offen ? button('emptyJobKind', kind, tRaw('monitor.jobs.clear'), kindName(kind)) : ''}</div></td>
      </tr>`,
      )}</tbody></table></div>`
        : ''
    }
    ${
      d.auftraege.length
        ? html`<details class="mon-single"${openSingle() ? ' open' : ''}>
      <summary class="mon-subtitle">${tRaw('monitor.jobs.single')} <span class="mon-quiet">(${d.auftraege.length})</span></summary>
      <div class="tw"><table class="dt mon-table" aria-labelledby="mon-t-jobs">
      <thead><tr><th>${tRaw('monitor.col.job')}</th><th>${tRaw('monitor.col.state')}</th><th>${tRaw('monitor.col.time')}</th><th>${tRaw('monitor.col.hint')}</th><th>${tRaw('monitor.col.actions')}</th></tr></thead>
      <tbody>${d.auftraege.slice(0, 40).map(a => jobRow(a, multiple))}</tbody></table></div>
      ${more > 0 ? html`<p class="mon-quiet">${tRaw('monitor.jobs.more', { n: more })}</p>` : ''}</details>`
        : html`<h3 class="mon-subtitle">${tRaw('monitor.jobs.single')}</h3><p class="mon-quiet">${tRaw('monitor.jobs.empty')}</p>`
    }`,
  );
}
/** Individual jobs: collapsed on the phone, otherwise open; a click applies until reloading. @type {boolean | null} */
let _openSingle = null;
const openSingle = () => _openSingle ?? !(typeof matchMedia === 'function' && matchMedia('(max-width: 640px)').matches);
if (typeof document !== 'undefined')
  document.addEventListener(
    'toggle',
    ev => {
      const d = ev.target;
      if (d instanceof HTMLDetailsElement && d.classList.contains('mon-single')) _openSingle = d.open;
    },
    true,
  );

/** @param {string} id */
async function cancelJob(id) {
  const d = await api('POST', `/v1/admin/auftraege/${encodeURIComponent(id)}/abbrechen`);
  if (!d?.success) toast(d?.error || t('settings.error'), 'error');
  await showJobs();
}

/** @param {string} kind */
async function runJobKindNow(kind) {
  const d = await api('POST', `/v1/admin/auftraege/art/${encodeURIComponent(kind)}/jetzt`);
  if (!d?.success) toast(d?.error || t('settings.error'), 'error');
  await showJobs();
}

/** @param {string} kind */
async function emptyJobKind(kind) {
  const d = await api('DELETE', `/v1/admin/auftraege/art/${encodeURIComponent(kind)}`);
  if (d?.success) toast(tRaw('monitor.jobs.emptied', { n: d.entfernt }), 'success');
  else toast(d?.error || t('settings.error'), 'error');
  await showJobs();
}

/** When leaving the tab: stop polling. @returns {boolean} whether it was running */
export function stopMonitor() {
  _monitorRun++;
  if (!_monitorTimer) return false;
  clearTimeout(_monitorTimer);
  _monitorTimer = null;
  return true;
}

// ── Register handlers with the dispatcher (js/registry.js); it belongs to the module that implements it. ──
registerActions({
  openLogViewer,
  cancelJob,
  runJobKindNow,
  emptyJobKind,
});
