// The startup box in front of the app: server startup progress and whether the session is still valid. Both
// show their reason in the same box above the startup scaffold.
import { t, tRaw } from '../i18n.js';
import { apiRaw } from './api.js';
import { G } from './dom.js';

/** The static startup scaffold from index.html gives way once login, app or startup progress show up. */
export function removeStartupScaffold() {
  G('start-skeleton')?.remove();
}

export async function waitForStartup() {
  const ss = G('startup-screen');
  // No hard overall timeout: downloading/importing the Rebrickable CSVs on a fresh install can take many
  // minutes. Instead only give up once progress has not changed at all for a while (server stuck) — as long
  // as progress keeps being reported, waiting continues.
  const STALL_TIMEOUT = 180000; // 3 min without any status change → give up
  let lastChangeAt = Date.now();
  let lastSig = '';
  // If the server does not answer at all, only the grey scaffold used to sit there, indefinitely. After six
  // seconds the page now says so and offers an immediate retry; the poll keeps running regardless.
  let errorSince = 0;
  /** @type {() => void} */
  let retryNow = () => {};
  const button = G('start-again');
  if (button) button.onclick = () => retryNow();
  while (true) {
    try {
      const r = await apiRaw('GET', '/v2/startup-status?_=' + Date.now(), {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const s = await r.json();
      errorSince = 0;
      showOffline(false);
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
      // Detect progress: once step, percent or sub-status change, startup counts as active and the stall
      // timer resets.
      const sig = `${s.step}|${s.progress}|${s.total}|${s.sub || ''}`;
      if (sig !== lastSig) {
        lastSig = sig;
        lastChangeAt = Date.now();
      }
      if (s.ready) break;
      // Only show progress once the server is actually still starting up.
      if (ss && ss.style.display !== 'flex') {
        removeStartupScaffold();
        ss.style.display = 'flex';
      }
      if (Date.now() - lastChangeAt > STALL_TIMEOUT) {
        console.warn('[startup] stalled — no progress');
        break;
      }
    } catch (e) {
      console.warn('[startup] poll error:', e instanceof Error ? e.message : e);
      errorSince ||= Date.now();
      if (Date.now() - errorSince >= 6000) showOffline(true);
    }
    await new Promise(r => {
      retryNow = () => r(undefined);
      setTimeout(r, errorSince ? 2000 : 600);
    });
  }
  showOffline(false);
  if (ss) ss.style.display = 'none';
}
/**
 * Box above the startup scaffold. Without texts the default "server unreachable"; startup progress and the
 * unresolved session share the box, so each caller sets its own texts.
 * @param {boolean} on @param {{ title?: string, text?: string }} [o]
 */
export function showOffline(on, o = {}) {
  const el = G('start-offline');
  if (!el) return;
  if (on) {
    G('start-offline-title').textContent = o.title || tRaw('startup.offline_title');
    G('start-offline-text').textContent = o.text || tRaw('startup.offline_text');
  }
  if (el.hidden === on) el.hidden = !on;
}

/** The session check, with Retry-After: api() does not pass the response headers through.
 * @returns {Promise<{ d: import('../../frontend-types/api').ApiResponse<'GET', '/v2/auth/me'>, waitSec: number }>} */
export async function checkSession() {
  try {
    const r = await apiRaw('GET', '/v2/auth/me', { cache: 'no-store' });
    let d = null;
    try {
      d = await r.json();
    } catch (_) {
      console.warn('[auth/me] response is not JSON (status ' + r.status + ')');
    }
    const error = r.ok ? '' : tRaw('api.server_error', { status: r.status });
    return { d: { error, ...d, status: r.status }, waitSec: Number(r.headers.get('Retry-After')) || 0 };
  } catch (_) {
    return { d: { success: false, error: tRaw('api.unreachable'), networkError: true, status: 0 }, waitSec: 0 };
  }
}

/** @type {ReturnType<typeof setInterval> | undefined} */
let _sessionTimer;
/**
 * Startup scaffold with reason and "retry", while it's still open whether the session is valid. Throttled,
 * the next attempt waits out the server's deadline: an earlier version only counted again against the budget.
 * @param {{ error?: unknown, status?: number }} d @param {number} waitSec @param {() => unknown} retry
 */
export function sessionUnresolved(d, waitSec, retry) {
  clearInterval(_sessionTimer);
  const reason = String(d.error || tRaw('api.unexpected'));
  let remaining = d.status === 429 ? Math.max(5, waitSec || 60) : 15;
  // Throttled, the server's message names minutes while the box counts seconds: two time statements for
  // the same wait. Then only the counter shows, under a title that names the reason.
  const throttled = d.status === 429;
  const render = () =>
    showOffline(true, {
      title: tRaw(throttled ? 'startup.throttled_title' : 'startup.session_open'),
      text: throttled
        ? tRaw('startup.throttled_text', { sek: remaining })
        : `${reason}${/[.!?]$/.test(reason) ? '' : '.'} ${tRaw('startup.next_attempt', { sek: remaining })}`,
    });
  const retryAgain = () => {
    clearInterval(_sessionTimer);
    retry();
  };
  render();
  G('start-again').onclick = retryAgain;
  _sessionTimer = setInterval(() => {
    if (--remaining <= 0) retryAgain();
    else render();
  }, 1000);
}
