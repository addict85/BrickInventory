import { registerActions } from './registry.js';
import { tRaw } from '../i18n.js';
import { api } from './api.js';
import { G } from './dom.js';
import { fmtN } from './format.js';
import { toast } from './messages.js';
import { vouchers, loadVouchers } from './vouchers.js';

// Query the LEGO balance on demand. The limit (one request per 30s across all users) is set by the
// server; the UI obeys it: on 429 it waits waitSek and asks the same card again. A batch route would
// otherwise hold a connection open for minutes.

/** How many times at most to retry the same card when the rate limit is braking. */
const RETRY_LIMIT = 4;

const _wait = (/** @type {number} */ ms) => new Promise(r => setTimeout(r, ms));

/**
 * Wait out a number of seconds, counting down.
 *
 * The text names the card: with "query all", otherwise there's no telling what is being waited for.
 */
/** @param {number} seconds @param {string} number */
async function waitVisibly(seconds, number) {
  const status = G('vouchers-balance-status');
  for (let rest = seconds; rest > 0; rest--) {
    if (status) status.textContent = tRaw('vouchers.balance_wait', { sek: rest, number: number });
    await _wait(1000);
  }
}

/**
 * Query one card — without pacing, without reloading.
 *
 * Returns what the caller needs to know: whether it worked, and if not, whether it was the rate limit
 * (worth waiting for) or bot protection (then it STOPS — asking again is exactly what must not happen).
 * @param {number | string} id
 * @returns {Promise<{ kind: 'ok', response: import('../../frontend-types/contract').BalanceReply } | { kind: 'space', waitSeconds: number } | { kind: 'botschutz' | 'error', error: string }>}
 */
async function oneQuery(id) {
  const d = await api('POST', `/v2/vouchers/${id}/balance`);
  if (d?.success) return { kind: 'ok', response: d };
  if (d?.reason === 'abstand' && Number(d.waitSeconds) > 0) {
    return { kind: 'space', waitSeconds: Number(d.waitSeconds) };
  }
  if (d?.reason === 'botschutz' || d?.reason === 'konto') {
    return { kind: 'botschutz', error: d.error || tRaw('settings.error') };
  }
  return { kind: 'error', error: d?.error || tRaw('settings.error') };
}

/** What a successful query tells the user. */
/** @param {import('../../frontend-types/contract').BalanceReply} response */
function reportSuccess(response) {
  const v = response.voucher;
  if (!v) return;
  toast(
    tRaw('vouchers.balance_done', {
      number: v.number,
      amount: response.displayed || fmtN(v.amount, v.currency),
    }),
    'success',
  );
  // A silently changed currency would be a changed total with no hint — the list only sums up when
  // every voucher carries the same one.
  if (response.currency_changed) {
    toast(tRaw('vouchers.balance_currency', { currency: v.currency }), 'info');
  }
}

/** One card, on demand, in its row. */
/** @param {string} id */
export async function queryBalance(id) {
  const status = G('vouchers-balance-status');
  const g = vouchers().find(x => String(x.id) === String(id));
  if (status) status.textContent = tRaw('vouchers.balance_running');
  for (let attempt = 1; ; attempt++) {
    const r = await oneQuery(id);
    if (r.kind === 'ok') {
      if (status) status.textContent = '';
      reportSuccess(r.response);
      await loadVouchers();
      return;
    }
    if (r.kind === 'space' && attempt < RETRY_LIMIT) {
      await waitVisibly(r.waitSeconds, g ? g.number : '');
      continue;
    }
    if (status) status.textContent = '';
    // The rate limit also becomes an error message here: after four attempts, saying "it's busy" is
    // more honest than waiting further.
    toast(('error' in r && r.error) || tRaw('settings.error'), 'error');
    return;
  }
}

/** One voucher, retried while the server asks for spacing. @returns {Promise<'ok' | 'failed' | 'stop'>}
 * `stop`: bot protection — this is where it STOPS, not just skips this card. The remaining cards would hit
 * the same wall, and no more requests get generated in that case.
 * @param {{ id: number, number: string }} g @param {() => void} progress */
async function queryOneBalance(g, progress) {
  for (let attempt = 1; attempt <= RETRY_LIMIT; attempt++) {
    progress();
    const r = await oneQuery(g.id);
    if (r.kind === 'ok') {
      reportSuccess(r.response);
      return 'ok';
    }
    if (r.kind === 'space') {
      await waitVisibly(r.waitSeconds, g.number);
      continue;
    }
    toast(r.error, 'error');
    return r.kind === 'botschutz' ? 'stop' : 'failed';
  }
  toast(tRaw('vouchers.balance_used'), 'error');
  return 'failed';
}

/** Every card with a PIN, one after another. */
export async function queryAllBalances() {
  const status = G('vouchers-balance-status');
  const pending = vouchers().filter(g => g.pin);
  if (!pending.length) {
    toast(tRaw('vouchers.balance_none'), 'info');
    return;
  }
  let done = 0,
    failed = 0;
  for (const g of pending) {
    const progress = () => {
      if (status)
        status.textContent = tRaw('vouchers.balance_progress', {
          n: done + failed + 1,
          total: pending.length,
          number: g.number,
        });
    };
    const r = await queryOneBalance(g, progress);
    if (r === 'ok') done++;
    else failed++;
    if (r === 'stop') {
      if (status) status.textContent = '';
      await loadVouchers();
      return;
    }
  }
  if (status) status.textContent = '';
  toast(tRaw('vouchers.balance_all_done', { done: done, error: failed }), failed ? 'info' : 'success');
  await loadVouchers();
}

// ── Register handlers with the dispatcher (see js/registry.js) ──────────────
registerActions({
  queryBalance,
  queryAllBalances,
});
