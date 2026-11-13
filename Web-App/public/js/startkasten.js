// Der Startkasten vor der Anwendung: Startfortschritt des Servers und die Frage, ob die Sitzung gilt. Beide
// zeigen ihren Grund im selben Kasten über dem Startgerüst.
import { t, tRaw } from '../i18n.js';
import { apiRoh } from './api.js';
import { G } from './dom.js';

/** Das statische Startgerüst aus index.html weicht, sobald Anmeldung, App oder Startfortschritt dastehen. */
export function startgeruestWeg() {
  G('startgeruest')?.remove();
}

export async function waitForStartup() {
  const ss = G('startup-screen');
  // Kein hartes Gesamt-Timeout mehr: Download/Import der Rebrickable-CSVs kann bei einer Neuinstallation
  // viele Minuten dauern. Stattdessen nur abbrechen, wenn sich der Fortschritt über längere Zeit gar nicht
  // mehr ändert (Server hängt) — solange Fortschritt gemeldet wird, wird weiter gewartet.
  const STALL_TIMEOUT = 180000; // 3 Min ohne jede Statusänderung → aufgeben
  let lastChangeAt = Date.now();
  let lastSig = '';
  // Antwortet der Server gar nicht, stand vorher nur das graue Gerüst da, beliebig lange. Nach sechs Sekunden
  // sagt es die Seite und bietet einen sofortigen Versuch an; der Abruf läuft ohnehin weiter.
  let fehlerSeit = 0;
  /** @type {() => void} */
  let sofort = () => {};
  const knopf = G('start-erneut');
  if (knopf) knopf.onclick = () => sofort();
  while (true) {
    try {
      const r = await apiRoh('GET', '/v1/startup-status?_=' + Date.now(), {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const s = await r.json();
      fehlerSeit = 0;
      zeigeOffline(false);
      if (!s) {
        await new Promise(r => setTimeout(r, 600));
        continue;
      }
      const pct = s.total > 0 ? Math.round((s.progress / s.total) * 100) : 0;
      const stepEl = G('startup-step');
      const barEl = G('startup-bar');
      const pctEl = G('startup-pct');
      if (stepEl) stepEl.textContent = s.step || t('startup.loading');
      if (barEl) barEl.style.width = pct + '%';
      if (pctEl) pctEl.textContent = pct + '%';
      const subVal = s.sub || '';
      const subWrap = G('startup-sub-wrap');
      const subLabel = G('startup-sub-label');
      const subBar = G('startup-sub-bar');
      const subPctEl = G('startup-sub-pct');
      const subEl = G('startup-sub');
      if (subVal && subWrap) {
        subWrap.style.display = '';
        if (subLabel) subLabel.style.display = '';
        const subPct = subVal.match(/(\d+)%/);
        if (subPct) {
          if (subBar) subBar.style.width = subPct[1] + '%';
          if (subPctEl) subPctEl.textContent = subPct[1] + '%';
          if (subEl) subEl.textContent = s.step || '';
        } else {
          if (subBar) subBar.style.width = '0%';
          if (subPctEl) subPctEl.textContent = subVal;
          if (subEl) subEl.textContent = s.step || '';
        }
      } else if (subWrap) {
        subWrap.style.display = 'none';
        if (subLabel) subLabel.style.display = 'none';
      }
      // Fortschritt erkennen: ändert sich Schritt, Prozent oder Sub-Status, gilt der Startvorgang als aktiv
      // und der Stall-Timer wird zurückgesetzt.
      const sig = `${s.step}|${s.progress}|${s.total}|${s.sub || ''}`;
      if (sig !== lastSig) {
        lastSig = sig;
        lastChangeAt = Date.now();
      }
      if (s.ready) break;
      // Den Fortschritt erst zeigen, wenn der Server wirklich noch startet.
      if (ss && ss.style.display !== 'flex') {
        startgeruestWeg();
        ss.style.display = 'flex';
      }
      if (Date.now() - lastChangeAt > STALL_TIMEOUT) {
        console.warn('[startup] stalled — no progress');
        break;
      }
    } catch (e) {
      console.warn('[startup] poll error:', e instanceof Error ? e.message : e);
      fehlerSeit ||= Date.now();
      if (Date.now() - fehlerSeit >= 6000) zeigeOffline(true);
    }
    await new Promise(r => {
      sofort = () => r(undefined);
      setTimeout(r, fehlerSeit ? 2000 : 600);
    });
  }
  zeigeOffline(false);
  if (ss) ss.style.display = 'none';
}
/**
 * Kasten über dem Startgerüst. Ohne Texte die Vorgabe „Server nicht erreichbar“; der Startfortschritt und
 * die ungeklärte Sitzung teilen sich den Kasten, also setzt jeder Aufruf seine Texte selbst.
 * @param {boolean} an @param {{ titel?: string, text?: string }} [o]
 */
export function zeigeOffline(an, o = {}) {
  const el = G('start-offline');
  if (!el) return;
  if (an) {
    G('start-offline-titel').textContent = o.titel || tRaw('startup.offline_titel');
    G('start-offline-text').textContent = o.text || tRaw('startup.offline_text');
  }
  if (el.hidden === an) el.hidden = !an;
}

/** Die Frage nach der Sitzung, mit Retry-After: api() gibt die Kopfzeilen nicht weiter.
 * @returns {Promise<{ d: import('../../frontend-typen/api').ApiAntwort<'GET', '/v1/auth/me'>, warteSek: number }>} */
export async function frageSitzung() {
  try {
    const r = await apiRoh('GET', '/v1/auth/me', { cache: 'no-store' });
    let d = null;
    try {
      d = await r.json();
    } catch (_) {
      console.warn('[auth/me] Antwort ist kein JSON (Status ' + r.status + ')');
    }
    const fehler = r.ok ? '' : tRaw('api.server_error', { status: r.status });
    return { d: { error: fehler, ...d, status: r.status }, warteSek: Number(r.headers.get('Retry-After')) || 0 };
  } catch (_) {
    return { d: { success: false, error: tRaw('api.unreachable'), networkError: true, status: 0 }, warteSek: 0 };
  }
}

/** @type {ReturnType<typeof setInterval> | undefined} */
let _sitzungUhr;
/**
 * Startgerüst mit Grund und „Erneut versuchen“, solange offen ist, ob die Sitzung gilt. Gedrosselt wartet
 * der nächste Versuch die Frist des Servers ab: Ein früherer zählte nur wieder gegen das Budget.
 * @param {{ error?: unknown, status?: number }} d @param {number} warteSek @param {() => unknown} neu
 */
export function sitzungUngeklaert(d, warteSek, neu) {
  clearInterval(_sitzungUhr);
  const grund = String(d.error || tRaw('api.unexpected'));
  let rest = d.status === 429 ? Math.max(5, warteSek || 60) : 15;
  const zeige = () =>
    zeigeOffline(true, {
      titel: tRaw('startup.sitzung_offen'),
      text: `${grund}${/[.!?]$/.test(grund) ? '' : '.'} ${tRaw('startup.naechster_versuch', { sek: rest })}`,
    });
  const nochmal = () => {
    clearInterval(_sitzungUhr);
    neu();
  };
  zeige();
  G('start-erneut').onclick = nochmal;
  _sitzungUhr = setInterval(() => {
    if (--rest <= 0) nochmal();
    else zeige();
  }, 1000);
}
