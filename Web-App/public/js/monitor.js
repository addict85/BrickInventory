// Both sides of the monitoring together: the list of services and the log window.
import { echt, registerActions } from './registry.js';
import { asHtml, escHtmlAttr, esc, html, rawHtml } from './escaping.js';
import { api, apiData } from './api.js';
import { ico, G, setzeHtml, ifVisible } from './dom.js';
import { fmtDatum } from './format.js';
import { meldeAmFeld, toast } from './messages.js';
import { LANG, locale, t, tRaw } from '../i18n.js';
/** @typedef {import('../../frontend-types/contract').AuftragPause} AuftragPause */
/** @typedef {import('../../frontend-types/contract').Auftrag} Auftrag */
/** @typedef {import('../../frontend-types/contract').JobStatus} JobStatus */

/** Timer of the job list while the tab is open. @type {ReturnType<typeof setTimeout> | null} */
let _monitorTimer = null;
/** Counts the runs: a response after stopping schedules no new round. */
let _monitorLauf = 0;

// What logviewer.js writes at runtime, e.g. the changing label of the auto button.
const WINDOW_TEXTS = ['common.loading', 'common.network_error', 'log.none_found', 'log.entries', 'toast.error'].concat(
  ['log.auto', 'log.stop', 'log.stufe.info', 'log.stufe.warn', 'log.stufe.error', 'log.mehr_zeilen'],
  ['log.mehr_zeilen_one'],
);

/** @param {'info' | 'warn' | 'error'} stufe @param {string} zeichen @param {boolean} an */
function levelsButton(stufe, zeichen, an) {
  return (
    `<button type="button" class="lvbtn ${stufe}-btn${an ? ' active' : ''}" id="btn-${stufe}" data-click="toggleLevel"` +
    ` data-arg="${stufe}" aria-pressed="${an}"><span aria-hidden="true">${zeichen}</span> ` +
    `${esc(tRaw(`log.stufe.${stufe}`))}</button>`
  );
}

function openLogViewer() {
  const win = window.open('', '_blank', 'width=1200,height=750,resizable=yes,scrollbars=yes');
  if (!win) {
    alert(tRaw('popup.blocked'));
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
  const wurzel = document.documentElement;
  const design = wurzel.getAttribute('data-theme') || '';
  const dunkel = wurzel.hasAttribute('data-dunkel') || design === 'werkbank';
  const markup =
    '<!DOCTYPE html><html lang="' +
    escHtmlAttr(LANG) +
    '"' +
    (design ? ' data-theme="' + escHtmlAttr(design) + '"' : '') +
    (dunkel ? ' data-dunkel=""' : '') +
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
    esc(tRaw('log.zeitraum')) +
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
  teil_gemappt: w => tRaw('monitor.sub.teil_gemappt', w),
  // At 0 the plural form said "all 0 …".
  all_mapped: w => tRaw(Number(w?.n) === 0 ? 'monitor.sub.nichts_zuzuordnen' : 'monitor.sub.all_mapped', w),
  ausstehend: w => tRaw('monitor.sub.ausstehend', w),
  all_done: w => tRaw('monitor.sub.all_done', w),
  keine_ausstehenden: w => tRaw('monitor.sub.keine_ausstehenden', w),
  retry_ready: w => tRaw('monitor.sub.retry_ready', w),
  warten_morgen: w => tRaw('monitor.sub.warten_morgen', w),
  bilder_laden: w => tRaw('monitor.sub.bilder_laden', w),
  bilder_offen: w => tRaw('monitor.sub.bilder_offen', w),
  imgs_cached: w => tRaw(Number(w?.n) === 0 ? 'monitor.sub.keine_bilder' : 'monitor.sub.imgs_cached', w),
  katalog_warteschlange: w => tRaw('monitor.sub.katalog_warteschlange', w),
  job_nie: w => tRaw('monitor.sub.job_nie', w),
  kein_durchgang: w => tRaw('monitor.sub.kein_durchgang', w),
  neu_suche: w => tRaw('monitor.sub.neu_suche', w),
  neu_geladen: w => tRaw('monitor.sub.neu_geladen', w),
  pdf_laufend: w => tRaw('monitor.sub.pdf_laufend', w),
  pdf_bereit: w => tRaw('monitor.sub.pdf_bereit', w),
  no_active: w => tRaw('monitor.sub.no_active', w),
  bestand: w => tRaw('monitor.sub.bestand', w),
};

/**
 * Subtitle from the server's codes (src/management/service.ts); the sentences are only in the language files.
 * An unknown code (newer server) falls back to the server's text.
 * @param {{ code: string, werte?: Record<string, string | number>, vor?: string }[]} teile @param {string} sub
 */
function subFromCodes(teile, sub) {
  const text = (/** @type {string} */ code, /** @type {Record<string, string | number> | undefined} */ werte) => {
    const f = Object.hasOwn(SUB_TEXTS, code) ? SUB_TEXTS[code] : null;
    return f ? f(werte) : null;
  };
  const stuecke = teile.map(t => {
    const s = text(t.code, t.werte);
    return s === null ? null : (t.vor ? (text(t.vor, undefined) ?? '') + ' ' : '') + s;
  });
  return stuecke.includes(null) ? translateJobSub(sub) : stuecke.join(' · ');
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
 * @param {Element} [feld]
 */
export async function saveJobSchedule(name, payload, feld) {
  const d = await api('POST', '/v1/admin/job-schedule', { name, ...payload });
  if (d?.success) meldeAmFeld(feld);
  else toast(d?.error || t('settings.error'), 'error');
}

// The schedules are in the settings (field); here, under "background jobs", only as text with a
// link there: observing and configuring in one place were three save paths side by side.
// The time as a text field in 24 h form: <input type="time"> shows the browser's form ("03:00 AM").
/** @param {Record<string, import('../../frontend-types/contract').JobSchedule> | null | undefined} schedules @param {string} k */
const schedInput = (schedules, k) => {
  const sc = schedules?.[k];
  if (!sc) return html`<span class="mon-leise">${tRaw('monitor.sched.keiner')}</span>`;
  if (sc.type === 'daily') {
    return html`<label class="mon-plan">${tRaw('monitor.sched.taeglich')} <input type="text" inputmode="numeric" maxlength="5" placeholder="HH:MM" class="job-sched-input mon-zeit" value="${sc.time}" aria-label="${tRaw('monitor.sched.daily_hint')}" data-change="saveJobTime" data-arg="${k}"></label>`;
  }
  if (sc.type === 'interval') {
    return html`<label class="mon-plan">${tRaw('monitor.sched.alle')} <input inputmode="numeric" type="number" min="5" class="job-sched-input mon-minuten" aria-label="${tRaw('monitor.sched.interval_hint')}" value="${sc.minutes}" data-change="saveJobMinutes" data-arg="${k}"> ${tRaw('monitor.sched.min')}</label>`;
  }
  return '';
};
/** @param {Record<string, import('../../frontend-types/contract').JobSchedule> | null | undefined} schedules @param {string} k */
const schedText = (schedules, k) => {
  const sc = schedules?.[k];
  if (!sc) return html`<span class="mon-leise">${tRaw('monitor.sched.keiner')}</span>`;
  const wann =
    sc.type === 'daily'
      ? `${tRaw('monitor.sched.taeglich')} ${sc.time}`
      : sc.type === 'interval'
        ? `${tRaw('monitor.sched.alle')} ${sc.minutes} ${tRaw('monitor.sched.min')}`
        : '';
  return html`<span class="mon-plan">${wann}</span> <a class="zu-sicht" href="#/einstellungen/hintergrund">${tRaw('monitor.sched.aendern')}</a>`;
};

/** The schedules as fields in settings › background jobs. */
export async function loadSchedules() {
  const el = G('einst-zeitplaene');
  if (!el) return;
  const d = await apiData('GET', '/v1/admin/jobs');
  if (!d?.success || !d.jobs) return;
  const zeilen = Object.entries(d.jobs).filter(([k]) => d.schedules?.[k]);
  setzeHtml(
    el,
    html`<div class="tw"><table class="dt mon-tabelle" aria-label="${tRaw('settings.zeitplaene')}">
      <thead><tr><th>${tRaw('monitor.col.dienst')}</th><th>${tRaw('monitor.col.zeitplan')}</th></tr></thead>
      <tbody>${zeilen.map(([k, j]) => html`<tr><td>${serviceName(k, j)}</td><td>${schedInput(d.schedules, k)}</td></tr>`)}</tbody>
    </table></div>`,
  );
}
/** Line icons from the sprite as everywhere else; colored pictures looked like emojis next to them. */
const JOB_SYMBOL = /** @type {Record<string, string>} */ ({
  csvImport: 'import',
  blIds: 'link',
  instrQueue: 'datei',
  brickset: 'aktualisieren',
  priceJob: 'finanzen',
  imgDl: 'bild',
  pdfJobs: 'drucker',
});
const jobIconSvg = (/** @type {string} */ k) =>
  html`<svg class="ico mon-sinnbild" aria-hidden="true"><use href="#i-${JOB_SYMBOL[k] || 'uhr'}"/></svg>`;
const jobState = (/** @type {string} */ s) =>
  ({ running: tRaw('monitor.state.running'), done: tRaw('monitor.state.done'), error: tRaw('monitor.state.error') })[
    s
  ] || tRaw('monitor.state.idle');
const statusIcon = (/** @type {string} */ s, /** @type {JobStatus} */ j) => {
  if (s === 'running') return ico('uhr');
  if (s === 'done') return ico('ok');
  if (s === 'error') return ico('fehler');
  // idle: show warning if there's pending work (total > progress or sub mentions pending)
  if (s === 'idle' && j.total > 0 && j.progress < j.total) return ico('warnung');
  return ico('pause');
};
/** Only with running work: a standing bar read like a hanging run. */
const bar = (/** @type {number} */ v, /** @type {number} */ gesamt) => {
  if (!gesamt) return '';
  const pct = Math.min(100, Math.round((v / gesamt) * 100));
  return html`<div class="mon-balken"><div data-breite="${pct}"></div></div>`;
};
const aktionen = (/** @type {string} */ k, /** @type {JobStatus} */ j) =>
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
  docker_netz: 'monitor.proxy.docker_netz',
  eine_adresse: 'monitor.proxy.eine_adresse',
};

export async function loadMonitor() {
  const el = G('monitor-content');
  if (!el) return;
  stopMonitor();
  const lauf = ++_monitorLauf;
  // Calm every 15 s, every 5 s while something is running; a failed fetch still schedules the next round.
  const runde = async () => {
    const aktiv = await render();
    if (lauf !== _monitorLauf) return;
    _monitorTimer = setTimeout(() => ifVisible(() => lauf === _monitorLauf && runde()), aktiv ? 5000 : 15000);
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
    const zahl = (/** @type {number | null | undefined} */ n) => (n || 0).toLocaleString(locale());
    const setze = (/** @type {string} */ id, /** @type {string} */ v) => {
      const e = G(id);
      if (e) e.textContent = v;
    };
    setze('mon-db-sync', dbStats.csvCache.lastSync ? fmtDatum(dbStats.csvCache.lastSync) : '–');
    setze('mon-db-teile', zahl(dbStats.csvCache.parts));
    setze('mon-db-inventar', zahl(dbStats.csvCache.inventoryParts));
    setze('mon-db-bl', `${zahl(dbStats.blMapping.mapped)} / ${zahl(dbStats.blMapping.total)}`);

    setzeHtml(
      el,
      html`
      <p class="mon-hinweis">${tRaw('monitor.services_hint')}</p>
      ${d.degradiert?.length ? html`<p class="mon-hinweis" role="status">${tRaw('monitor.degradiert', { teile: d.degradiert.join(', ') })}</p>` : ''}
      ${d.proxy_hinweis ? html`<p class="mon-warnung" role="status" id="mon-proxy-hinweis">${ico('warnung')} ${tRaw(PROXY_HINT[d.proxy_hinweis.art], d.proxy_hinweis.vars)}</p>` : ''}
      <div class="tw"><table class="dt mon-tabelle mon-dienste" aria-label="${tRaw('tabelle.dienste')}">
        <thead><tr><th>${tRaw('monitor.col.dienst')}</th><th>${tRaw('monitor.col.zustand')}</th><th>${tRaw('monitor.col.zeitplan')}</th><th>${tRaw('monitor.col.zuletzt')}</th><th>${tRaw('monitor.col.aktionen')}</th></tr></thead>
        <tbody>${Object.entries(jobs).map(
          ([k, j]) => html`<tr>
          <td><span class="mon-name">${jobIconSvg(k === 'bricksetRetry' ? 'brickset' : k)}${serviceName(k, j)}</span></td>
          <td><span class="mon-zustand mon-${j.status || 'idle'}">${statusIcon(j.status, j)} ${jobState(j.status)}</span>
            ${j.sub_teile?.length || j.sub ? html`<div class="mon-leise">${j.sub_teile?.length ? subFromCodes(j.sub_teile, j.sub ?? '') : translateJobSub(j.sub ?? '')}</div>` : ''}${j.status === 'running' && j.total > 0 ? bar(j.progress, j.total) : ''}</td>
          <td>${schedText(schedules, k)}</td>
          <td>${j.lastRun ? fmtDatum(/** @type {string} */ (j.lastRun), 'wann') : ''}</td>
          <td><div class="mon-knoepfe">${aktionen(k, j).length ? aktionen(k, j) : html`<span class="mon-leise">–</span>`}</div></td>
        </tr>`,
        )}</tbody>
      </table></div>
      ${jobs.bricksetRetry ? html`<div id="brickset-queue-panel" class="mon-panel" data-stil="display:none"></div>` : ''}`,
    );

    if (panelHTML !== null) {
      const neu = G('brickset-queue-panel');
      if (neu) {
        setzeHtml(neu, rawHtml(panelHTML));
        neu.style.display = 'block';
        const knopf = el.querySelector('[data-click="toggleBricksetQueue"] span');
        if (knopf) knopf.textContent = tRaw('monitor.collapse');
      }
    }

    await showJobs();
    return Object.values(jobs).some(j => j.status === 'running');
  };
  await runde();
}

/**
 * Names of the job kinds and statuses — spelled out, so that every key stands checkably in the dictionary.
 * @type {Record<string, () => string>}
 */
const KIND_NAMES = {
  nacharbeit: () => tRaw('monitor.art.nacharbeit'),
  bilder: () => tRaw('monitor.art.bilder'),
  pdf: () => tRaw('monitor.art.pdf'),
  csv_import: () => tRaw('monitor.art.csv_import'),
  wechselkurse: () => tRaw('monitor.art.wechselkurse'),
  anleitung: () => tRaw('monitor.art.anleitung'),
  brickset: () => tRaw('monitor.art.brickset'),
  bildbedarf: () => tRaw('monitor.art.bildbedarf'),
  bilder_neu_laden: () => tRaw('monitor.art.bilder_neu_laden'),
  nachlauf: () => tRaw('monitor.art.nachlauf'),
  csv_sync: () => tRaw('monitor.art.csv_sync'),
  preise: () => tRaw('monitor.art.preise'),
  preise_nachladen: () => tRaw('monitor.art.preise_nachladen'),
  bild_nachlauf: () => tRaw('monitor.art.bild_nachlauf'),
  aufraeumen: () => tRaw('monitor.art.aufraeumen'),
  aufraeumen_taeglich: () => tRaw('monitor.art.aufraeumen_taeglich'),
  konto_dateien: () => tRaw('monitor.art.konto_dateien'),
  widerrufsliste: () => tRaw('monitor.art.widerrufsliste'),
  katalog_nachzug: () => tRaw('monitor.art.katalog_nachzug'),
};
/** @type {Record<string, () => string>} */
const STATUSNAMEN = {
  offen: () => tRaw('monitor.auftraege.offen'),
  laeuft: () => tRaw('monitor.auftraege.laeuft'),
  fehler: () => tRaw('monitor.auftraege.fehler'),
  abgebrochen: () => tRaw('monitor.auftraege.abgebrochen'),
};
/** The name of a job kind in the UI language, already escaped; unknown ones stay as they are. */
const artName = (/** @type {string} */ art) => (Object.hasOwn(KIND_NAMES, art) ? KIND_NAMES[art]() : art);

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
function fehlerKasten(text) {
  return html`<details class="fehler-kasten"><summary>${ico('warnung')} ${errorShort(text)}</summary><code>${text}</code></details>`;
}

// Seven identical "start now" are indistinguishable for screen readers: the name names the kind too.
const knopf = (/** @type {string} */ aktion, /** @type {string} */ arg, /** @type {string} */ text, wofuer = '') =>
  html`<button class="btn bs btn-sm" type="button" data-click="${aktion}"${echt()} data-arg="${arg}"${wofuer ? html` aria-label="${text}: ${wofuer}"` : ''}>${text}</button>`;
const statusName = (/** @type {string} */ s) => (Object.hasOwn(STATUSNAMEN, s) ? STATUSNAMEN[s]() : s);
/** A row of the individual jobs. If a kind is open several times, the role at the name says which entry
 * is a retry and which is the regular run. @param {Auftrag} a @param {Set<string>} mehrfach */
const jobRow = (a, mehrfach) => {
  const offen = a.status === 'offen' || a.status === 'laeuft';
  const rolle =
    !offen || !mehrfach.has(a.type)
      ? ''
      : a.geplant
        ? tRaw('monitor.auftraege.regulaer')
        : a.attempts > 1 || a.error_message
          ? tRaw('monitor.auftraege.wiederholung')
          : '';
  const zeit = fmtDatum(a.status === 'laeuft' ? a.started_at : a.due_at, 'wann');
  // Postponed is not failed: the server says so (wartet), not the text of the reason.
  const wartet = a.status === 'offen' && a.waiting && !!a.due_at && new Date(a.due_at) > new Date();
  const wann = wartet
    ? t('monitor.auftraege.wartet_bis', { zeit })
    : a.status === 'offen'
      ? t(a.geplant ? 'monitor.auftraege.geplant' : 'monitor.auftraege.faellig', { zeit })
      : a.status === 'laeuft'
        ? zeit
        : '';
  const stand = a.progress?.gesamt
    ? `${Math.round(a.progress.erledigt ?? 0)} / ${a.progress.gesamt}`
    : a.progress?.text || '';
  const hinweis = [
    wartet && a.error_message ? html`<span class="mon-leise">${a.error_message}</span>` : '',
    !wartet && a.error_message && (a.status === 'offen' || a.status === 'fehler') ? fehlerKasten(a.error_message) : '',
    a.attempts > 1 && !wartet
      ? html`<span class="mon-leise">${tRaw('monitor.auftraege.versuch', { n: a.attempts, max: a.max_attempts })}</span>`
      : '',
    stand ? html`<span class="mon-leise">${stand}</span>` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const aktion =
    a.status === 'offen' || a.status === 'laeuft'
      ? knopf('auftragAbbrechen', a.id, tRaw('monitor.auftraege.abbrechen'))
      : '';
  return html`<tr>
    <td><strong>${artName(a.type)}</strong>${a.set_number ? html` <span class="mon-leise">${a.set_number}</span>` : ''}${rolle ? html` <span class="mon-rolle">${rolle}</span>` : ''}</td>
    <td><span class="mon-zustand mon-${wartet ? 'wartet' : a.status}">${wartet ? tRaw('monitor.auftraege.wartet') : statusName(a.status)}</span></td>
    <td>${rawHtml(wann)}</td>
    <td>${rawHtml(hinweis)}</td>
    <td><div class="mon-knoepfe">${aktion}</div></td>
  </tr>`;
};

/** The card "background jobs": per kind the numbers with "now" and "clear", below the individual
 * running, waiting and failed jobs (GET /api/v1/admin/auftraege). */
async function showJobs() {
  const el = G('auftraege-karte');
  if (!el) return;
  const d = await api('GET', '/v1/admin/auftraege');
  if (!d?.success) {
    el.replaceChildren();
    return;
  }
  /** @type {Record<string, Record<string, number>>} */
  const zahl = {};
  for (const z of d.zusammenfassung) {
    zahl[z.type] ||= {};
    zahl[z.type][z.status] = z.anzahl;
  }
  // The next run per kind: the earliest waiting job of that kind.
  /** @type {Record<string, string>} */
  const naechster = {};
  for (const a of d.auftraege)
    if (a.status === 'offen' && a.due_at && (!naechster[a.type] || a.due_at < naechster[a.type]))
      naechster[a.type] = a.due_at;
  const arten = Object.keys(zahl).sort((a, b) => artName(a).localeCompare(artName(b), locale()));
  const ziffer = (/** @type {number | undefined} */ n, klasse = '') =>
    html`<span class="mon-ziffer${n ? html`${' '}${rawHtml(klasse)}` : ' null'}">${n || 0}</span>`;
  const mehr = d.auftraege.length - 40;
  /** @type {Record<string, number>} */
  const afterError = {};
  for (const a of d.auftraege)
    if (a.status === 'offen' && (a.attempts > 1 || a.error_message)) afterError[a.type] = (afterError[a.type] || 0) + 1;
  const jeArt = d.auftraege.filter(a => a.status === 'offen' || a.status === 'laeuft').map(a => a.type);
  const mehrfach = new Set(jeArt.filter((art, i) => jeArt.indexOf(art) !== i));
  const pause = (/** @type {AuftragPause} */ p) =>
    t('monitor.auftraege.pause', { art: artName(p.type), bis: fmtDatum(p.until_at, 'wann'), grund: p.reason || '' });
  setzeHtml(
    el,
    html`
    <h2 class="mon-titel" id="mon-t-auftraege" tabindex="-1">${ico('liste')}<span>${tRaw('monitor.auftraege.titel')}</span></h2>
    <p class="mon-hinweis">${tRaw('monitor.auftraege.hinweis')}</p>
    ${d.job_prozess.laeuft ? '' : html`<p class="mon-warnung">${ico('warnung')} ${tRaw('monitor.auftraege.kein_prozess')}</p>`}
    ${d.pausen.map(p => html`<p class="mon-leise">${ico('pause')} ${pause(p)}</p>`)}
    ${d.bildbedarf ? html`<p class="mon-leise">${tRaw('monitor.auftraege.bildbedarf', { n: d.bildbedarf })}</p>` : ''}
    ${
      arten.length
        ? html`<div class="tw"><table class="dt mon-tabelle mon-arten" aria-label="${tRaw('tabelle.auftragsarten')}">
      <thead><tr><th>${tRaw('monitor.col.art')}</th><th class="zahl">${tRaw('monitor.col.offen')}</th><th class="zahl">${tRaw('monitor.col.laeuft')}</th><th class="zahl">${tRaw('monitor.col.fehler')}</th><th>${tRaw('monitor.col.naechster')}</th><th>${tRaw('monitor.col.aktionen')}</th></tr></thead>
      <tbody>${arten.map(
        art => html`<tr>
        <td>${artName(art)}</td>
        <td class="zahl">${ziffer(zahl[art].offen)}${afterError[art] ? html`<span class="mon-leise mon-zusatz">${tRaw('monitor.auftraege.davon_nach_fehler', { n: afterError[art] })}</span>` : ''}</td>
        <td class="zahl">${ziffer(zahl[art].laeuft, 'mon-laeuft')}</td>
        <td class="zahl">${ziffer(zahl[art].fehler, 'mon-fehler')}</td>
        <td>${naechster[art] ? fmtDatum(naechster[art], 'wann') : ''}</td>
        <td><div class="mon-knoepfe">${knopf('auftragsArtJetzt', art, tRaw('monitor.auftraege.jetzt'), artName(art))}${zahl[art].offen ? knopf('auftragsArtLeeren', art, tRaw('monitor.auftraege.leeren'), artName(art)) : ''}</div></td>
      </tr>`,
      )}</tbody></table></div>`
        : ''
    }
    ${
      d.auftraege.length
        ? html`<details class="mon-einzeln"${openSingle() ? ' open' : ''}>
      <summary class="mon-untertitel">${tRaw('monitor.auftraege.einzeln')} <span class="mon-leise">(${d.auftraege.length})</span></summary>
      <div class="tw"><table class="dt mon-tabelle" aria-labelledby="mon-t-auftraege">
      <thead><tr><th>${tRaw('monitor.col.auftrag')}</th><th>${tRaw('monitor.col.zustand')}</th><th>${tRaw('monitor.col.zeit')}</th><th>${tRaw('monitor.col.hinweis')}</th><th>${tRaw('monitor.col.aktionen')}</th></tr></thead>
      <tbody>${d.auftraege.slice(0, 40).map(a => jobRow(a, mehrfach))}</tbody></table></div>
      ${mehr > 0 ? html`<p class="mon-leise">${tRaw('monitor.auftraege.mehr', { n: mehr })}</p>` : ''}</details>`
        : html`<h3 class="mon-untertitel">${tRaw('monitor.auftraege.einzeln')}</h3><p class="mon-leise">${tRaw('monitor.auftraege.leer')}</p>`
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
      if (d instanceof HTMLDetailsElement && d.classList.contains('mon-einzeln')) _openSingle = d.open;
    },
    true,
  );

/** @param {string} id */
async function auftragAbbrechen(id) {
  const d = await api('POST', `/v1/admin/auftraege/${encodeURIComponent(id)}/abbrechen`);
  if (!d?.success) toast(d?.error || t('settings.error'), 'error');
  await showJobs();
}

/** @param {string} art */
async function auftragsArtJetzt(art) {
  const d = await api('POST', `/v1/admin/auftraege/art/${encodeURIComponent(art)}/jetzt`);
  if (!d?.success) toast(d?.error || t('settings.error'), 'error');
  await showJobs();
}

/** @param {string} art */
async function auftragsArtLeeren(art) {
  const d = await api('DELETE', `/v1/admin/auftraege/art/${encodeURIComponent(art)}`);
  if (d?.success) toast(tRaw('monitor.auftraege.geleert', { n: d.entfernt }), 'success');
  else toast(d?.error || t('settings.error'), 'error');
  await showJobs();
}

/** When leaving the tab: stop polling. @returns {boolean} whether it was running */
export function stopMonitor() {
  _monitorLauf++;
  if (!_monitorTimer) return false;
  clearTimeout(_monitorTimer);
  _monitorTimer = null;
  return true;
}

// ── Register handlers with the dispatcher (js/registry.js); it belongs to the module that implements it. ──
registerActions({
  openLogViewer,
  auftragAbbrechen,
  auftragsArtJetzt,
  auftragsArtLeeren,
});
