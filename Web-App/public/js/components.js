// Building blocks for views (detail row, loading indicator, empty and error state) in one place: what should look
// the same everywhere used to be its own HTML string fifteen times in four modules.
import { api } from './api.js';
import { ico, G, setzeHtml } from './dom.js';
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
 * @param {import('./escaping.js').Markup | string} wert      Content on the right. NOT escaped — many
 *                           callers deliberately pass markup (input
 *                           fields, color dots, buttons). Whoever inserts user text
 *                           escapes it themselves with esc().
 * @param {object} [o]
 * @param {string} [o.valueStyle]  additional style (data-stil) on the value element
 * @param {string} [o.rowsStyle] additional style (data-stil) on the row
 * @param {string} [o.wertId]    id on the value element, for filling it later
 * @param {string} [o.klasse]    additional class on the row
 * @param {boolean} [o.paar]     as dt/dd, for rows in a <dl>: screen readers announce name and value as a pair
 */
export function detailRow(label, wert, o = {}) {
  const zStyle = o.rowsStyle ? ` data-stil="${o.rowsStyle}"` : '';
  const zClass = o.klasse ? ` ${o.klasse}` : '';
  const wStyle = o.valueStyle ? ` data-stil="${o.valueStyle}"` : '';
  const wId = o.wertId ? ` id="${o.wertId}"` : '';
  const [l, i, s] = [rawHtml(label), rawHtml(wId), rawHtml(wStyle)];
  const v = typeof wert === 'string' ? rawHtml(wert) : wert;
  const paar = o.paar
    ? html`<dt class="dl">${l}</dt><dd class="dv"${i}${s}>${v}</dd>`
    : html`<span class="dl">${l}</span><span class="dv"${i}${s}>${v}</span>`;
  return html`<div class="dr${zClass}"${rawHtml(zStyle)}>${paar}</div>`;
}

/**
 * The loading indicator — spinner and text, as five places built it.
 *
 * @param {string} text already translated text
 * @param {{ stil?: string, klein?: boolean }} [o]  klein: an area, e.g. for the chart
 */
export function loadDisplay(text, o = {}) {
  const stil = o.stil ? ` data-stil="${o.stil}"` : '';
  // Without text only the spinner — that is how the parts summary does it, where it already says next to it what is
  // being waited for.
  const inhalt = o.klein
    ? '<div class="skelett-flaeche"></div>'
    : '<div class="skelett-zeile"></div><div class="skelett-zeile"></div><div class="skelett-zeile kurz"></div>';
  return html`${html`<div class="lade-geruest${o.klein ? ' klein' : ''}" role="status" aria-busy="true"${rawHtml(stil)}>`}${html`<span class="vh">${text ? rawHtml(text) : tRaw('common.loading')}</span>${rawHtml(inhalt)}</div>`}`;
}

/**
 * Placeholder tiles in the shape of the content while it loads: the page does not jump afterwards, and one sees
 * what is coming. The text is for screen readers.
 * @param {number} anzahl
 * @param {string} text already translated
 * @param {'set'|'teil'} [art]
 */
export function skeletonTiles(anzahl, text, art = 'set') {
  const raster = art === 'teil' ? 'parts-grid' : 'sgrid';
  const kachel = html`<div class="${art === 'teil' ? 'part-card' : 'sc'} skelett" aria-hidden="true"><div class="skelett-bild"></div><div class="skelett-zeile"></div><div class="skelett-zeile kurz"></div></div>`;
  return html`<div class="${raster} skelett-raster" role="status" aria-busy="true"><span class="vh">${rawHtml(text)}</span>${Array.from({ length: anzahl }, () => kachel)}</div>`;
}

/**
 * Placeholder rows for lists and detail views (wishlist, set detail), like skeletonTiles for grids.
 * @param {number} anzahl
 * @param {string} text already translated
 */
export function skeletonRows(anzahl, text) {
  const zeile =
    '<div class="skelett-listenzeile" aria-hidden="true"><div class="skelett-bild"></div><div><div class="skelett-zeile"></div><div class="skelett-zeile kurz"></div></div></div>';
  return html`<div class="skelett-liste" role="status" aria-busy="true"><span class="vh">${rawHtml(text)}</span>${rawHtml(zeile.repeat(anzahl))}</div>`;
}

/**
 * A value that may be missing — otherwise an empty field stands in the row.
 *
 * The callers wrote `${x || '—'}` or `${x ?? '–'}` for this, with two different dashes. Here it is
 * one.
 * @param {unknown} wert
 */
export function orStroke(wert) {
  return wert === null || wert === undefined || wert === '' ? '—' : String(wert);
}

/**
 * Like [orStroke], but the value comes from the user and is escaped.
 * @param {string} wert
 */
export function textOrStroke(wert) {
  return wert === null || wert === undefined || wert === '' ? '—' : esc(String(wert));
}

/**
 * Error state of a list: reason and "try again". An empty list at this place would read as
 * "nothing captured", although only the server did not answer.
 * @param {{ grund?: string, erneut: string, arg?: string, titel?: string, details?: string }} o  erneut: name of the load function (data-click)
 */
export function fehlerZustand(o) {
  const arg = o.arg ? ` data-arg="${esc(o.arg)}"` : '';
  const details = o.details
    ? html`<details class="fehler-details"><summary>${tRaw('liste.details')}</summary><code>${o.details}</code></details>`
    : '';
  return html`${html`<div class="empty leer fehler-zustand" role="alert"><div class="leer-ico">${ico('warnung')}</div>`}${html`<h2>${o.titel || tRaw('liste.fehler_titel')}</h2><p>${o.grund || tRaw('common.unknown_error')}</p>${details}`}${html`<button type="button" class="btn bp" data-lesend data-click="${o.erneut}"${rawHtml(arg)}>${ico('aktualisieren')}<span>${tRaw('liste.erneut')}</span></button></div>`}`;
}

/**
 * Did loading a list fail? Then a list already shown stays (with a message), otherwise
 * `ziel` shows the error state.
 * @param {HTMLElement|null} ziel
 * @template D
 * @param {D} d          response of api() — null counts as an error
 * @param {{ erneut: string, arg?: string, behalten?: boolean, titel?: string }} o
 * @returns {d is Extract<D, { success: false }>} true if it was an error and the caller should stop
 */
export function listLoadError(ziel, d, o) {
  const a =
    /** @type {{ success?: unknown, status?: number, error?: unknown, networkError?: boolean, waitSec?: unknown } | null | undefined} */ (
      d
    );
  if (a && a.success !== false) return false;
  // The expired session is reported by the login card; "try again" would not help there.
  if (a?.status === 401) return true;
  const { grund, details } = clearerReason(a);
  const nochmal = () => {
    const f = resolveAction(o.erneut);
    if (f) o.arg !== undefined ? f(o.arg) : f();
  };
  // "The last state stays" only if there is one: above an error state the toast would contradict the list.
  const alterStand = o.behalten && !ziel?.querySelector('.fehler-zustand, .lade-geruest, .skelett-raster');
  const gedrosselt = a?.status === 429;
  if (alterStand)
    toast(
      gedrosselt ? grund : tRaw('liste.alter_stand_kurz'),
      'error',
      { text: tRaw('liste.erneut'), fn: nochmal },
      gedrosselt ? undefined : [grund, details].filter(Boolean).join(' — '),
    );
  else if (ziel) setzeHtml(ziel, fehlerZustand({ grund, details, erneut: o.erneut, arg: o.arg, titel: o.titel }));
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
  if (d?.networkError) return { grund: tRaw('net.liste_offline') };
  if (d?.status === 429)
    return { grund: tRaw('liste.gedrosselt', { minuten: Math.max(1, Math.ceil((Number(d.waitSec) || 60) / 60)) }) };
  if (!d || (d.status ?? 0) >= 500 || !d.error)
    return {
      grund: tRaw(loggedInAccount?.isAdmin ? 'liste.server_fehler_verwalter' : 'liste.server_fehler'),
      details: d?.error ? String(d.error) : undefined,
    };
  return { grund: String(d.error) };
}

/**
 * "144 from sets · 250 individually" — empty as long as only one of the two sources has something.
 * @param {number} fromSets
 * @param {number} einzeln
 */
export function partsBreakdown(fromSets, einzeln) {
  if (!fromSets || !einzeln) return '';
  return tRaw('parts.stat.breakdown', { sets: fmtBig(fromSets), einzeln: fmtBig(einzeln) });
}

/**
 * The keyboard path of a clickable table row: a real button in a cell. The row itself stays
 * clickable for the mouse but no longer takes focus; a focusable <tr> told screen readers neither
 * role nor target.
 * @param {{ click: string, arg?: string | number, arg2?: string | number, arg3?: string | number }} ziel
 * @param {import('./escaping.js').Markup | string} sichtbar  content of the cell
 * @param {string} name  name of the button; contains the visible text
 * Content in a <span>: in the flex button the space in "Brick 2 x 4 (Schwarz)" would otherwise disappear.
 */
export function rowsButton(ziel, sichtbar, name) {
  return html`<button type="button" class="zeile-oeffnen" data-click="${ziel.click}"${ziel.arg !== undefined ? html` data-arg="${ziel.arg}"` : ''}${ziel.arg2 !== undefined ? html` data-arg2="${ziel.arg2}"` : ''}${ziel.arg3 !== undefined ? html` data-arg3="${ziel.arg3}"` : ''} aria-label="${name}"><span>${sichtbar}</span></button>`;
}

let _tileNr = 0;
/** A tile's name only from number and name, the rest as description: an aria-label missed "label in
 * name". @param {number} [teile] describing elements; `k.teil(i)` gives id and aria-hidden */
export function kachelName(teile = 1) {
  const id = `kachel-${++_tileNr}`;
  const ids = Array.from({ length: teile }, (_, i) => `${id}-${i + 1}`);
  return {
    attr: html` aria-describedby="${ids.join(' ')}"`,
    teil: (/** @type {number} */ i) => html` id="${ids[i]}" aria-hidden="true"`,
  };
}

/** "≈" before a purchase price that is an inserted market price; otherwise it would read as paid.
 * @param {string | import('./escaping.js').SafeHtml} markup already escaped markup */
export function estimatedPurchase(markup) {
  const hinweis = tRaw('acq.geschaetzt');
  return html`<span class="kauf-geschaetzt" title="${hinweis}"><span role="img" aria-label="${hinweis}">≈</span> ${rawHtml(String(markup))}</span>`;
}

/**
 * P&L badge. For a purchase price of 0 "gift" instead of a percentage: computed against 0 it would say "+327,600
 * %", and that says nothing.
 * @param {number | string | null | undefined} pct
 * @param {unknown} [kauf]
 */
export function pnlBadge(pct, kauf) {
  if (isGift(kauf)) return html`<span class="pnl-geschenk">${tRaw('finance.gift')}</span>`;
  if (pct === null || pct === undefined) return '';
  const v = parseFloat(String(pct));
  const cls = v > 0 ? 'pnl-pos' : v < 0 ? 'pnl-neg' : 'pnl-neu';
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
  return html`${item.owners.map(o => html`<span class="cond-badge besitzer-badge" title="${accountDisplay(o)}">${accountDisplay(o)}</span>`)}`;
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

/** Capture dialogs of the collection: set, part, fig — built the same way (initial focus: data-erstfokus). */
// Without data-arg the dispatcher passes the event as the first argument.
const addDialog = (/** @type {unknown} */ art) => G(`add-${typeof art === 'string' ? art : 'set'}-modal`);

/**
 * @param {string} [art]
 */
export function oeffneErfassen(art) {
  const dialog = addDialog(art);
  // The purchase date is today and the currency that of the account, as long as nobody chooses otherwise.
  dialog?.querySelectorAll('input[data-heute]').forEach(f => {
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
 * @param {string} [art]
 */
export function schliesseErfassen(art) {
  const dialog = addDialog(art);
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
 * @param {{ feld: string, pfad: string, felder?: Record<string, string>,
 *           zeige?: (laeuft: boolean) => void, hinweise?: (d: CsvResult) => unknown[] }} o
 * @returns {Promise<CsvResult | null>} the response on success, otherwise null
 */
export async function uploadCsv(o) {
  const fi = G(o.feld);
  if (!fi?.files?.[0]) return null;
  const fd = new FormData();
  fd.append('file', fi.files[0]);
  for (const [k, v] of Object.entries(o.felder ?? {})) fd.append(k, v);
  o.zeige?.(true);
  /** @type {CsvResult} */
  const d = await api('POST', o.pfad, fd);
  fi.value = '';
  o.zeige?.(false);
  if (!d.success) {
    toast(d.error || tRaw('settings.error'), 'error');
    return null;
  }
  const extra = (o.hinweise?.(d) ?? []).filter(Boolean);
  const zusatz = [d.skipped_hint, ...extra].filter(Boolean).join(' — ');
  toast(
    tRaw('import.summary', { added: d.added, updated: d.updated, errors: d.errors }) + (zusatz ? ` — ${zusatz}` : ''),
    d.errors || d.skipped || extra.length ? 'info' : 'success',
  );
  return d;
}

registerActions({
  oeffneErfassen,
  schliesseErfassen,
});
