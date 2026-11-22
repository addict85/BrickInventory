import { registerActions } from './registry.js';
import { tRaw } from '../i18n.js';
import { api } from './api.js';
import { G } from './dom.js';
import { fmtN } from './format.js';
import { toast } from './messages.js';
import { gutscheine, ladeGutscheine } from './vouchers.js';

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
    if (status) status.textContent = tRaw('vouchers.balance_wait', { sek: rest, nummer: number });
    await _wait(1000);
  }
}

/**
 * Query one card — without pacing, without reloading.
 *
 * Returns what the caller needs to know: whether it worked, and if not, whether it was the rate limit
 * (worth waiting for) or bot protection (then it STOPS — asking again is exactly what must not happen).
 * @param {number | string} id
 * @returns {Promise<{ art: 'ok', antwort: import('../../frontend-types/contract').GuthabenAntwort } | { art: 'abstand', wartenSek: number } | { art: 'botschutz' | 'fehler', fehler: string }>}
 */
async function oneQuery(id) {
  const d = await api('POST', `/v1/vouchers/${id}/guthaben`);
  if (d?.success) return { art: 'ok', antwort: d };
  if (d?.grund === 'abstand' && Number(d.wartenSek) > 0) {
    return { art: 'abstand', wartenSek: Number(d.wartenSek) };
  }
  if (d?.grund === 'botschutz' || d?.grund === 'konto') {
    return { art: 'botschutz', fehler: d.error || tRaw('settings.error') };
  }
  return { art: 'fehler', fehler: d?.error || tRaw('settings.error') };
}

/** What a successful query tells the user. */
/** @param {import('../../frontend-types/contract').GuthabenAntwort} response */
function reportSuccess(response) {
  const v = response.voucher;
  if (!v) return;
  toast(
    tRaw('vouchers.balance_done', {
      nummer: v.number,
      betrag: response.angezeigt || fmtN(v.amount, v.currency),
    }),
    'success',
  );
  // A silently changed currency would be a changed total with no hint — the list only sums up when
  // every voucher carries the same one.
  if (response.waehrung_geaendert) {
    toast(tRaw('vouchers.balance_currency', { waehrung: v.currency }), 'info');
  }
}

/** One card, on demand, in its row. */
/** @param {string} id */
export async function guthabenAbfragen(id) {
  const status = G('vouchers-balance-status');
  const g = gutscheine().find(x => String(x.id) === String(id));
  if (status) status.textContent = tRaw('vouchers.balance_running');
  for (let attempt = 1; ; attempt++) {
    const r = await oneQuery(id);
    if (r.art === 'ok') {
      if (status) status.textContent = '';
      reportSuccess(r.antwort);
      await ladeGutscheine();
      return;
    }
    if (r.art === 'abstand' && attempt < RETRY_LIMIT) {
      await waitVisibly(r.wartenSek, g ? g.number : '');
      continue;
    }
    if (status) status.textContent = '';
    // The rate limit also becomes an error message here: after four attempts, saying "it's busy" is
    // more honest than waiting further.
    toast(('fehler' in r && r.fehler) || tRaw('settings.error'), 'error');
    return;
  }
}

/** Every card with a PIN, one after another. */
export async function guthabenAlleAbfragen() {
  const status = G('vouchers-balance-status');
  const pending = gutscheine().filter(g => g.pin);
  if (!pending.length) {
    toast(tRaw('vouchers.balance_keine'), 'info');
    return;
  }
  let done = 0,
    failed = 0;
  for (const g of pending) {
    let settled = false;
    for (let attempt = 1; !settled && attempt <= RETRY_LIMIT; attempt++) {
      if (status) {
        status.textContent = tRaw('vouchers.balance_progress', {
          n: done + failed + 1,
          total: pending.length,
          nummer: g.number,
        });
      }
      const r = await oneQuery(g.id);
      if (r.art === 'ok') {
        done++;
        reportSuccess(r.antwort);
        settled = true;
        break;
      }
      if (r.art === 'abstand') {
        await waitVisibly(r.wartenSek, g.number);
        continue;
      }
      failed++;
      toast(r.fehler, 'error');
      settled = true;
      // Bot protection: this is where it STOPS, not just skips this card. The remaining cards would hit
      // the same wall, and Marco's rule is that "no more requests get generated" in that case.
      if (r.art === 'botschutz') {
        if (status) status.textContent = '';
        await ladeGutscheine();
        return;
      }
    }
    if (!settled) {
      failed++;
      toast(tRaw('vouchers.balance_belegt'), 'error');
    }
  }
  if (status) status.textContent = '';
  toast(tRaw('vouchers.balance_alle_fertig', { fertig: done, fehler: failed }), failed ? 'info' : 'success');
  await ladeGutscheine();
}

// ── Register handlers with the dispatcher (see js/registry.js) ──────────────
registerActions({
  guthabenAbfragen,
  guthabenAlleAbfragen,
});
