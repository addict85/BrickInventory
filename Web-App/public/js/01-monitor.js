// Beide Seiten der Überwachung beieinander: die Liste der Dienste und das Protokollfenster.
// Ausführlich: docs/begruendungen/public/js/01-monitor.js.md#dieser-block-lag-in-js-01-core-js-deren
import { echt, registerActions } from './00-registry.js';
import { alsHtml, escHtmlAttr, esc, html, ungeprueft } from './00-escapen.js';
import { api, apiDaten } from './01-api.js';
import { ico, G, setzeHtml } from './01-dom.js';
import { fmtDatum } from './01-format.js';
import { toast } from './01-meldungen.js';
import { LANG, locale, t, tRaw } from '../i18n.js';
/** @typedef {import('../../frontend-typen/vertrag').AuftragPause} AuftragPause */
/** @typedef {import('../../frontend-typen/vertrag').Auftrag} Auftrag */
/** @typedef {import('../../frontend-typen/vertrag').JobStatus} JobStatus */

/**
 * Zeitgeber, der die Jobliste nachzieht, solange der Reiter offen ist.
 *
 * Er steht hier, weil nur diese Datei ihn setzt — js/02-gallery.js hält ihn beim Reiterwechsel an, dafür gibt
 * es den Setter unten.
 */
/** @type {ReturnType<typeof setInterval> | null} */
let _monitorTimer = null;

function openLogViewer() {
  const win = window.open('', '_blank', 'width=1200,height=750,resizable=yes,scrollbars=yes');
  if (!win) { alert(tRaw('popup.blocked')); return; }
  const base  = window.location.origin;

  // Die Zeitspannen als Daten statt als sechs ausgeschriebene <option>: So steht die Beschriftung EINMAL da,
  // in der Sprache des Nutzers. Vorher waren es sechs deutsche Literale — in einem Fenster, das ein
  // englischer Verwalter genauso oeffnet.
  const spannen = [15, 30, 60, 360, 1440, 2880].map((min) => {
    const text = min < 60 ? t('log.minutes_n', { n: min })
      : min === 60 ? t('log.hour_1')
      : t('log.hours_n', { n: min / 60 });
    return '<option value="' + min + '">' + text + '</option>';
  }).join('');

  const markup = '<!DOCTYPE html><html lang="' + escHtmlAttr(LANG) + '"><head>' +
    '<meta charset="UTF-8"><title>' + esc(tRaw('log.title')) + '</title>' +
    '<link rel="stylesheet" href="/tokens.css?v=' + (window.__APP_VERSION || Date.now()) + '">' +
    '<link rel="stylesheet" href="/logviewer.css?v=' + (window.__APP_VERSION || Date.now()) + '">' +
    '</head><body' +
      ' data-base="' + escHtmlAttr(base) + '"' +
      ' data-i18n="' + escHtmlAttr(JSON.stringify({
        'common.loading':       tRaw('common.loading'),
        'common.network_error': tRaw('common.network_error'),
        'log.none_found':       tRaw('log.none_found'),
        'log.entries':          tRaw('log.entries'),
        'toast.error':          tRaw('toast.error'),
        // Die beiden Beschriftungen des Auto-Knopfes wechseln zur Laufzeit; logviewer.js hatte sie deshalb
        // als deutsche Literale.
        'log.auto':             tRaw('log.auto'),
        'log.stop':             tRaw('log.stop'),
      })) + '">' +
    '<header>' +
      '<h1>' + esc(tRaw('log.title')) + '</h1>' +
      '<div class="toolbar">' +
        '<label class="vh" for="period">' + esc(tRaw('log.zeitraum')) + '</label>' +
        '<select id="period" data-change="loadLogs">' + spannen + '</select>' +
        '<span class="sep">|</span>' +
        '<button type="button" class="lvbtn info-btn" id="btn-info" data-click="toggleLevel" data-arg="info" aria-pressed="false"><span aria-hidden="true">\u2139</span> Info</button>' +
        '<button type="button" class="lvbtn warn-btn active" id="btn-warn" data-click="toggleLevel" data-arg="warn" aria-pressed="true"><span aria-hidden="true">\u26A0</span> Warn</button>' +
        '<button type="button" class="lvbtn error-btn active" id="btn-error" data-click="toggleLevel" data-arg="error" aria-pressed="true"><span aria-hidden="true">\u2716</span> Error</button>' +
        '<span class="sep">|</span>' +
        '<input id="search" type="search" aria-label="' + escHtmlAttr(tRaw('log.search')) + '" placeholder="' + escHtmlAttr(tRaw('log.search')) + '" data-input="renderLogs">' +
        '<span class="sep">|</span>' +
        '<button type="button" data-click="loadLogs">' + esc(tRaw('log.reload')) + '</button>' +
        '<button type="button" data-click="toggleAuto" id="btn-auto" aria-pressed="false">' + esc(tRaw('log.auto')) + '</button>' +
        '<span id="status" role="status">\u2013</span>' +
      '</div>' +
    '</header>' +
    '<main id="log-wrap" tabindex="0" aria-label="' + escHtmlAttr(tRaw('log.title')) + '"></main>' +
    '<script src="/js/logviewer.js?v=' + (window.__APP_VERSION || Date.now()) + '"><\/script>' +
    '</body></html>';

  win.document.write(alsHtml(ungeprueft(markup)));
  win.document.close();
}

/** Je Code des Servers ein ausgeschriebener Schlüssel: So prüft test/i18n-aufrufe.test.js, dass es ihn gibt. */
/** @type {Record<string, (w?: Record<string, string | number>) => string>} */
const SUB_TEXTE = {
  teil_gemappt: (w) => tRaw('monitor.sub.teil_gemappt', w),
  all_mapped: (w) => tRaw('monitor.sub.all_mapped', w),
  ausstehend: (w) => tRaw('monitor.sub.ausstehend', w),
  all_done: (w) => tRaw('monitor.sub.all_done', w),
  keine_ausstehenden: (w) => tRaw('monitor.sub.keine_ausstehenden', w),
  retry_ready: (w) => tRaw('monitor.sub.retry_ready', w),
  warten_morgen: (w) => tRaw('monitor.sub.warten_morgen', w),
  bilder_laden: (w) => tRaw('monitor.sub.bilder_laden', w),
  bilder_offen: (w) => tRaw('monitor.sub.bilder_offen', w),
  imgs_cached: (w) => tRaw('monitor.sub.imgs_cached', w),
  katalog_warteschlange: (w) => tRaw('monitor.sub.katalog_warteschlange', w),
  job_nie: (w) => tRaw('monitor.sub.job_nie', w),
  kein_durchgang: (w) => tRaw('monitor.sub.kein_durchgang', w),
  neu_suche: (w) => tRaw('monitor.sub.neu_suche', w),
  neu_geladen: (w) => tRaw('monitor.sub.neu_geladen', w),
  pdf_laufend: (w) => tRaw('monitor.sub.pdf_laufend', w),
  pdf_bereit: (w) => tRaw('monitor.sub.pdf_bereit', w),
  no_active: (w) => tRaw('monitor.sub.no_active', w),
  bestand: (w) => tRaw('monitor.sub.bestand', w),
};

/**
 * Untertitel aus den Codes des Servers (src/verwaltung/dienst.ts); die Sätze stehen nur in den Sprachdateien.
 * Ein unbekannter Code (neuerer Server) fällt auf den Text des Servers zurück.
 * @param {{ code: string, werte?: Record<string, string | number>, vor?: string }[]} teile @param {string} sub
 */
function subAusCodes(teile, sub) {
  const text = (/** @type {string} */ code, /** @type {Record<string, string | number> | undefined} */ werte) => {
    const f = Object.hasOwn(SUB_TEXTE, code) ? SUB_TEXTE[code] : null; return f ? f(werte) : null; };
  const stuecke = teile.map(t => { const s = text(t.code, t.werte); return s === null ? null : (t.vor ? (text(t.vor, undefined) ?? '') + ' ' : '') + s; });
  return stuecke.includes(null) ? translateJobSub(sub) : stuecke.join(' · ');
}

// Übersetzt Server-seitige Job-Sub-Texte (background jobs kennen die Nutzersprache nicht). Bekannte Muster
// werden clientseitig ersetzt.
/**
 * @param {string} sub
 */
function translateJobSub(sub) {
  if (!sub) return '';
  let m;
  m = sub.match(/^Alle (\d+) gemappt$/);
  if (m) return tRaw('monitor.sub.all_mapped', {n: m[1]});
  if (sub === 'Alle erledigt') return tRaw('monitor.sub.all_done');
  m = sub.match(/^Alle (\d+) Bilder gecacht$/);
  if (m) return tRaw(m[1] === '0' ? 'monitor.sub.imgs_none' : 'monitor.sub.imgs_cached', {n: m[1]});
  if (sub === 'Alle Bilder gecacht') return tRaw('monitor.sub.imgs_cached', {n: ''}).trim();
  if (/^Keine aktiven/.test(sub)) return tRaw('monitor.sub.no_active');
  m = sub.match(/^(\d+) Sets bereit zum Retry, (\d+) warten$/);
  if (m) return tRaw('monitor.sub.retry_ready', {n: m[1], w: m[2]});
  m = sub.match(/^(\d+) aktualisiert, (\d+) Fehler — ([\d.]+)s$/);
  if (m) return tRaw('monitor.sub.updated_errors', {upd: m[1], err: m[2], sec: m[3]});
  if (sub === 'Starte\u2026' || sub === 'Starte...') return tRaw('monitor.starting');
  return sub; // unbekannt: unverändert
}

// Speichert den Zeitplan eines Jobs (Monitoring). payload = {time:"HH:MM"} oder {minutes:n}.
/**
 * @param {string} name
 * @param {{ time?: string, minutes?: number }} payload
 */
export async function saveJobSchedule(name, payload) {
  const d = await api('POST', '/v1/admin/job-schedule', { name, ...payload }).catch(() => null);
  if (d?.success) toast(tRaw('monitor.sched.saved'), 'success');
  else toast(d?.error || t('settings.error'), 'error');
}


// Bausteine der Dienstetabelle im Monitor. Die Uhrzeit als Textfeld mit 24-h-Form: <input type="time"> zeigt
// die Form des Browsers („03:00 AM“), unabhängig von der Sprache der Seite.
/** @param {Record<string, import('../../frontend-typen/vertrag').JobSchedule> | null | undefined} schedules @param {string} k */
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
const jobIconSvg = (/** @type {string} */ k) => {
  /** @type {Record<string, string>} */
  const svgs = {
    // CSV-Import (Rebrickable): kleine Tabelle/Raster mit farbigen Zeilen
    csvImport: '<rect x="12" y="20" width="96" height="18" rx="2" fill="#0055BF"/><rect x="12" y="44" width="96" height="18" rx="2" fill="#F2CD37"/><rect x="12" y="68" width="96" height="18" rx="2" fill="#E63329"/><rect x="12" y="92" width="96" height="18" rx="2" fill="#9BA19D"/>',
    // BrickLink IDs nachladen: zwei verbundene Ringe (Verknüpfung/Mapping)
    blIds: '<path d="M40,45 a20,20 0 1,0 0.1,0" fill="none" stroke="#0055BF" stroke-width="12"/><path d="M80,75 a20,20 0 1,0 0.1,0" fill="none" stroke="#E63329" stroke-width="12"/>',
    // Handbücher herunterladen: kleines aufgeschlagenes Buch
    instrQueue: '<path d="M60,28 C50,22 30,20 16,24 L16,92 C30,88 50,90 60,96 Z" fill="#E63329"/><path d="M60,28 C70,22 90,20 104,24 L104,92 C90,88 70,90 60,96 Z" fill="#CC2A21"/><rect x="24" y="38" width="28" height="4" rx="2" fill="#fff"/><rect x="24" y="50" width="28" height="4" rx="2" fill="#fff"/><rect x="24" y="62" width="20" height="4" rx="2" fill="#fff"/>',
    // Preise aktualisieren: Preisschild (Gold) mit Loch
    brickset: '<rect x="10" y="48" width="28" height="24" rx="3" fill="#0055BF"/><circle cx="24" cy="48" r="4.5" fill="#0055BF"/><rect x="46" y="48" width="28" height="24" rx="3" fill="#F2CD37"/><circle cx="60" cy="48" r="4.5" fill="#F2CD37"/><rect x="82" y="48" width="28" height="24" rx="3" fill="#E63329"/><circle cx="96" cy="48" r="4.5" fill="#E63329"/>',
    priceJob: '<path d="M18,60 L58,20 L100,20 Q108,20 108,28 L108,70 Q108,78 100,78 L58,100 Z" fill="#F2CD37"/><circle cx="84" cy="42" r="9" fill="#fff"/>',
        // Bild-Download: Bilderrahmen mit Berg und Sonne
        imgDl: '<rect x="10" y="20" width="100" height="80" rx="8" fill="#0055BF"/><circle cx="82" cy="44" r="10" fill="#F2CD37"/><path d="M18,92 L48,52 L70,80 L82,66 L102,92 Z" fill="#fff"/>',
        // PDF-Aufträge: Blatt mit roter Leiste
        pdfJobs: '<path d="M26,10 L76,10 L98,32 L98,110 L26,110 Z" fill="#9BA19D"/><path d="M76,10 L76,32 L98,32 Z" fill="#fff" fill-opacity=".6"/><rect x="16" y="56" width="70" height="26" rx="4" fill="#E63329"/><rect x="38" y="90" width="44" height="5" rx="2.5" fill="#fff"/>',
  };
  return svgs[k] ? html`<svg class="mon-sinnbild" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${ungeprueft(svgs[k])}</svg>` : '<span class="mon-sinnbild" aria-hidden="true"></span>';
};
const jobZustand = (/** @type {string} */ s) => ({ running: tRaw('monitor.state.running'), done: tRaw('monitor.state.done'),
  error: tRaw('monitor.state.error') })[s] || tRaw('monitor.state.idle');
const statusIcon = (/** @type {string} */ s, /** @type {JobStatus} */ j) => {
  if (s === 'running') return ico('uhr');
  if (s === 'done')    return ico('ok');
  if (s === 'error')   return ico('fehler');
  // idle: show warning if there's pending work (total > progress or sub mentions pending)
  if (s === 'idle' && j.total > 0 && j.progress < j.total) return ico('warnung');
  return ico('pause');
};
const bar = (/** @type {number} */ v, /** @type {number} */ gesamt) => {
  if (!gesamt) return '';
  const pct = Math.min(100, Math.round(v / gesamt * 100));
  return html`<div class="mon-balken"><div data-breite="${pct}"></div></div>`;
};
const aktionen = (/** @type {string} */ k, /** @type {JobStatus} */ j) => [
  k === 'priceJob' ? html`<button class="btn bs btn-sm" type="button" data-click="clickJobTrigger">${tRaw('monitor.run_now')}</button>` : '',
  k === 'instrQueue' ? html`<button class="btn bs btn-sm" type="button" data-click="reimportMissingInstructions" data-self="1">${tRaw('monitor.import_missing')}</button>` : '',
  k === 'csvImport' ? html`<button class="btn bs btn-sm" type="button" data-click="triggerCsvSync" data-self="1">${tRaw('monitor.sync_now')}</button>` : '',
  k === 'imgDl' && j.canRedownload ? html`<button class="btn bs btn-sm" type="button" data-click="redownloadMissingImages" data-self="1">${tRaw('monitor.redownload_missing')}</button>` : '',
  k === 'imgDl' ? html`<button class="btn bs btn-sm" type="button" data-click="queueCatalogImages" data-self="1">${tRaw('monitor.catalog_images')}</button>` : '',
  k === 'bricksetRetry' && j.total > 0 ? html`<button class="btn bs btn-sm" type="button" data-click="toggleBricksetQueue" data-self="1"><span>${tRaw('monitor.show')}</span></button>` : '',
].join('');
const dienstName = (/** @type {string} */ k, /** @type {JobStatus} */ j) => tRaw('monitor.job.' + k) !== 'monitor.job.' + k ? tRaw('monitor.job.' + k) : (j.label || k);

export async function loadMonitor() {
  const el = G('monitor-content');
  if (!el) return;
  if (_monitorTimer) clearInterval(_monitorTimer);
  const render = async () => {
    const d = await apiDaten('GET', '/v1/admin/jobs');
    if (!d?.success) return;
    // Nicht neu rendern, während der Nutzer gerade eine Zeitplan-Eingabe bearbeitet (sonst würde das
    // 3s-Re-Render die Eingabe/den Fokus verwerfen).
    const _ae = document.activeElement;
    if (_ae && _ae.classList && _ae.classList.contains('job-sched-input')) return;
    const { jobs, schedules } = d;
    // db und lastRun nennt der Vertrag nicht (JobsResponse); der Server schickt sie mit.
    const dbStats = /** @type {{ csvCache: { lastSync?: string, parts?: number, inventoryParts?: number }, blMapping: { mapped?: number, total?: number } }} */ (d.db);
    const panel = G('brickset-queue-panel');
    const panelHTML = panel && panel.style.display !== 'none' ? panel.innerHTML : null;
    const zahl = (/** @type {number | null | undefined} */ n) => (n || 0).toLocaleString(locale());
    const setze = (/** @type {string} */ id, /** @type {string} */ v) => { const e = G(id); if (e) e.textContent = v; };
    setze('mon-db-sync', dbStats.csvCache.lastSync ? fmtDatum(dbStats.csvCache.lastSync) : '–');
    setze('mon-db-teile', zahl(dbStats.csvCache.parts));
    setze('mon-db-inventar', zahl(dbStats.csvCache.inventoryParts));
    setze('mon-db-bl', `${zahl(dbStats.blMapping.mapped)} / ${zahl(dbStats.blMapping.total)}`);

    setzeHtml(el, html`
      <p class="mon-hinweis">${tRaw('monitor.services_hint')}</p>
      ${d.degradiert?.length ? html`<p class="mon-hinweis" role="status">${tRaw('monitor.degradiert', { teile: d.degradiert.join(', ') })}</p>` : ''}
      <div class="tw"><table class="dt mon-tabelle mon-dienste" aria-label="${tRaw('tabelle.dienste')}">
        <thead><tr><th>${tRaw('monitor.col.dienst')}</th><th>${tRaw('monitor.col.zustand')}</th><th>${tRaw('monitor.col.zeitplan')}</th><th>${tRaw('monitor.col.zuletzt')}</th><th>${tRaw('monitor.col.aktionen')}</th></tr></thead>
        <tbody>${Object.entries(jobs).map(([k, j]) => html`<tr>
          <td><span class="mon-name">${k === 'bricksetRetry' ? ungeprueft(jobIconSvg('brickset')) : ungeprueft(jobIconSvg(k))}${dienstName(k, j)}</span></td>
          <td><span class="mon-zustand mon-${j.status || 'idle'}">${statusIcon(j.status, j)} ${jobZustand(j.status)}</span>
            ${j.sub_teile?.length || j.sub ? html`<div class="mon-leise">${j.sub_teile?.length ? subAusCodes(j.sub_teile, j.sub ?? '') : translateJobSub(j.sub ?? '')}</div>` : ''}${j.total > 0 ? bar(j.progress, j.total) : ''}</td>
          <td>${schedInput(schedules, k)}</td>
          <td>${j.lastRun ? fmtDatum(/** @type {string} */ (j.lastRun), 'zeit') : ''}</td>
          <td><div class="mon-knoepfe">${(aktionen(k, j)) ? ungeprueft(aktionen(k, j)) : html`<span class="mon-leise">–</span>`}</div></td>
        </tr>`)}</tbody>
      </table></div>
      ${jobs.bricksetRetry ? html`<div id="brickset-queue-panel" class="mon-panel" data-stil="display:none"></div>` : ''}`);

    if (panelHTML !== null) {
      const neu = G('brickset-queue-panel');
      if (neu) {
        setzeHtml(neu, ungeprueft(panelHTML));
        neu.style.display = 'block';
        const knopf = el.querySelector('[data-click="toggleBricksetQueue"] span');
        if (knopf) knopf.textContent = tRaw('monitor.collapse');
      }
    }

    await zeigeAuftraege();

    // Schneller auffrischen, solange Bild- oder PDF-Aufträge laufen
    const anyActive = Object.values(jobs).some(j => j.status === 'running');
    const interval = anyActive ? 2000 : 5000;
    if (_monitorTimer) clearInterval(_monitorTimer);
    _monitorTimer = setInterval(render, interval);
  };
  await render();
}

/**
 * Namen der Auftragsarten und Status — ausgeschrieben, damit jeder Schlüssel prüfbar im Wörterbuch steht.
 * @type {Record<string, () => string>}
 */
const ARTNAMEN = {
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
};
/** @type {Record<string, () => string>} */
const STATUSNAMEN = {
  offen: () => tRaw('monitor.auftraege.offen'),
  laeuft: () => tRaw('monitor.auftraege.laeuft'),
  fehler: () => tRaw('monitor.auftraege.fehler'),
  abgebrochen: () => tRaw('monitor.auftraege.abgebrochen'),
};
/** Der Name einer Auftragsart in der Oberflächensprache, fertig maskiert; unbekannte bleiben, wie sie sind. */
const artName = (/** @type {string} */ art) => (Object.hasOwn(ARTNAMEN, art) ? ARTNAMEN[art]() : art);

/**
 * Eine Fehlermeldung des Servers in einem Satz, den man ohne Netzwerkwissen versteht; der Originaltext bleibt
 * aufklappbar, er ist für die Fehlersuche da.
 * @param {unknown} text
 */
export function fehlerKurz(text) {
  const s = String(text || '');
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|fetch failed|network|socket hang up/i.test(s)) return tRaw('monitor.err.net');
  if (/timed? ?out|ETIMEDOUT|Zeitüberschreitung/i.test(s)) return tRaw('monitor.err.timeout');
  if (/\b429\b|rate.?limit|too many/i.test(s)) return tRaw('monitor.err.limit');
  if (/\b40[13]\b|unauthori[sz]ed|forbidden|api.?key|schlüssel/i.test(s)) return tRaw('monitor.err.auth');
  if (/\b404\b|not found/i.test(s)) return tRaw('monitor.err.missing');
  return tRaw('monitor.err.other');
}

/** @param {unknown} text */
function fehlerKasten(text) {
  return html`<details class="fehler-kasten"><summary>${ico('warnung')} ${fehlerKurz(text)}</summary><code>${text}</code></details>`;
}

/**
 * Die Karte „Hintergrundarbeiten“: die Auftragstabelle des Servers (GET /api/v1/admin/auftraege) — je Art die
 * Zahlen mit „Jetzt“ und „Leeren“, darunter laufende, wartende und gescheiterte Aufträge.
 */
async function zeigeAuftraege() {
  const el = G('auftraege-karte');
  if (!el) return;
  const d = await api('GET', '/v1/admin/auftraege').catch(() => null);
  if (!d?.success) { el.replaceChildren(); return; }
  /** @type {Record<string, Record<string, number>>} */
  const zahl = {};
  for (const z of d.zusammenfassung) (zahl[z.art] ||= {})[z.status] = z.anzahl;
  // Der nächste Lauf je Art: der früheste wartende Auftrag dieser Art.
  /** @type {Record<string, string>} */
  const naechster = {};
  for (const a of d.auftraege)
    if (a.status === 'offen' && a.faellig_ab && (!naechster[a.art] || a.faellig_ab < naechster[a.art])) naechster[a.art] = a.faellig_ab;
  // Sieben gleiche „Jetzt starten“ sind für Vorleser ununterscheidbar: Der Name nennt die Art mit.
  const knopf = (/** @type {string} */ aktion, /** @type {string} */ arg, /** @type {string} */ text, wofuer = '') =>
    html`<button class="btn bs btn-sm" type="button" data-click="${aktion}"${echt()} data-arg="${arg}"${wofuer ? html` aria-label="${text}: ${wofuer}"` : ''}>${text}</button>`;
  const arten = Object.keys(zahl).sort((a, b) => artName(a).localeCompare(artName(b), locale()));
  const status = (/** @type {string} */ s) => Object.hasOwn(STATUSNAMEN, s) ? STATUSNAMEN[s]() : s;
  const ziffer = (/** @type {number | undefined} */ n, klasse = '') => html`<span class="mon-ziffer${n ? html`${' '}${ungeprueft(klasse)}` : ' null'}">${n || 0}</span>`;
  const zeile = (/** @type {Auftrag} */ a) => {
    const zeit = fmtDatum(a.status === 'laeuft' ? a.gestartet : a.faellig_ab, 'zeit');
    const wann = a.status === 'offen' ? t(a.geplant ? 'monitor.auftraege.geplant' : 'monitor.auftraege.faellig', { zeit }) : (a.status === 'laeuft' ? zeit : '');
    const stand = a.fortschritt?.gesamt ? `${a.fortschritt.erledigt ?? 0} / ${a.fortschritt.gesamt}` : (a.fortschritt?.text || '');
    const hinweis = [a.fehler && a.status !== 'laeuft' ? fehlerKasten(a.fehler) : '',
      a.versuche > 1 ? html`<span class="mon-leise">${tRaw('monitor.auftraege.versuch', { n: a.versuche, max: a.max_versuche })}</span>` : '',
      stand ? html`<span class="mon-leise">${stand}</span>` : ''].filter(Boolean).join(' ');
    const aktion = a.status === 'offen' || a.status === 'laeuft' ? knopf('auftragAbbrechen', a.id, tRaw('monitor.auftraege.abbrechen'))
      : a.status === 'fehler' || a.status === 'abgebrochen' ? knopf('auftragWiederholen', a.id, tRaw('monitor.auftraege.wiederholen')) : '';
    return html`<tr>
      <td><strong>${artName(a.art)}</strong>${a.set_number ? html` <span class="mon-leise">${a.set_number}</span>` : ''}</td>
      <td><span class="mon-zustand mon-${a.status}">${status(a.status)}</span></td>
      <td>${ungeprueft(wann)}</td>
      <td>${ungeprueft(hinweis)}</td>
      <td><div class="mon-knoepfe">${aktion}</div></td>
    </tr>`;
  };
  const mehr = d.auftraege.length - 40;
  const pause = (/** @type {AuftragPause} */ p) => t('monitor.auftraege.pause', { art: artName(p.art), bis: fmtDatum(p.bis, 'zeit'), grund: p.grund || '' });
  setzeHtml(el, html`
    <h2 class="mon-titel" id="mon-t-auftraege">${ico('liste')}<span>${tRaw('monitor.auftraege.titel')}</span></h2>
    <p class="mon-hinweis">${tRaw('monitor.auftraege.hinweis')}</p>
    ${d.job_prozess.laeuft ? '' : html`<p class="mon-warnung">${ico('warnung')} ${tRaw('monitor.auftraege.kein_prozess')}</p>`}
    ${d.pausen.map(p => html`<p class="mon-leise">${ico('pause')} ${pause(p)}</p>`)}
    ${d.bildbedarf ? html`<p class="mon-leise">${tRaw('monitor.auftraege.bildbedarf', { n: d.bildbedarf })}</p>` : ''}
    ${arten.length ? html`<div class="tw"><table class="dt mon-tabelle mon-arten" aria-label="${tRaw('tabelle.auftragsarten')}">
      <thead><tr><th>${tRaw('monitor.col.art')}</th><th class="zahl">${tRaw('monitor.col.offen')}</th><th class="zahl">${tRaw('monitor.col.laeuft')}</th><th class="zahl">${tRaw('monitor.col.fehler')}</th><th>${tRaw('monitor.col.naechster')}</th><th>${tRaw('monitor.col.aktionen')}</th></tr></thead>
      <tbody>${arten.map(art => html`<tr>
        <td>${artName(art)}</td>
        <td class="zahl">${ziffer(zahl[art].offen)}</td>
        <td class="zahl">${ziffer(zahl[art].laeuft, 'mon-laeuft')}</td>
        <td class="zahl">${ziffer(zahl[art].fehler, 'mon-fehler')}</td>
        <td>${naechster[art] ? fmtDatum(naechster[art], 'zeit') : ''}</td>
        <td><div class="mon-knoepfe">${knopf('auftragsArtJetzt', art, tRaw('monitor.auftraege.jetzt'), artName(art))}${zahl[art].offen ? knopf('auftragsArtLeeren', art, tRaw('monitor.auftraege.leeren'), artName(art)) : ''}</div></td>
      </tr>`)}</tbody></table></div>` : ''}
    ${d.auftraege.length ? html`<details class="mon-einzeln"${einzelnOffen() ? ' open' : ''}>
      <summary class="mon-untertitel">${tRaw('monitor.auftraege.einzeln')} <span class="mon-leise">(${d.auftraege.length})</span></summary>
      <div class="tw"><table class="dt mon-tabelle" aria-labelledby="mon-t-auftraege">
      <thead><tr><th>${tRaw('monitor.col.auftrag')}</th><th>${tRaw('monitor.col.zustand')}</th><th>${tRaw('monitor.col.zeit')}</th><th>${tRaw('monitor.col.hinweis')}</th><th>${tRaw('monitor.col.aktionen')}</th></tr></thead>
      <tbody>${d.auftraege.slice(0, 40).map(zeile)}</tbody></table></div>
      ${mehr > 0 ? html`<p class="mon-leise">${tRaw('monitor.auftraege.mehr', { n: mehr })}</p>` : ''}</details>` : html`<h3 class="mon-untertitel">${tRaw('monitor.auftraege.einzeln')}</h3><p class="mon-leise">${tRaw('monitor.auftraege.leer')}</p>`}`);
}
/**
 * Die Liste der einzelnen Aufträge ist am Telefon zu, sonst offen; ein Klick gilt bis zum Neuladen, auch über
 * das Nachzeichnen alle paar Sekunden.
 * @type {boolean | null}
 */
let _einzelnOffen = null;
const einzelnOffen = () => _einzelnOffen ?? !(typeof matchMedia === 'function' && matchMedia('(max-width: 640px)').matches);
if (typeof document !== 'undefined') document.addEventListener('toggle', (ev) => {
  const d = ev.target;
  if (d instanceof HTMLDetailsElement && d.classList.contains('mon-einzeln')) _einzelnOffen = d.open;
}, true);


/** @param {string} id */
async function auftragAbbrechen(id) {
  const d = await api('POST', `/v1/admin/auftraege/${encodeURIComponent(id)}/abbrechen`).catch(() => null);
  if (!d?.success) toast(d?.error || t('settings.error'), 'error');
  await zeigeAuftraege();
}

/** @param {string} id */
async function auftragWiederholen(id) {
  const d = await api('POST', `/v1/admin/auftraege/${encodeURIComponent(id)}/wiederholen`).catch(() => null);
  if (!d?.success) toast(d?.error || t('settings.error'), 'error');
  await zeigeAuftraege();
}

/** @param {string} art */
async function auftragsArtJetzt(art) {
  const d = await api('POST', `/v1/admin/auftraege/art/${encodeURIComponent(art)}/jetzt`).catch(() => null);
  if (!d?.success) toast(d?.error || t('settings.error'), 'error');
  await zeigeAuftraege();
}

/** @param {string} art */
async function auftragsArtLeeren(art) {
  const d = await api('DELETE', `/v1/admin/auftraege/art/${encodeURIComponent(art)}`).catch(() => null);
  if (d?.success) toast(tRaw('monitor.auftraege.geleert', { n: d.entfernt }), 'success');
  else toast(d?.error || t('settings.error'), 'error');
  await zeigeAuftraege();
}

/** Beim Verlassen des Reiters: die Abfrage anhalten. @returns {boolean} ob sie lief */
export function stoppeMonitor() {
  if (!_monitorTimer) return false;
  clearInterval(_monitorTimer); _monitorTimer = null;
  return true;
}

// ── Handler beim Dispatcher anmelden (siehe js/00-registry.js) ──────────────
// Der Handler gehört zu dem Modul, das ihn umsetzt.
registerActions({
  openLogViewer, auftragAbbrechen, auftragWiederholen, auftragsArtJetzt, auftragsArtLeeren,
});
