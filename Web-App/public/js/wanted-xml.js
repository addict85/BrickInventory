// Wanted lists from BrickLink: first a preview like the parts list, where you can correct entries and
// add Rebrickable numbers, then the import — for sets, parts and figures, wherever the items show up
// afterwards.
import { emit } from './events.js';
import { registerActions } from './registry.js';
import { t, tRaw, colorName } from '../i18n.js';
import { escHex, rawHex, esc, html, rawHtml, joinHtml } from './escaping.js';
import { apiRaw } from './api.js';
import { imageTag, placeholderContent, fullUrl, imgUrl } from './images.js';
import { ico, G, XML_ICON_SVG, setHtml } from './dom.js';
import { toast } from './messages.js';
import { loadManualFigsTable } from './minifigs.js';
import { loadManualParts } from './parts.js';
import { loadBrickColors } from './part-add.js';

/**
 * The server's report (WantedXmlResult). The contract does not yet name the per-item fields the table
 * shows, so src/wanted writes them here.
 * @typedef {import('../../frontend-types/contract').WantedXmlResult['items'][number] & {
 *   image?: string | null, blColor?: number | null, colorHex?: string | null, colorName?: string | null,
 *   reason?: string | null, reasonCode?: string | null, maxPrice?: number | null, name?: string | null,
 *   nameGuessed?: boolean, rbId?: string | null, set?: string | null, condition?: string | null }} Item
 * @typedef {import('../../frontend-types/contract').WantedXmlResult & { items: Item[],
 *   aborted?: boolean, colorPending?: number, foreignTypes?: Record<string, number>,
 *   corrections?: { rejected?: unknown[] },
 *   rebrickable?: { asked: number, found: number, aborted?: 'quota' | 'no_key' | 'failure' } | null,
 *   levels?: Record<string, number>, defaultCondition?: string | null }} Report
 */
/** Why the Rebrickable stage ended early; the remaining items stayed open. */
const RB_CANCEL_REASON = /** @type {const} */ ({
  quota: 'wanted.rb_stopped_quota',
  no_key: 'wanted.rb_stopped_key',
  failure: 'wanted.rb_stopped_error',
});
/**
 * The chosen file stays in memory until import: the second step sends it again together with the
 * corrections. Otherwise the server would have to hold someone else's file until they confirm — or forever.
 * @type {File | null}
 */
let _file = null;
/** index → { rbId?, rbColor? } — what was changed in the table. */
/** @type {Map<number, Record<string, string | number | null>>} */
let _corrections = new Map();
/** The last report, for the table. @type {Report | null} */
let _report = null;
/**
 * Is a request already running? A second click is not harmless: the write step adds onto that day's
 * existing entry, so a duplicate request would double the quantities.
 */
let _busy = false;

/**
 * Which buttons are usable, derived in one place from _busy, _file and _report: two assignments to the
 * same button would overwrite each other once the release-after-run came in.
 */
function updateButtons() {
  const write = G('wanted-xml-write');
  const reload = G('wanted-xml-new');
  // Write only once a preview is showing: after writing, `preview` is
  // false, and a second click would be a second import.
  if (write) write.disabled = _busy || !_report?.preview;
  // Reloading needs the file — it's gone after writing.
  if (reload) reload.disabled = _busy || !_file;
}

// ── IMPORT ─────────────────────────────────────────────────────────────────

/** File chosen (in one of the three tabs) → fetch the preview. @this {unknown} */
async function wantedXmlSelected() {
  const el = this instanceof HTMLInputElement ? this : null;
  if (!el?.files?.[0]) return;
  // While an import is running, don't accept a new file: it would swap out _file mid-write. The button
  // next to it can be disabled, but this one is a <label> around a hidden field — it never turns grey, so
  // the input is rejected here instead.
  if (_busy) {
    toast(tRaw('import.running'), 'info');
    el.value = '';
    return;
  }
  _file = el.files[0];
  // Clear the field: otherwise the SAME file wouldn't fire a change event the second time, and the dialog
  // wouldn't reopen.
  el.value = '';
  _corrections = new Map();
  G('wanted-xml-modal').classList.add('open');
  await read(false);
}

function closeWantedXml() {
  G('wanted-xml-modal').classList.remove('open');
  _file = null;
  _report = null;
  _corrections = new Map();
  // With no file and no report both buttons are dead — the next preview re-enables them.
  updateButtons();
}

/** Read again — e.g. after turning on "ask Rebrickable". */
async function rereadWantedXml() {
  await read(false);
}

/** Actually write now. */
async function writeWantedXml() {
  await read(true);
}

/**
 * The one path to the server, for both steps.
 *
 * Two separate paths could have drifted apart — then the preview would promise something the import
 * doesn't do. The same reasoning applies server-side in the wanted list import.
 * @param {boolean} write
 */
async function read(write) {
  if (!_file || _busy) return;
  _busy = true;
  updateButtons();
  try {
    await readReally(write);
  } finally {
    // ALWAYS release, even if something threw: a lock left stuck after an error makes the dialog unusable
    // until it's closed — and looks like a hung import.
    _busy = false;
    updateButtons();
  }
}

/**
 * Set or hide the progress bar. It distinguishes two phases (asking Rebrickable, writing), with a line
 * underneath — a bar with no label would leave open what you're waiting for.
 * @param {{phase:string,done:number,total:number}|null} state
 *   null hides it (before the first run, after the last).
 */
function drawProgress(state) {
  const box = G('wanted-xml-progress');
  if (!box) return;
  if (!state?.total) {
    box.style.display = 'none';
    return;
  }
  const share = Math.max(0, Math.min(100, Math.round((state.done / state.total) * 100)));
  box.style.display = '';
  const bar = G('wanted-xml-bar');
  if (bar) bar.style.width = share + '%';
  // The same number for screen readers too: a bar that only grows wider is no information for them.
  G('wanted-xml-bar-wrap')?.setAttribute('aria-valuenow', String(share));
  const txt = G('wanted-xml-progress-text');
  if (txt) {
    // tRaw, not t: the target is textContent, and t() escapes for HTML — the escaping would show up as
    // literal characters (test/frontend-escaping.test.js).
    txt.textContent = tRaw(state.phase === 'rebrickable' ? 'wanted.progress_rb' : 'wanted.progress_write', {
      done: state.done,
      total: state.total,
    });
  }
}

/**
 * Read the response line by line (NDJSON) and fill the bar as it goes; the last line is the report.
 * Without response.body (the fetch stand-in in tests) the fallback reads everything as one JSON value.
 * @param {Response} r
 * @returns {Promise<Partial<Report> & { success?: boolean, error?: string }>} the report (the last line)
 */
async function readStream(r) {
  if (!r.body?.getReader) return await r.json().catch(() => ({}));
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let rest = '';
  let last = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    rest += decoder.decode(value, { stream: true });
    // The last line of a chunk is often cut off — it stays in `rest` until its newline arrives. Without
    // this, a report spanning two TCP packets would break mid-JSON.
    const lines = rest.split('\n');
    rest = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let o;
      try {
        o = JSON.parse(line);
      } catch {
        continue;
      }
      if (o.progress) {
        drawProgress(o.progress);
        continue;
      }
      last = o;
    }
  }
  if (rest.trim()) {
    try {
      last = JSON.parse(rest);
    } catch {
      /* incomplete */
    }
  }
  return last ?? {};
}

/** The index travels WITH it: a list may contain the same item twice, and a key built from number and
 * color would then hit both. Kind and number are the server's cross-check. */
function correctionsJson() {
  return JSON.stringify(
    [..._corrections.entries()].map(([index, k]) => ({
      index: Number(index),
      blId: _report?.items?.[index]?.blId ?? '',
      kind: _report?.items?.[index]?.kind ?? 'part',
      ...k,
    })),
  );
}

/** What gets reloaded depends on WHAT the list contained — and the report knows that better than the
 * button it came from: a wanted list may mix parts, figures AND sets. @param {Report} d the report */
function afterWrite(d) {
  toast(
    tRaw('import.summary', { added: d.created, updated: d.topped_up, errors: d.failed }),
    d.failed ? 'info' : 'success',
  );
  const kinds = new Set((d.items || []).map((/** @type {{ kind: string }} */ x) => x.kind));
  if (kinds.has('part')) loadManualParts().catch(() => {});
  if (kinds.has('fig')) loadManualFigsTable().catch(() => {});
  if (kinds.has('set')) emit('collectionLoad');
  _file = null;
  _corrections = new Map();
}

/**
 * The actual run. Separate so the lock in read() has a try/finally.
 * @param {boolean} write
 */
async function readReally(write) {
  const tab = G('wanted-xml-table');
  const report = G('wanted-xml-report');
  if (report) report.textContent = tRaw('import.running');
  if (!write && tab) tab.replaceChildren();

  const fd = new FormData();
  if (_file) fd.append('file', _file);
  if (write && _corrections.size) fd.append('corrections', correctionsJson());
  const p = new URLSearchParams();
  if (write) p.set('write', '1');
  if (G('wanted-rb')?.checked) p.set('rebrickable', '1');
  // Progress costs nothing when nobody's watching — but here somebody is, so always.
  p.set('stream', '1');

  drawProgress(null);
  let d;
  try {
    const r = await apiRaw('POST', `/v2/wanted-list/import/xml?${p}`, { body: fd });
    d = await readStream(r);
  } catch {
    d = {};
  }
  drawProgress(null);
  if (!d?.success) {
    if (report) report.textContent = '';
    toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  // success means the server sent the whole report.
  const resultReport = /** @type {Report} */ (/** @type {unknown} */ (d));
  _report = resultReport;
  drawSummary(resultReport);
  drawTable(resultReport);
  if (write) afterWrite(resultReport);
}

/** The summary above the table. */
/** @param {Report} d */
function drawSummary(d) {
  const el = G('wanted-xml-report');
  if (!el) return;
  // The stages SEPARATELY and in words rather than colors: Marco sees red and green poorly, and
  // "probably" is a statement that must be stated, not just implied.
  const stage = (/** @type {string} */ k, /** @type {string} */ text) =>
    d.levels?.[k] ? html`<div>• ${text}: <strong>${d.levels[k]}</strong></div>` : '';
  G('wanted-xml-sub').textContent = _file?.name || '';
  // Button state comes from updateButtons() — see its reasoning there.
  updateButtons();
  setHtml(
    el,
    html`
    <div data-style="border:1px solid var(--bdr);border-radius:8px;padding:.6rem">
      <div><strong>${d.parsed}</strong> ${tRaw('settings.wanted_read')}${d.preview ? html` — ${tRaw('settings.wanted_preview_only')}` : ''}</div>
      ${stage('zuordnung', tRaw('settings.wanted_s1'))}
      ${stage('gleich_vermerkt', tRaw('settings.wanted_s2'))}
      ${stage('katalogtreffer', tRaw('settings.wanted_s3'))}
      ${stage('rebrickable', tRaw('settings.wanted_s4'))}
      ${stage('korrigiert', tRaw('wanted.s_corrected'))}
      ${d.open?.length ? html`<div>${ico('warning')} <strong>${d.open.length}</strong> ${tRaw('settings.wanted_open')}</div>` : ''}
      ${d.colorPending ? html`<div>${ico('warning')} <strong>${d.colorPending}</strong> ${tRaw('settings.wanted_color_open')}</div>` : ''}
      ${
        Object.keys(d.foreignTypes || {}).length
          ? html`<div>${ico('warning')} ${tRaw('settings.wanted_other_kinds')}: ${Object.entries(d.foreignTypes ?? {})
              .map(([k, n]) => `${k}=${n}`)
              .join(', ')}</div>`
          : ''
      }
      ${d.rebrickable ? html`<div>${tRaw('settings.wanted_rb_asked')}: ${d.rebrickable.asked} → ${d.rebrickable.found}</div>` : ''}
      ${d.rebrickable?.aborted ? html`<div>${ico('warning')} ${tRaw(RB_CANCEL_REASON[d.rebrickable.aborted])}</div>` : ''}
      ${d.corrections?.rejected?.length ? html`<div>${ico('warning')} <strong>${d.corrections.rejected.length}</strong> ${tRaw('wanted.corrections_rejected')}</div>` : ''}
      ${d.aborted ? html`<div>${ico('warning')} ${tRaw('wanted.cancelled')}</div>` : ''}
      ${!d.preview ? html`<div data-style="margin-top:.4rem"><strong>${d.created}</strong> ${tRaw('settings.wanted_written')}${d.topped_up ? html`, ${d.topped_up} ${tRaw('wanted.topped_up')}` : ''}${d.failed ? html`, ${d.failed} ${tRaw('settings.wanted_errors')}` : ''}</div>` : ''}
    </div>`,
  );
}

/** @param {Item} p a report row */
function outcomeTexts(p) {
  // The outcome in words, not just a color. In the preview "will be created", after import "created":
  // otherwise every row would still read in future tense after writing.
  const future = !!_report?.preview;
  const outcome = esc(
    tRaw(p.outcome === 'created' && !future ? 'wanted.out_created_done' : `wanted.out_${p.outcome}`) || p.outcome,
  );
  // The reason in the viewer's language. `reason` from the server is a German sentence — right for the log,
  // wrong in an English table (seen exactly that way on the running server). If the code is missing (for
  // outcome 'error' the exception message is there instead), the sentence stays as is.
  const reason = p.reasonCode
    ? t(`wanted.reason_${p.reasonCode}`, { blColor: p.blColor })
    : p.reason
      ? esc(p.reason)
      : '';
  return { outcome, reason };
}

/** @param {Item} p a report row */
function defaultConditionCell(p) {
  // The condition that gets created: from the file, else the account's default — with a note that it came
  // from there. Without the note, "Used" would read like a value from the file.
  const conditionValue = p.condition === 'N' || p.condition === 'U' ? p.condition : _report?.defaultCondition || null;
  const fromDefault = p.condition !== 'N' && p.condition !== 'U';
  return conditionValue
    ? html`<span class="cond-badge ${conditionValue === 'U' ? 'cond-used' : 'cond-new'}">${tRaw(conditionValue === 'U' ? 'common.condition_used' : 'common.condition_new')}</span>${fromDefault ? html`<div data-style="color:var(--mut);font-size:var(--fs-1)">${tRaw('wanted.cond_default')}</div>` : ''}`
    : '';
}

/** @param {Item} p a report row @param {number} i */
function correctionCells(p, i) {
  const correction = _corrections.get(i) || {};

  // The values from the file, pre-filled and editable. Here any deviation from the original value counts
  // as a correction — unlike the empty correction fields to the right, where empty means "left alone".
  // Every field names its column and item: a screen reader would otherwise hear "spinner 1" with no tie to
  // the row.
  const id = p.blId;
  const field = (
    /** @type {string} */ name,
    /** @type {unknown} */ value,
    extra = '',
    width = 72,
    key = 'wanted.field_quantity',
  ) =>
    html`<input data-change="wantedCorrectionValue" data-field="${name}" data-i="${i}" aria-label="${tRaw(key, { id })}"
       value="${value}" ${rawHtml(extra)}
       data-width-px="${width}"
       data-style="font-size:var(--fs-1);padding:2px 4px;border:1px solid var(--field-border);border-radius:5px;text-align:right" />`;
  const quantityCell = field('quantity', correction.quantity ?? p.quantity, 'type="number" min="1" step="1"');
  // The price per unit. Empty means "none" — then import fetches the market price, like MAXPRICE=-1 in
  // the file.
  const priceValue = correction.purchase_price !== undefined ? (correction.purchase_price ?? '') : (p.maxPrice ?? '');
  const priceCell = field(
    'purchase-price',
    priceValue,
    `type="number" min="0" step="0.0001" placeholder="${esc(tRaw('wanted.price_ph'))}"`,
    96,
    'wanted.field_price',
  );
  // The condition as a choice with THREE options: the empty value isn't a gap, it's "the account's
  // default" — the same statement as CONDITION=X.
  const conditionNow = correction.condition !== undefined ? (correction.condition ?? '') : (p.condition ?? '');
  const option = (/** @type {string} */ w, /** @type {string} */ text) =>
    html`<option value="${w}"${conditionNow === w ? ' selected' : ''}>${text}</option>`;
  const conditionSelect = html`<select data-change="wantedCorrectionValue" data-field="condition" data-i="${i}" aria-label="${tRaw('wanted.field_state', { id })}"
      data-style="font-size:var(--fs-1);padding:2px;border:1px solid var(--field-border);border-radius:5px">
      ${option('', tRaw('wanted.cond_default_opt'))}
      ${option('N', tRaw('common.condition_new'))}
      ${option('U', tRaw('common.condition_used'))}
    </select>`;
  return { quantityCell, priceCell, conditionSelect, conditionNow };
}

/** What a row shows. See the reasoning on ItemResult. */
/** @param {Item} p @param {number} i */
function row(p, i) {
  const image = p.image
    ? imageTag({ src: imgUrl(fullUrl(p.image), true), alt: '', class: 'image-40', ph: 'teil' })
    : html`<span class="image-ph image-40" aria-hidden="true">${placeholderContent('teil')}</span>`;
  const dot = p.colorHex
    ? html`<span data-style="display:inline-block;width:10px;height:10px;border-radius:50%;border:1px solid rgba(0,0,0,.15);margin-right:4px"
        data-color-hex="${escHex(p.colorHex, 'var(--s300)')}"></span>`
    : '';
  const { outcome, reason } = outcomeTexts(p);
  const conditionCell = defaultConditionCell(p);
  const { quantityCell, priceCell, conditionSelect, conditionNow } = correctionCells(p, i);
  const correction = _corrections.get(i) || {};
  const id = p.blId;

  return html`<tr${p.outcome === 'open' ? html` data-style="background:var(--s50)"` : ''}>
    <td>${image}</td>
    <td data-style="font-family:monospace;font-size:var(--fs-1)">${p.blId}${p.rbId && p.rbId !== p.blId ? html`<div data-style="color:var(--mut)">→ ${p.rbId}</div>` : ''}</td>
    <td data-style="font-size:var(--fs-2)">${p.name || ''}${p.nameGuessed ? html`<div data-style="color:var(--mut);font-size:var(--fs-1)">${tRaw('wanted.name_guessed')}</div>` : ''}</td>
    <td data-style="font-size:var(--fs-2);white-space:nowrap">${dot}${p.colorName || ''}${p.blColor !== null && !p.colorName ? html`<span data-style="color:var(--mut)">BL ${p.blColor}</span>` : ''}</td>
    <td data-style="text-align:right">${quantityCell}</td>
    <td data-style="font-size:var(--fs-1);white-space:nowrap">${conditionSelect}${conditionNow === '' && conditionCell ? html`<div data-style="margin-top:2px">${conditionCell}</div>` : ''}</td>
    <td data-style="text-align:right">${priceCell}</td>
    <td data-style="font-size:var(--fs-1)">${rawHtml(outcome)}${reason ? html`<div data-style="color:var(--mut);font-size:var(--fs-1)">${rawHtml(reason)}</div>` : ''}</td>
    <td><input type="text" value="${correction.rbId ?? ''}" placeholder="${tRaw('wanted.rb_id_ph')}" aria-label="${tRaw('wanted.field_rb', { id })}" data-style="width:8em;max-width:100%;font-size:var(--fs-1);padding:2px 4px;
      border:1px solid var(--field-border);border-radius:5px"
      data-change="wantedCorrectionNumber" data-i="${i}" /></td>
    <td><select data-change="wantedCorrectionColor" data-i="${i}" aria-label="${tRaw('wanted.field_color', { id })}"
      data-style="max-width:140px;font-size:var(--fs-1);padding:2px;border:1px solid var(--field-border);border-radius:5px">
      <option value="">${tRaw('wanted.keep')}</option></select></td>
  </tr>`;
}

/** @param {Report} d */
function drawTable(d) {
  const el = G('wanted-xml-table');
  if (!el) return;
  const items = d.items || [];
  if (!items.length) {
    el.replaceChildren();
    return;
  }
  setHtml(
    el,
    html`<table class="dt" aria-label="${tRaw('wanted.preview_title')}" data-style="font-size:var(--fs-2)"><thead><tr>
      <th>${tRaw('col.image_th')}</th>
      <th>BrickLink</th>
      <th>${tRaw('col.name')}</th>
      <th>${tRaw('col.color')}</th>
      <th>${tRaw('detail.qty')}</th>
      <th>${tRaw('common.condition')}</th>
      <th>${tRaw('detail.purchase_price')}</th>
      <th>${tRaw('wanted.col_outcome')}</th>
      <th>${tRaw('wanted.col_rb_id')}</th>
      <th>${tRaw('wanted.col_set_color')}</th>
    </tr></thead><tbody>${joinHtml(items.map(row))}</tbody></table>`,
  );
  fillColorChoices().catch(() => {});
}

/**
 * Fill the color dropdowns — AFTER drawing.
 *
 * /v2/parts/brick-colors goes over the network the first time; the table shouldn't wait for it. Until
 * then every dropdown shows "unchanged", and that is exactly the right default.
 */
async function fillColorChoices() {
  const colors = await loadBrickColors();
  if (!colors?.length) return;
  const opts = colors
    .map(c => html`<option value="${c.id}" data-hex="${rawHex(c.hex)}">${colorName(c.name)}</option>`)
    .join('');
  for (const sel of /** @type {NodeListOf<HTMLSelectElement>} */ (
    G('wanted-xml-table').querySelectorAll('select[data-change="wantedCorrectionColor"]')
  )) {
    const i = Number(sel.dataset.i);
    const chosen = _corrections.get(i)?.rbColor;
    setHtml(sel, html`<option value="">${tRaw('wanted.keep')}</option>${rawHtml(opts)}`);
    if (chosen !== undefined && chosen !== null) sel.value = String(chosen);
  }
}

/** Remember an entered Rebrickable number (or clear the entry). @this {unknown} */
function wantedCorrectionNumber() {
  const el = this instanceof HTMLInputElement || this instanceof HTMLSelectElement ? this : null;
  if (!el) return;
  const i = Number(el.dataset.i);
  const value = el.value.trim();
  const k = { ..._corrections.get(i) };
  // An empty field means "enter nothing", not "delete the number": the server distinguishes `undefined`
  // (left alone) from `null` (explicitly cleared), and the first is meant here.
  if (value === '') delete k.rbId;
  else k.rbId = value;
  setCorrection(i, k);
}

/** @this {unknown} */
function wantedCorrectionColor() {
  const el = this instanceof HTMLInputElement || this instanceof HTMLSelectElement ? this : null;
  if (!el) return;
  const i = Number(el.dataset.i);
  const k = { ..._corrections.get(i) };
  if (el.value === '') delete k.rbColor;
  else k.rbColor = parseInt(el.value, 10);
  setCorrection(i, k);
}

/**
 * Per editable field: the value into the correction, or the text to put back into the field. Nothing
 * unusable is sent: the server would reject the whole correction, and the color next to it would be lost
 * too. @type {Record<string, (k: Record<string, unknown>, p: Item, raw: string) => string | undefined>}
 */
const CORRECTION_FIELDS = {
  quantity: (k, p, raw) => {
    const m = parseInt(raw, 10);
    if (!Number.isFinite(m) || m < 1) return String(k.quantity ?? p.quantity);
    if (m === p.quantity) delete k.quantity;
    else k.quantity = m;
    return undefined;
  },
  condition: (k, p, raw) => {
    const w = raw === '' ? null : raw;
    if (w === (p.condition ?? null)) delete k.condition;
    else k.condition = w;
    return undefined;
  },
  'purchase-price': (k, p, raw) => {
    const old = p.maxPrice ?? null;
    // 0 means "none", like MAXPRICE=-1 in the file.
    const z = raw === '' ? 0 : Number(raw);
    if (!Number.isFinite(z) || z < 0) return String(k.purchase_price ?? old ?? '');
    const w = z > 0 ? z : null;
    if (w === old) delete k.purchase_price;
    else k.purchase_price = w;
    return undefined;
  },
};

/**
 * A pre-filled preview field (quantity, condition, purchase price). Its own handler, because it compares
 * against the report instead of checking for empty: typing back the original value takes the correction
 * back.
 * @this {unknown}
 */
function wantedCorrectionValue() {
  const el = this instanceof HTMLInputElement || this instanceof HTMLSelectElement ? this : null;
  if (!el) return;
  const i = Number(el.dataset.i);
  const name = el.dataset.field;
  const p = _report?.items?.[i];
  if (!p) return;
  const k = { ..._corrections.get(i) };
  const raw = el.value.trim();

  const apply = CORRECTION_FIELDS[name ?? ''];
  if (!apply) return;
  const restore = apply(k, p, raw);
  if (restore !== undefined) {
    el.value = restore;
    return;
  }
  setCorrection(i, k);
}

/** @param {number} i @param {Record<string, string | number | null>} k */
function setCorrection(i, k) {
  if (Object.keys(k).length === 0) _corrections.delete(i);
  else _corrections.set(i, k);
  const button = G('wanted-xml-write');
  if (button) {
    // The count on the button, so it's visible that corrections travel with it — otherwise it stays a
    // promise you can only check afterwards.
    button.textContent = _corrections.size
      ? `${tRaw('settings.wanted_write')} (${_corrections.size})`
      : tRaw('settings.wanted_write');
  }
}

G('wanted-xml-modal')?.addEventListener('click', e => e.target === e.currentTarget && closeWantedXml());

// Attach the icon here once to all three buttons instead of three times in the HTML. Into its own <span>
// with no data-i18n: the translation sets textContent and would throw it away on a language switch.
for (const el of document.querySelectorAll('[data-wanted-icon]')) setHtml(el, XML_ICON_SVG);

// Names below are registry-exposed (data-click/data-change in index.html) — kept unchanged.
registerActions({
  wantedCorrectionColor,
  wantedCorrectionValue,
  wantedCorrectionNumber,
  wantedXmlSelected,
  rereadWantedXml,
  closeWantedXml,
  writeWantedXml,
});
