// Building blocks for views (detail row, loading indicator, empty and error state) in one place: what should look
// the same everywhere used to be its own HTML string fifteen times in four modules.
import { api } from './api.js';
import { ico, G, setHtml } from './dom.js';
import { fmtBig, fmtPct, isGift } from './format.js';
import { toast } from './messages.js';
import { tRaw } from '../i18n.js';
import { registerActions, resolveAction } from './registry.js';
import { esc, html, rawHtml } from './escaping.js';
import { loggedInAccount, accountCurrency } from './state.js';

/**
 * A row "label — value" in a detail view.
 *
 * @param {string | import('./escaping.js').SafeHtml} label     Label on the left. NOT escaped: all
 *                           callers pass a translation t(...) here, and
 *                           that is already safe. Escaping here would destroy the
 *                           special characters of the translations.
 * @param {import('./escaping.js').Markup | string} value      Content on the right. NOT escaped — many
 *                           callers deliberately pass markup (input
 *                           fields, color dots, buttons). Whoever inserts user text
 *                           escapes it themselves with esc().
 * @param {object} [o]
 * @param {string} [o.valueStyle]  additional style (data-style) on the value element
 * @param {string} [o.rowsStyle] additional style (data-style) on the row
 * @param {string} [o.valueId]    id on the value element, for filling it later
 * @param {string} [o.class]    additional class on the row
 * @param {boolean} [o.pair]     as dt/dd, for rows in a <dl>: screen readers announce name and value as a pair
 */
export function detailRow(label, value, o = {}) {
  const zStyle = o.rowsStyle ? ` data-style="${o.rowsStyle}"` : '';
  const zClass = o.class ? ` ${o.class}` : '';
  const wStyle = o.valueStyle ? ` data-style="${o.valueStyle}"` : '';
  const wId = o.valueId ? ` id="${o.valueId}"` : '';
  const [l, i, s] = [rawHtml(label), rawHtml(wId), rawHtml(wStyle)];
  const v = typeof value === 'string' ? rawHtml(value) : value;
  const pair = o.pair
    ? html`<dt class="dl">${l}</dt><dd class="dv"${i}${s}>${v}</dd>`
    : html`<span class="dl">${l}</span><span class="dv"${i}${s}>${v}</span>`;
  return html`<div class="dr${zClass}"${rawHtml(zStyle)}>${pair}</div>`;
}

/**
 * The loading indicator — spinner and text, as five places built it.
 *
 * @param {string} text already translated text
 * @param {{ style?: string, small?: boolean }} [o]  small: an area, e.g. for the chart
 */
export function loadDisplay(text, o = {}) {
  const style = o.style ? ` data-style="${o.style}"` : '';
  // Without text only the spinner — that is how the parts summary does it, where it already says next to it what is
  // being waited for.
  const content = o.small
    ? '<div class="skeleton-surface"></div>'
    : '<div class="skeleton-row"></div><div class="skeleton-row"></div><div class="skeleton-row short"></div>';
  return html`${html`<div class="load-skeleton${o.small ? ' small' : ''}" role="status" aria-busy="true"${rawHtml(style)}>`}${html`<span class="vh">${text ? rawHtml(text) : tRaw('common.loading')}</span>${rawHtml(content)}</div>`}`;
}

/**
 * Placeholder tiles in the shape of the content while it loads: the page does not jump afterwards, and one sees
 * what is coming. The text is for screen readers.
 * @param {number} count
 * @param {string} text already translated
 * @param {'set'|'teil'} [kind]
 */
export function skeletonTiles(count, text, kind = 'set') {
  const grid = kind === 'teil' ? 'parts-grid' : 'sgrid';
  const tile = html`<div class="${kind === 'teil' ? 'part-card' : 'sc'} skeleton" aria-hidden="true"><div class="skeleton-image"></div><div class="skeleton-row"></div><div class="skeleton-row short"></div></div>`;
  return html`<div class="${grid} skeleton-grid" role="status" aria-busy="true"><span class="vh">${rawHtml(text)}</span>${Array.from({ length: count }, () => tile)}</div>`;
}

/**
 * Placeholder rows for lists and detail views (wishlist, set detail), like skeletonTiles for grids.
 * @param {number} count
 * @param {string} text already translated
 */
export function skeletonRows(count, text) {
  const row =
    '<div class="skeleton-list-row" aria-hidden="true"><div class="skeleton-image"></div><div><div class="skeleton-row"></div><div class="skeleton-row short"></div></div></div>';
  return html`<div class="skeleton-list" role="status" aria-busy="true"><span class="vh">${rawHtml(text)}</span>${rawHtml(row.repeat(count))}</div>`;
}

/**
 * A value that may be missing — otherwise an empty field stands in the row.
 *
 * The callers wrote `${x || '—'}` or `${x ?? '–'}` for this, with two different dashes. Here it is
 * one.
 * @param {unknown} value
 */
export function orStroke(value) {
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

/**
 * Like [orStroke], but the value comes from the user and is escaped.
 * @param {string} value
 */
export function textOrStroke(value) {
  return value === null || value === undefined || value === '' ? '—' : esc(String(value));
}

/**
 * Error state of a list: reason and "try again". An empty list at this place would read as
 * "nothing captured", although only the server did not answer.
 * @param {{ grund?: string, again: string, arg?: string, title?: string, details?: string }} o  again: name of the load function (data-click)
 */
export function errorState(o) {
  const arg = o.arg ? ` data-arg="${esc(o.arg)}"` : '';
  const details = o.details
    ? html`<details class="error-details"><summary>${tRaw('list.details')}</summary><code>${o.details}</code></details>`
    : '';
  return html`${html`<div class="empty empty-state error-state" role="alert"><div class="empty-ico">${ico('warning')}</div>`}${html`<h2>${o.title || tRaw('list.error_title')}</h2><p>${o.grund || tRaw('common.unknown_error')}</p>${details}`}${html`<button type="button" class="btn bp" data-reading data-click="${o.again}"${rawHtml(arg)}>${ico('refresh')}<span>${tRaw('list.again')}</span></button></div>`}`;
}

/**
 * Did loading a list fail? Then a list already shown stays (with a message), otherwise
 * `target` shows the error state.
 * @param {HTMLElement|null} target
 * @template D
 * @param {D} d          response of api() — null counts as an error
 * @param {{ again: string, arg?: string, keep?: boolean, title?: string }} o
 * @returns {d is Extract<D, { success: false }>} true if it was an error and the caller should stop
 */
export function listLoadError(target, d, o) {
  const a =
    /** @type {{ success?: unknown, status?: number, error?: unknown, networkError?: boolean, waitSec?: unknown } | null | undefined} */ (
      d
    );
  if (a && a.success !== false) return false;
  // The expired session is reported by the login card; "try again" would not help there.
  if (a?.status === 401) return true;
  const { grund: reason, details } = clearerReason(a);
  const again = () => {
    const f = resolveAction(o.again);
    if (f) o.arg !== undefined ? f(o.arg) : f();
  };
  // "The last state stays" only if there is one: above an error state the toast would contradict the list.
  const alterStatus = o.keep && !target?.querySelector('.error-state, .load-skeleton, .skeleton-grid');
  const throttled = a?.status === 429;
  if (alterStatus)
    toast(
      throttled ? reason : tRaw('list.alter_status_short'),
      'error',
      { text: tRaw('list.again'), fn: again },
      throttled ? undefined : [reason, details].filter(Boolean).join(' — '),
    );
  else if (target) setHtml(target, errorState({ grund: reason, details, again: o.again, arg: o.arg, title: o.title }));
  return true;
}

/**
 * A server error (5xx) tells a layperson nothing. What is shown is what they can do; the raw text is under
 * "details" for the report to the admin. The admin themselves gets the way to the log. 4xx texts
 * are written understandably by the server itself.
 * @param {{ networkError?: boolean, status?: number, error?: unknown, waitSec?: unknown } | null | undefined} d response of api()
 * @returns {{ grund: string, details?: string }}
 */
export function clearerReason(d) {
  if (d?.networkError) return { grund: tRaw('net.list_offline') };
  if (d?.status === 429)
    return { grund: tRaw('list.throttled', { minuten: Math.max(1, Math.ceil((Number(d.waitSec) || 60) / 60)) }) };
  if (!d || (d.status ?? 0) >= 500 || !d.error)
    return {
      grund: tRaw(loggedInAccount?.isAdmin ? 'list.server_error_admin' : 'list.server_error'),
      details: d?.error ? String(d.error) : undefined,
    };
  return { grund: String(d.error) };
}

/**
 * "144 from sets · 250 individually" — empty as long as only one of the two sources has something.
 * @param {number} fromSets
 * @param {number} single
 */
export function partsBreakdown(fromSets, single) {
  if (!fromSets || !single) return '';
  return tRaw('parts.stat.breakdown', { sets: fmtBig(fromSets), single: fmtBig(single) });
}

/**
 * The keyboard path of a clickable table row: a real button in a cell. The row itself stays
 * clickable for the mouse but no longer takes focus; a focusable <tr> told screen readers neither
 * role nor target.
 * @param {{ click: string, arg?: string | number, arg2?: string | number, arg3?: string | number }} target
 * @param {import('./escaping.js').Markup | string} visible  content of the cell
 * @param {string} name  name of the button; contains the visible text
 * Content in a <span>: in the flex button the space in "Brick 2 x 4 (Black)" would otherwise disappear.
 */
export function rowsButton(target, visible, name) {
  return html`<button type="button" class="row-open" data-click="${target.click}"${target.arg !== undefined ? html` data-arg="${target.arg}"` : ''}${target.arg2 !== undefined ? html` data-arg2="${target.arg2}"` : ''}${target.arg3 !== undefined ? html` data-arg3="${target.arg3}"` : ''} aria-label="${name}"><span>${visible}</span></button>`;
}

let _tileNr = 0;
/** A tile's name only from number and name, the rest as description: an aria-label missed "label in
 * name". @param {number} [parts] describing elements; `k.teil(i)` gives id and aria-hidden */
export function tileName(parts = 1) {
  const id = `tile-${++_tileNr}`;
  const ids = Array.from({ length: parts }, (_, i) => `${id}-${i + 1}`);
  return {
    attr: html` aria-describedby="${ids.join(' ')}"`,
    teil: (/** @type {number} */ i) => html` id="${ids[i]}" aria-hidden="true"`,
  };
}

/** "≈" before a purchase price that is an inserted market price; otherwise it would read as paid.
 * @param {string | import('./escaping.js').SafeHtml} markup already escaped markup */
export function estimatedPurchase(markup) {
  const hint = tRaw('acq.estimated');
  return html`<span class="purchase-estimated" title="${hint}"><span role="img" aria-label="${hint}">≈</span> ${rawHtml(String(markup))}</span>`;
}

/**
 * P&L badge. For a purchase price of 0 "gift" instead of a percentage: computed against 0 it would say "+327,600
 * %", and that says nothing.
 * @param {number | string | null | undefined} pct
 * @param {unknown} [purchase]
 */
export function pnlBadge(pct, purchase) {
  if (isGift(purchase)) return html`<span class="pnl-gift">${tRaw('finance.gift')}</span>`;
  if (pct === null || pct === undefined) return '';
  const v = parseFloat(String(pct));
  const cls = v > 0 ? 'pnl-pos' : v < 0 ? 'pnl-neg' : 'pnl-new';
  return html`<span class="${cls}">${fmtPct(v)}</span>`;
}

/**
 * An account, named the same everywhere: the name, for the own one with "(me)". Set detail, tiles, finances and
 * wishlist otherwise called the same account "me", "ux22" and "ux22 (me)".
 * @param {{ id: number, username: string }} o
 */
export function accountDisplay(o) {
  return loggedInAccount && o.id === loggedInAccount.id ? `${o.username} ${tRaw('household.ich')}` : o.username;
}

/**
 * Owner badges only if ANOTHER account is involved: in the household they prevent moving the
 * wrong copy; the own name on every tile would only be noise.
 * @param {{ owners?: { id: number, username: string }[] } | null | undefined} item
 */
export function ownerBadges(item) {
  if (!item?.owners?.length) return '';
  if (item.owners.every(o => loggedInAccount && o.id === loggedInAccount.id)) return '';
  return html`${item.owners.map(o => html`<span class="cond-badge owner-badge" title="${accountDisplay(o)}">${accountDisplay(o)}</span>`)}`;
}

/**
 * One badge per captured condition, from `conditions` from the server: the aggregate `condition` showed only
 * "used" for new and used, and the new acquisition was invisible although it is valued too.
 * @param {{ conditions?: string[] | null, condition?: string | null } | null | undefined} item
 */
export function condBadges(item) {
  const list =
    Array.isArray(item?.conditions) && item.conditions.length ? item.conditions : [item?.condition === 'U' ? 'U' : 'N'];
  return html`${list.map((/** @type {string} */ c) =>
    c === 'U'
      ? html`<span class="cond-badge cond-used"><span class="vh">${tRaw('common.condition')}: </span>${tRaw('common.condition_used')}</span>`
      : html`<span class="cond-badge cond-new"><span class="vh">${tRaw('common.condition')}: </span>${tRaw('common.condition_badge_new')}</span>`,
  )}`;
}

/** Capture dialogs of the collection: set, part, fig — built the same way (initial focus: data-first-focus). */
// Without data-arg the dispatcher passes the event as the first argument.
const addDialog = (/** @type {unknown} */ kind) => G(`add-${typeof kind === 'string' ? kind : 'set'}-modal`);

/**
 * @param {string} [kind]
 */
export function openCapture(kind) {
  const dialog = addDialog(kind);
  // The purchase date is today and the currency that of the account, as long as nobody chooses otherwise.
  dialog?.querySelectorAll('input[data-today]').forEach(f => {
    if (f instanceof HTMLInputElement) {
      f.max = todayIso();
      if (!f.value) f.value = todayIso();
    }
  });
  const w = /** @type {HTMLSelectElement | null} */ (dialog?.querySelector('#add-currency') ?? null);
  if (w && !(/** @type {HTMLInputElement | null} */ (dialog?.querySelector('#add-price'))?.value))
    w.value = accountCurrency;
  dialog?.classList.add('open');
}

/** Today as YYYY-MM-DD in the device's calendar. */
export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * @param {string} [kind]
 */
export function closeCapture(kind) {
  const dialog = addDialog(kind);
  dialog?.classList.remove('open');
  // Closed means discarded: a price from before would otherwise silently stick to the next set someone types in.
  dialog?.querySelector('form')?.reset();
}

/**
 * Upload the chosen CSV file and report the result — one version for parts, figures, wishlist and
 * alerts. Skipped rows and additional hints are in the message everywhere, otherwise a patchy
 * import would look like a complete one.
 * @typedef {{ success: boolean, error?: string, added?: number, updated?: number, errors?: number,
 *   skipped?: number, skipped_hint?: string, [feld: string]: unknown }} CsvResult
 * @param {{ feld: string, pfad: string, fields?: Record<string, string>,
 *           show?: (laeuft: boolean) => void, hinweise?: (d: CsvResult) => unknown[] }} o
 * @returns {Promise<CsvResult | null>} the response on success, otherwise null
 */
export async function uploadCsv(o) {
  const fi = G(o.feld);
  if (!fi?.files?.[0]) return null;
  const fd = new FormData();
  fd.append('file', fi.files[0]);
  for (const [k, v] of Object.entries(o.fields ?? {})) fd.append(k, v);
  o.show?.(true);
  /** @type {CsvResult} */
  const d = await api('POST', o.pfad, fd);
  fi.value = '';
  o.show?.(false);
  if (!d.success) {
    toast(d.error || tRaw('settings.error'), 'error');
    return null;
  }
  const extra = (o.hinweise?.(d) ?? []).filter(Boolean);
  const extraText = [d.skipped_hint, ...extra].filter(Boolean).join(' — ');
  toast(
    tRaw('import.summary', { added: d.added, updated: d.updated, errors: d.errors }) +
      (extraText ? ` — ${extraText}` : ''),
    d.errors || d.skipped || extra.length ? 'info' : 'success',
  );
  return d;
}

registerActions({
  openCapture,
  closeCapture,
});
