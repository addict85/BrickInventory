// ── Überwachung: Jobliste im Reiter „Monitoring" und das Protokollfenster ────
//
// ── Warum eine eigene Datei ──────────────────────────────────
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
import { echt, registerActions } from './00-registry.js';
import { fmtDatum, ico, G, api, esc, escHtmlAttr, toast } from './01-core.js';
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
  const base  = window.location.origin;

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
    '<link rel="stylesheet" href="/tokens.css?v=' + (window.__APP_VERSION || Date.now()) + '">' +
    '<link rel="stylesheet" href="/logviewer.css?v=' + (window.__APP_VERSION || Date.now()) + '">' +
    '</head><body' +
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
  if (m) return t(m[1] === '0' ? 'monitor.sub.imgs_none' : 'monitor.sub.imgs_cached', {n: m[1]});
  if (sub === 'Alle Bilder gecacht') return t('monitor.sub.imgs_cached', {n: ''}).trim();
  if (/^Keine aktiven/.test(sub)) return t('monitor.sub.no_active');
  m = sub.match(/^(\d+) Sets bereit zum Retry, (\d+) warten$/);
  if (m) return t('monitor.sub.retry_ready', {n: m[1], w: m[2]});
  m = sub.match(/^(\d+) aktualisiert, (\d+) Fehler — ([\d.]+)s$/);
  if (m) return t('monitor.sub.updated_errors', {upd: m[1], err: m[2], sec: m[3]});
  if (sub === 'Starte\u2026' || sub === 'Starte...') return t('monitor.starting');
  return esc(sub); // unbekannt: unverändert, aber als Text
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
    // Die Uhrzeit als Textfeld mit 24-h-Form: <input type="time"> zeigt die
    // Form des Browsers („03:00 AM“), unabhängig von der Sprache der Seite.
    const schedInput = (k) => {
      const sc = schedules?.[k];
      if (!sc) return `<span class="mon-leise">${t('monitor.sched.keiner')}</span>`;
      if (sc.type === 'daily') {
        return `<label class="mon-plan">${t('monitor.sched.taeglich')} <input type="text" inputmode="numeric" maxlength="5" placeholder="HH:MM" class="job-sched-input mon-zeit" value="${esc(sc.time)}" aria-label="${t('monitor.sched.daily_hint')}" data-change="saveJobTime" data-arg="${esc(k)}"></label>`;
      }
      if (sc.type === 'interval') {
        return `<label class="mon-plan">${t('monitor.sched.alle')} <input inputmode="numeric" type="number" min="5" class="job-sched-input mon-minuten" aria-label="${t('monitor.sched.interval_hint')}" value="${esc(sc.minutes)}" data-change="saveJobMinutes" data-arg="${esc(k)}"> ${t('monitor.sched.min')}</label>`;
      }
      return '';
    };
    const jobIconSvg = (k) => {
      const svgs = {
        // CSV-Import (Rebrickable): kleine Tabelle/Raster mit farbigen Zeilen
        csvImport: '<rect x="12" y="20" width="96" height="18" rx="2" fill="#0055BF"/><rect x="12" y="44" width="96" height="18" rx="2" fill="#F2CD37"/><rect x="12" y="68" width="96" height="18" rx="2" fill="#E63329"/><rect x="12" y="92" width="96" height="18" rx="2" fill="#9BA19D"/>',
        // BrickLink IDs nachladen: zwei verbundene Ringe (Verknüpfung/Mapping)
        blIds: '<path d="M40,45 a20,20 0 1,0 0.1,0" fill="none" stroke="#0055BF" stroke-width="12"/><path d="M80,75 a20,20 0 1,0 0.1,0" fill="none" stroke="#E63329" stroke-width="12"/>',
        // Anleitungen herunterladen: kleines aufgeschlagenes Buch
        instrQueue: '<path d="M60,28 C50,22 30,20 16,24 L16,92 C30,88 50,90 60,96 Z" fill="#E63329"/><path d="M60,28 C70,22 90,20 104,24 L104,92 C90,88 70,90 60,96 Z" fill="#CC2A21"/><rect x="24" y="38" width="28" height="4" rx="2" fill="#fff"/><rect x="24" y="50" width="28" height="4" rx="2" fill="#fff"/><rect x="24" y="62" width="20" height="4" rx="2" fill="#fff"/>',
        // Preise aktualisieren: Preisschild (Gold) mit Loch
        brickset: '<rect x="10" y="48" width="28" height="24" rx="3" fill="#0055BF"/><circle cx="24" cy="48" r="4.5" fill="#0055BF"/><rect x="46" y="48" width="28" height="24" rx="3" fill="#F2CD37"/><circle cx="60" cy="48" r="4.5" fill="#F2CD37"/><rect x="82" y="48" width="28" height="24" rx="3" fill="#E63329"/><circle cx="96" cy="48" r="4.5" fill="#E63329"/>',
        priceJob: '<path d="M18,60 L58,20 L100,20 Q108,20 108,28 L108,70 Q108,78 100,78 L58,100 Z" fill="#F2CD37"/><circle cx="84" cy="42" r="9" fill="#fff"/>',
        // Bild-Download: Bilderrahmen mit Berg und Sonne
        imgDl: '<rect x="10" y="20" width="100" height="80" rx="8" fill="#0055BF"/><circle cx="82" cy="44" r="10" fill="#F2CD37"/><path d="M18,92 L48,52 L70,80 L82,66 L102,92 Z" fill="#fff"/>',
        // PDF-Aufträge: Blatt mit roter Leiste
        pdfJobs: '<path d="M26,10 L76,10 L98,32 L98,110 L26,110 Z" fill="#9BA19D"/><path d="M76,10 L76,32 L98,32 Z" fill="#fff" fill-opacity=".6"/><rect x="16" y="56" width="70" height="26" rx="4" fill="#E63329"/><rect x="38" y="90" width="44" height="5" rx="2.5" fill="#fff"/>',
      };
      return svgs[k] ? `<svg class="mon-sinnbild" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${svgs[k]}</svg>` : '<span class="mon-sinnbild" aria-hidden="true"></span>';
    };
    const jobZustand = (s) => ({ running: tRaw('monitor.state.running'), done: tRaw('monitor.state.done'),
      error: tRaw('monitor.state.error') })[s] || tRaw('monitor.state.idle');
    const statusIcon = (s, j) => {
      if (s === 'running') return ico('uhr');
      if (s === 'done')    return ico('ok');
      if (s === 'error')   return ico('fehler');
      // idle: show warning if there's pending work (total > progress or sub mentions pending)
      if (s === 'idle' && j.total > 0 && j.progress < j.total) return ico('warnung');
      return ico('pause');
    };
    const bar = (v, gesamt) => {
      if (!gesamt) return '';
      const pct = Math.min(100, Math.round(v / gesamt * 100));
      return `<div class="mon-balken"><div data-breite="${pct}"></div></div>`;
    };
    const aktionen = (k, j) => [
      k === 'priceJob' ? `<button class="btn bs btn-sm" type="button" data-click="clickJobTrigger">${t('monitor.run_now')}</button>` : '',
      k === 'instrQueue' ? `<button class="btn bs btn-sm" type="button" data-click="reimportMissingInstructions" data-self="1">${t('monitor.import_missing')}</button>` : '',
      k === 'csvImport' ? `<button class="btn bs btn-sm" type="button" data-click="triggerCsvSync" data-self="1">${t('monitor.sync_now')}</button>` : '',
      k === 'imgDl' && j.canRedownload ? `<button class="btn bs btn-sm" type="button" data-click="redownloadMissingImages" data-self="1">${t('monitor.redownload_missing')}</button>` : '',
      k === 'imgDl' ? `<button class="btn bs btn-sm" type="button" data-click="queueCatalogImages" data-self="1">${t('monitor.catalog_images')}</button>` : '',
      k === 'bricksetRetry' && j.total > 0 ? `<button class="btn bs btn-sm" type="button" data-click="toggleBricksetQueue" data-self="1"><span>${t('monitor.show')}</span></button>` : '',
    ].join('');
    const name = (k, j) => t('monitor.job.' + k, {}) !== 'monitor.job.' + k ? t('monitor.job.' + k) : esc(j.label || k);
    const panel = G('brickset-queue-panel');
    const panelHTML = panel && panel.style.display !== 'none' ? panel.innerHTML : null;
    const zahl = (n) => (n || 0).toLocaleString(locale());
    const setze = (id, v) => { const e = G(id); if (e) e.textContent = v; };
    setze('mon-db-sync', dbStats.csvCache.lastSync ? fmtDatum(dbStats.csvCache.lastSync) : '–');
    setze('mon-db-teile', zahl(dbStats.csvCache.parts));
    setze('mon-db-inventar', zahl(dbStats.csvCache.inventoryParts));
    setze('mon-db-bl', `${zahl(dbStats.blMapping.mapped)} / ${zahl(dbStats.blMapping.total)}`);

    el.innerHTML = `
      <p class="mon-hinweis">${t('monitor.services_hint')}</p>
      <div class="tw"><table class="dt mon-tabelle mon-dienste">
        <thead><tr><th>${t('monitor.col.dienst')}</th><th>${t('monitor.col.zustand')}</th><th>${t('monitor.col.zeitplan')}</th><th>${t('monitor.col.zuletzt')}</th><th>${t('monitor.col.aktionen')}</th></tr></thead>
        <tbody>${Object.entries(jobs).map(([k, j]) => `<tr>
          <td><span class="mon-name">${k === 'bricksetRetry' ? jobIconSvg('brickset') : jobIconSvg(k)}${name(k, j)}</span></td>
          <td><span class="mon-zustand mon-${esc(j.status || 'idle')}">${statusIcon(j.status, j)} ${esc(jobZustand(j.status))}</span>
            ${j.sub ? `<div class="mon-leise">${translateJobSub(j.sub)}</div>` : ''}${j.total > 0 ? bar(j.progress, j.total) : ''}</td>
          <td>${schedInput(k)}</td>
          <td>${j.lastRun ? fmtDatum(j.lastRun, 'zeit') : ''}</td>
          <td><div class="mon-knoepfe">${aktionen(k, j) || '<span class="mon-leise">–</span>'}</div></td>
        </tr>`).join('')}</tbody>
      </table></div>
      ${jobs.bricksetRetry ? '<div id="brickset-queue-panel" class="mon-panel" data-stil="display:none"></div>' : ''}`;

    if (panelHTML !== null) {
      const neu = G('brickset-queue-panel');
      if (neu) {
        neu.innerHTML = panelHTML;
        neu.style.display = 'block';
        const knopf = el.querySelector('[data-click="toggleBricksetQueue"] span');
        if (knopf) knopf.textContent = tRaw('monitor.collapse');
      }
    }

    await zeigeAuftraege();

    // Refresh faster when img-dl or PDF jobs are actively running
    const anyActive = Object.values(jobs).some(j => j.status === 'running');
    const interval = anyActive ? 2000 : 5000;
    if (_monitorTimer) clearInterval(_monitorTimer);
    _monitorTimer = setInterval(render, interval);
  };
  await render();
}

/** Namen der Auftragsarten und Status — ausgeschrieben, damit jeder Schlüssel prüfbar im Wörterbuch steht. */
const ARTNAMEN = {
  nacharbeit: () => t('monitor.art.nacharbeit'),
  bilder: () => t('monitor.art.bilder'),
  pdf: () => t('monitor.art.pdf'),
  csv_import: () => t('monitor.art.csv_import'),
  wechselkurse: () => t('monitor.art.wechselkurse'),
  anleitung: () => t('monitor.art.anleitung'),
  brickset: () => t('monitor.art.brickset'),
  bildbedarf: () => t('monitor.art.bildbedarf'),
  bilder_neu_laden: () => t('monitor.art.bilder_neu_laden'),
  nachlauf: () => t('monitor.art.nachlauf'),
  csv_sync: () => t('monitor.art.csv_sync'),
  preise: () => t('monitor.art.preise'),
  bild_nachlauf: () => t('monitor.art.bild_nachlauf'),
  aufraeumen: () => t('monitor.art.aufraeumen'),
  aufraeumen_taeglich: () => t('monitor.art.aufraeumen_taeglich'),
};
const STATUSNAMEN = {
  offen: () => t('monitor.auftraege.offen'),
  laeuft: () => t('monitor.auftraege.laeuft'),
  fehler: () => t('monitor.auftraege.fehler'),
  abgebrochen: () => t('monitor.auftraege.abgebrochen'),
};
/** Der Name einer Auftragsart in der Oberflächensprache, fertig maskiert; unbekannte bleiben, wie sie sind. */
const artName = (art) => (Object.hasOwn(ARTNAMEN, art) ? ARTNAMEN[art]() : esc(art));

/**
 * Die Karte „Hintergrundarbeiten“: die Auftragstabelle des Servers
 * (GET /api/v1/admin/auftraege) — je Art die Zahlen mit „Jetzt“ und
 * „Leeren“, darunter laufende, wartende und gescheiterte Aufträge.
 */
/**
 * Eine Fehlermeldung des Servers in einem Satz, den man ohne Netzwerkwissen
 * versteht; der Originaltext bleibt aufklappbar, er ist für die Fehlersuche da.
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

function fehlerKasten(text) {
  return `<details class="fehler-kasten"><summary>${ico('warnung')} ${esc(fehlerKurz(text))}</summary><code>${esc(text)}</code></details>`;
}

async function zeigeAuftraege() {
  const el = G('auftraege-karte');
  if (!el) return;
  const d = await api('GET', '/v1/admin/auftraege').catch(() => null);
  if (!d?.success) { el.innerHTML = ''; return; }
  const zahl = {};
  for (const z of d.zusammenfassung) (zahl[z.art] ||= {})[z.status] = z.anzahl;
  // Der nächste Lauf je Art: der früheste wartende Auftrag dieser Art.
  const naechster = {};
  for (const a of d.auftraege)
    if (a.status === 'offen' && a.faellig_ab && (!naechster[a.art] || a.faellig_ab < naechster[a.art])) naechster[a.art] = a.faellig_ab;
  // Sieben gleiche „Jetzt starten“ sind für Vorleser ununterscheidbar: Der Name nennt die Art mit.
  const knopf = (aktion, arg, text, wofuer = '') =>
    `<button class="btn bs btn-sm" type="button" data-click="${aktion}"${echt()} data-arg="${esc(arg)}"${wofuer ? ` aria-label="${text}: ${wofuer}"` : ''}>${text}</button>`;
  const arten = Object.keys(zahl).sort((a, b) => artName(a).localeCompare(artName(b), locale()));
  const status = (s) => Object.hasOwn(STATUSNAMEN, s) ? STATUSNAMEN[s]() : esc(s);
  const ziffer = (n, klasse = '') => `<span class="mon-ziffer${n ? ' ' + klasse : ' null'}">${n || 0}</span>`;
  const zeile = (a) => {
    const zeit = fmtDatum(a.status === 'laeuft' ? a.gestartet : a.faellig_ab, 'zeit');
    const wann = a.status === 'offen' ? t(a.geplant ? 'monitor.auftraege.geplant' : 'monitor.auftraege.faellig', { zeit }) : (a.status === 'laeuft' ? zeit : '');
    const stand = a.fortschritt?.gesamt ? `${a.fortschritt.erledigt ?? 0} / ${a.fortschritt.gesamt}` : (a.fortschritt?.text || '');
    const hinweis = [a.fehler && a.status !== 'laeuft' ? fehlerKasten(a.fehler) : '',
      a.versuche > 1 ? `<span class="mon-leise">${t('monitor.auftraege.versuch', { n: a.versuche, max: a.max_versuche })}</span>` : '',
      stand ? `<span class="mon-leise">${esc(stand)}</span>` : ''].filter(Boolean).join(' ');
    const aktion = a.status === 'offen' || a.status === 'laeuft' ? knopf('auftragAbbrechen', a.id, t('monitor.auftraege.abbrechen'))
      : a.status === 'fehler' || a.status === 'abgebrochen' ? knopf('auftragWiederholen', a.id, t('monitor.auftraege.wiederholen')) : '';
    return `<tr>
      <td><strong>${artName(a.art)}</strong>${a.set_number ? ` <span class="mon-leise">${esc(a.set_number)}</span>` : ''}</td>
      <td><span class="mon-zustand mon-${esc(a.status)}">${status(a.status)}</span></td>
      <td>${wann}</td>
      <td>${hinweis}</td>
      <td><div class="mon-knoepfe">${aktion}</div></td>
    </tr>`;
  };
  const mehr = d.auftraege.length - 40;
  const pause = (p) => t('monitor.auftraege.pause', { art: Object.hasOwn(ARTNAMEN, p.art) ? ARTNAMEN[p.art]() : esc(p.art), bis: fmtDatum(p.bis, 'zeit'), grund: p.grund || '' });
  el.innerHTML = `
    <h2 class="mon-titel" id="mon-t-auftraege">${ico('liste')}<span>${t('monitor.auftraege.titel')}</span></h2>
    <p class="mon-hinweis">${t('monitor.auftraege.hinweis')}</p>
    ${d.job_prozess.laeuft ? '' : `<p class="mon-warnung">${ico('warnung')} ${t('monitor.auftraege.kein_prozess')}</p>`}
    ${d.pausen.map(p => `<p class="mon-leise">${ico('pause')} ${pause(p)}</p>`).join('')}
    ${d.bildbedarf ? `<p class="mon-leise">${t('monitor.auftraege.bildbedarf', { n: d.bildbedarf })}</p>` : ''}
    ${arten.length ? `<div class="tw"><table class="dt mon-tabelle mon-arten">
      <thead><tr><th>${t('monitor.col.art')}</th><th class="zahl">${t('monitor.col.offen')}</th><th class="zahl">${t('monitor.col.laeuft')}</th><th class="zahl">${t('monitor.col.fehler')}</th><th>${t('monitor.col.naechster')}</th><th>${t('monitor.col.aktionen')}</th></tr></thead>
      <tbody>${arten.map(art => `<tr>
        <td>${artName(art)}</td>
        <td class="zahl">${ziffer(zahl[art].offen)}</td>
        <td class="zahl">${ziffer(zahl[art].laeuft, 'mon-laeuft')}</td>
        <td class="zahl">${ziffer(zahl[art].fehler, 'mon-fehler')}</td>
        <td>${naechster[art] ? fmtDatum(naechster[art], 'zeit') : ''}</td>
        <td><div class="mon-knoepfe">${knopf('auftragsArtJetzt', art, t('monitor.auftraege.jetzt'), artName(art))}${zahl[art].offen ? knopf('auftragsArtLeeren', art, t('monitor.auftraege.leeren'), artName(art)) : ''}</div></td>
      </tr>`).join('')}</tbody></table></div>` : ''}
    ${d.auftraege.length ? `<details class="mon-einzeln"${einzelnOffen() ? ' open' : ''}>
      <summary class="mon-untertitel">${t('monitor.auftraege.einzeln')} <span class="mon-leise">(${d.auftraege.length})</span></summary>
      <div class="tw"><table class="dt mon-tabelle">
      <thead><tr><th>${t('monitor.col.auftrag')}</th><th>${t('monitor.col.zustand')}</th><th>${t('monitor.col.zeit')}</th><th>${t('monitor.col.hinweis')}</th><th>${t('monitor.col.aktionen')}</th></tr></thead>
      <tbody>${d.auftraege.slice(0, 40).map(zeile).join('')}</tbody></table></div>
      ${mehr > 0 ? `<p class="mon-leise">${t('monitor.auftraege.mehr', { n: mehr })}</p>` : ''}</details>`
      : `<h3 class="mon-untertitel">${t('monitor.auftraege.einzeln')}</h3><p class="mon-leise">${t('monitor.auftraege.leer')}</p>`}`;
}

/** Die Liste der einzelnen Aufträge ist am Telefon zu, sonst offen; ein Klick
 * gilt bis zum Neuladen, auch über das Nachzeichnen alle paar Sekunden. */
let _einzelnOffen = null;
const einzelnOffen = () => _einzelnOffen ?? !(typeof matchMedia === 'function' && matchMedia('(max-width: 640px)').matches);
if (typeof document !== 'undefined') document.addEventListener('toggle', (ev) => {
  const d = ev.target;
  if (d instanceof HTMLDetailsElement && d.classList.contains('mon-einzeln')) _einzelnOffen = d.open;
}, true);

async function auftragAbbrechen(id) {
  const d = await api('POST', `/v1/admin/auftraege/${encodeURIComponent(id)}/abbrechen`).catch(() => null);
  if (!d?.success) toast(d?.error || t('settings.error'), 'error');
  await zeigeAuftraege();
}

async function auftragWiederholen(id) {
  const d = await api('POST', `/v1/admin/auftraege/${encodeURIComponent(id)}/wiederholen`).catch(() => null);
  if (!d?.success) toast(d?.error || t('settings.error'), 'error');
  await zeigeAuftraege();
}

async function auftragsArtJetzt(art) {
  const d = await api('POST', `/v1/admin/auftraege/art/${encodeURIComponent(art)}/jetzt`).catch(() => null);
  if (!d?.success) toast(d?.error || t('settings.error'), 'error');
  await zeigeAuftraege();
}

async function auftragsArtLeeren(art) {
  const d = await api('DELETE', `/v1/admin/auftraege/art/${encodeURIComponent(art)}`).catch(() => null);
  if (d?.success) toast(tRaw('monitor.auftraege.geleert', { n: d.entfernt }), 'success');
  else toast(d?.error || t('settings.error'), 'error');
  await zeigeAuftraege();
}

/**
 * Setter für _monitorTimer — importierte Bindungen sind in ES-Modulen schreibgeschützt.
 * Ersetzt die frühere direkte Zuweisung aus einer anderen Datei, die mit
 * globalen Variablen noch möglich war.
 * @param {any} v
 */
export function set_monitorTimer(v) { _monitorTimer = v; }

// ── Handler beim Dispatcher anmelden (siehe js/00-registry.js) ──────────────
// Der Handler gehört zu dem Modul, das ihn umsetzt.
registerActions({
  openLogViewer, auftragAbbrechen, auftragWiederholen, auftragsArtJetzt, auftragsArtLeeren,
});
