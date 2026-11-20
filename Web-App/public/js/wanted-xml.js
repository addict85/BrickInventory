// Wanted lists from BrickLink: first a preview like the parts list, where you can correct entries and
// add Rebrickable numbers, then the import — for sets, parts and figures, wherever the items show up
// afterwards.
import { emit } from './events.js';
import { registerActions } from './registry.js';
import { t, tRaw, colorName } from '../i18n.js';
import { escHex, rawHex, esc, html, rawHtml, joinHtml } from './escaping.js';
import { apiRaw } from './api.js';
import { bildTag, placeholderContent, fullUrl, imgUrl } from './images.js';
import { ico, G, XML_ICON_SVG, setzeHtml } from './dom.js';
import { toast } from './messages.js';
import { loadManualFigsTable } from './minifigs.js';
import { loadManualParts } from './parts.js';
import { loadBrickColors } from './part-add.js';

/**
 * The server's report (WantedXmlErgebnis). The contract does not yet name the per-item fields the table
 * shows, so src/merkliste writes them here.
 * @typedef {import('../../frontend-typen/vertrag').WantedXmlErgebnis['posten'][number] & {
 *   bild?: string | null, blFarbe?: number | null, farbHex?: string | null, farbName?: string | null,
 *   grund?: string | null, grundCode?: string | null, maxPreis?: number | null, name?: string | null,
 *   nameGeraten?: boolean, rbId?: string | null, set?: string | null, zustand?: string | null }} Item
 * @typedef {import('../../frontend-typen/vertrag').WantedXmlErgebnis & { posten: Item[],
 *   abgebrochen?: boolean, farbeOffen?: number, fremdeArten?: Record<string, number>,
 *   korrekturen?: { abgewiesen?: unknown[] },
 *   rebrickable?: { gefragt: number, gefunden: number, abgebrochen?: 'kontingent' | 'kein_schluessel' | 'stoerung' } | null,
 *   stufen?: Record<string, number>, standardZustand?: string | null }} Report
 */
/** Why the Rebrickable stage ended early; the remaining items stayed open. */
const RB_CANCEL_REASON = /** @type {const} */ ({
  kontingent: 'wanted.rb_stopped_quota',
  kein_schluessel: 'wanted.rb_stopped_key',
  stoerung: 'wanted.rb_stopped_error',
});
/**
 * The chosen file stays in memory until import: the second step sends it again together with the
 * corrections. Otherwise the server would have to hold someone else's file until they confirm — or forever.
 * @type {File | null}
 */
let _file = null;
/** index → { rbId?, rbFarbe? } — what was changed in the table. */
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
  const write = G('wanted-xml-schreiben');
  const reload = G('wanted-xml-neu');
  // Write only once a preview is showing: after writing, `vorschau` is
  // false, and a second click would be a second import.
  if (write) write.disabled = _busy || !_report?.vorschau;
  // Reloading needs the file — it's gone after writing.
  if (reload) reload.disabled = _busy || !_file;
}

// ── IMPORT ─────────────────────────────────────────────────────────────────

/** File chosen (in one of the three tabs) → fetch the preview. @this {unknown} */
async function wantedXmlGewaehlt() {
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

function wantedXmlSchliessen() {
  G('wanted-xml-modal').classList.remove('open');
  _file = null;
  _report = null;
  _corrections = new Map();
  // With no file and no report both buttons are dead — the next preview re-enables them.
  updateButtons();
}

/** Read again — e.g. after turning on "ask Rebrickable". */
async function wantedXmlNeuLesen() {
  await read(false);
}

/** Actually write now. */
async function wantedXmlSchreiben() {
  await read(true);
}

/**
 * The one path to the server, for both steps.
 *
 * Two separate paths could have drifted apart — then the preview would promise something the import
 * doesn't do. The same reasoning applies server-side at importiereWantedListe().
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
 * @param {{phase:string,fertig:number,gesamt:number}|null} state
 *   null hides it (before the first run, after the last).
 */
function drawProgress(state) {
  const box = G('wanted-xml-fortschritt');
  if (!box) return;
  if (!state?.gesamt) {
    box.style.display = 'none';
    return;
  }
  const share = Math.max(0, Math.min(100, Math.round((state.fertig / state.gesamt) * 100)));
  box.style.display = '';
  const bar = G('wanted-xml-balken');
  if (bar) bar.style.width = share + '%';
  // The same number for screen readers too: a bar that only grows wider is no information for them.
  G('wanted-xml-balken-wrap')?.setAttribute('aria-valuenow', String(share));
  const txt = G('wanted-xml-fortschritt-text');
  if (txt) {
    // tRaw, not t: the target is textContent, and t() escapes for HTML — the escaping would show up as
    // literal characters (test/frontend-escaping.test.js).
    txt.textContent = tRaw(state.phase === 'rebrickable' ? 'wanted.progress_rb' : 'wanted.progress_write', {
      done: state.fertig,
      total: state.gesamt,
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
      if (o.fortschritt) {
        drawProgress(o.fortschritt);
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

/**
 * The actual run. Separate so the lock in read() has a try/finally.
 * @param {boolean} write
 */
async function readReally(write) {
  const tab = G('wanted-xml-tabelle');
  const report = G('wanted-xml-bericht');
  if (report) report.textContent = tRaw('import.running');
  if (!write && tab) tab.replaceChildren();

  const fd = new FormData();
  if (_file) fd.append('file', _file);
  if (write && _corrections.size) {
    // The index travels WITH it: a list may contain the same item twice, and a key built from number and
    // color would then hit both. Kind and number are the server's cross-check.
    fd.append(
      'korrekturen',
      JSON.stringify(
        [..._corrections.entries()].map(([index, k]) => ({
          index: Number(index),
          blId: _report?.posten?.[index]?.blId ?? '',
          art: _report?.posten?.[index]?.art ?? 'part',
          ...k,
        })),
      ),
    );
  }
  const p = new URLSearchParams();
  if (write) p.set('schreiben', '1');
  if (G('wanted-rb')?.checked) p.set('rebrickable', '1');
  // Progress costs nothing when nobody's watching — but here somebody is, so always.
  p.set('strom', '1');

  drawProgress(null);
  let d;
  try {
    const r = await apiRaw('POST', `/v1/wanted-list/import/xml?${p}`, { body: fd });
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
  const resultReport = /** @type {Report} */ (d);
  _report = resultReport;
  drawSummary(resultReport);
  drawTable(resultReport);
  if (write) {
    toast(
      tRaw('import.summary', { added: d.angelegt, updated: d.aufgestockt, errors: d.fehler }),
      d.fehler ? 'info' : 'success',
    );
    // What gets reloaded depends on WHAT the list contained — and the report knows that better than the
    // button it came from: a wanted list may mix parts, figures AND sets.
    const kinds = new Set((d.posten || []).map(x => x.art));
    if (kinds.has('part')) loadManualParts().catch(() => {});
    if (kinds.has('fig')) loadManualFigsTable().catch(() => {});
    if (kinds.has('set')) emit('sammlungLaden');
    _file = null;
    _corrections = new Map();
  }
}

/** The summary above the table. */
/** @param {Report} d */
function drawSummary(d) {
  const el = G('wanted-xml-bericht');
  if (!el) return;
  // The stages SEPARATELY and in words rather than colors: Marco sees red and green poorly, and
  // "probably" is a statement that must be stated, not just implied.
  const stage = (/** @type {string} */ k, /** @type {string} */ text) =>
    d.stufen?.[k] ? html`<div>• ${text}: <strong>${d.stufen[k]}</strong></div>` : '';
  G('wanted-xml-sub').textContent = _file?.name || '';
  // Button state comes from updateButtons() — see its reasoning there.
  updateButtons();
  setzeHtml(
    el,
    html`
    <div data-stil="border:1px solid var(--bdr);border-radius:8px;padding:.6rem">
      <div><strong>${d.gelesen}</strong> ${tRaw('settings.wanted_read')}${d.vorschau ? html` — ${tRaw('settings.wanted_preview_only')}` : ''}</div>
      ${stage('zuordnung', tRaw('settings.wanted_s1'))}
      ${stage('gleich_vermerkt', tRaw('settings.wanted_s2'))}
      ${stage('katalogtreffer', tRaw('settings.wanted_s3'))}
      ${stage('rebrickable', tRaw('settings.wanted_s4'))}
      ${stage('korrigiert', tRaw('wanted.s_corrected'))}
      ${d.offen?.length ? html`<div>${ico('warnung')} <strong>${d.offen.length}</strong> ${tRaw('settings.wanted_open')}</div>` : ''}
      ${d.farbeOffen ? html`<div>${ico('warnung')} <strong>${d.farbeOffen}</strong> ${tRaw('settings.wanted_color_open')}</div>` : ''}
      ${
        Object.keys(d.fremdeArten || {}).length
          ? html`<div>${ico('warnung')} ${tRaw('settings.wanted_other_kinds')}: ${Object.entries(d.fremdeArten ?? {})
              .map(([k, n]) => `${k}=${n}`)
              .join(', ')}</div>`
          : ''
      }
      ${d.rebrickable ? html`<div>${tRaw('settings.wanted_rb_asked')}: ${d.rebrickable.gefragt} → ${d.rebrickable.gefunden}</div>` : ''}
      ${d.rebrickable?.abgebrochen ? html`<div>${ico('warnung')} ${tRaw(RB_CANCEL_REASON[d.rebrickable.abgebrochen])}</div>` : ''}
      ${d.korrekturen?.abgewiesen?.length ? html`<div>${ico('warnung')} <strong>${d.korrekturen.abgewiesen.length}</strong> ${tRaw('wanted.corrections_rejected')}</div>` : ''}
      ${d.abgebrochen ? html`<div>${ico('warnung')} ${tRaw('wanted.cancelled')}</div>` : ''}
      ${!d.vorschau ? html`<div data-stil="margin-top:.4rem"><strong>${d.angelegt}</strong> ${tRaw('settings.wanted_written')}${d.aufgestockt ? html`, ${d.aufgestockt} ${tRaw('wanted.topped_up')}` : ''}${d.fehler ? html`, ${d.fehler} ${tRaw('settings.wanted_errors')}` : ''}</div>` : ''}
    </div>`,
  );
}

/** What a row shows. See the reasoning on ItemResult. */
/** @param {Item} p @param {number} i */
function row(p, i) {
  const image = p.bild
    ? bildTag({ src: imgUrl(fullUrl(p.bild), true), alt: '', klasse: 'bild-40', ph: 'teil' })
    : html`<span class="bild-ph bild-40" aria-hidden="true">${placeholderContent('teil')}</span>`;
  const dot = p.farbHex
    ? html`<span data-stil="display:inline-block;width:10px;height:10px;border-radius:50%;border:1px solid rgba(0,0,0,.15);margin-right:4px"
        data-farbe="${escHex(p.farbHex, 'var(--s300)')}"></span>`
    : '';
  // The outcome in words, not just a color. In the preview "will be created", after import "created":
  // otherwise every row would still read in future tense after writing.
  const future = !!_report?.vorschau;
  const outcome = esc(
    tRaw(p.ausgang === 'angelegt' && !future ? 'wanted.out_angelegt_fertig' : `wanted.out_${p.ausgang}`) || p.ausgang,
  );
  // The reason in the viewer's language. `grund` from the server is a German sentence — right for the log,
  // wrong in an English table (seen exactly that way on the running server). If the code is missing (for
  // outcome 'fehler' the exception message is there instead), the sentence stays as is.
  const reason = p.grundCode ? t(`wanted.grund_${p.grundCode}`, { farbe: p.blFarbe }) : p.grund ? esc(p.grund) : '';
  // The condition that gets created: from the file, else the account's default — with a note that it came
  // from there. Without the note, "Used" would read like a value from the file.
  const conditionValue = p.zustand === 'N' || p.zustand === 'U' ? p.zustand : _report?.standardZustand || null;
  const fromDefault = p.zustand !== 'N' && p.zustand !== 'U';
  const conditionCell = conditionValue
    ? html`<span class="cond-badge ${conditionValue === 'U' ? 'cond-used' : 'cond-new'}">${tRaw(conditionValue === 'U' ? 'common.condition_used' : 'common.condition_new')}</span>${fromDefault ? html`<div data-stil="color:var(--mut);font-size:var(--fs-1)">${tRaw('wanted.cond_default')}</div>` : ''}`
    : '';
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
    key = 'wanted.feld_menge',
  ) =>
    html`<input data-change="wantedKorrekturWert" data-feld="${name}" data-i="${i}" aria-label="${tRaw(key, { id })}"
       value="${value}" ${rawHtml(extra)}
       data-breite-px="${width}"
       data-stil="font-size:var(--fs-1);padding:2px 4px;border:1px solid var(--feldrand);border-radius:5px;text-align:right" />`;
  const quantityCell = field('menge', correction.menge ?? p.menge, 'type="number" min="1" step="1"');
  // The price per unit. Empty means "none" — then import fetches the market price, like MAXPRICE=-1 in
  // the file.
  const priceValue = correction.kaufpreis !== undefined ? (correction.kaufpreis ?? '') : (p.maxPreis ?? '');
  const priceCell = field(
    'kaufpreis',
    priceValue,
    `type="number" min="0" step="0.0001" placeholder="${esc(tRaw('wanted.price_ph'))}"`,
    96,
    'wanted.feld_preis',
  );
  // The condition as a choice with THREE options: the empty value isn't a gap, it's "the account's
  // default" — the same statement as CONDITION=X.
  const conditionNow = correction.zustand !== undefined ? (correction.zustand ?? '') : (p.zustand ?? '');
  const option = (/** @type {string} */ w, /** @type {string} */ text) =>
    html`<option value="${w}"${conditionNow === w ? ' selected' : ''}>${text}</option>`;
  const conditionSelect = html`<select data-change="wantedKorrekturWert" data-feld="zustand" data-i="${i}" aria-label="${tRaw('wanted.feld_zustand', { id })}"
      data-stil="font-size:var(--fs-1);padding:2px;border:1px solid var(--feldrand);border-radius:5px">
      ${option('', tRaw('wanted.cond_default_opt'))}
      ${option('N', tRaw('common.condition_new'))}
      ${option('U', tRaw('common.condition_used'))}
    </select>`;

  return html`<tr${p.ausgang === 'offen' ? html` data-stil="background:var(--s50)"` : ''}>
    <td>${image}</td>
    <td data-stil="font-family:monospace;font-size:var(--fs-1)">${p.blId}${p.rbId && p.rbId !== p.blId ? html`<div data-stil="color:var(--mut)">→ ${p.rbId}</div>` : ''}</td>
    <td data-stil="font-size:var(--fs-2)">${p.name || ''}${p.nameGeraten ? html`<div data-stil="color:var(--mut);font-size:var(--fs-1)">${tRaw('wanted.name_guessed')}</div>` : ''}</td>
    <td data-stil="font-size:var(--fs-2);white-space:nowrap">${dot}${p.farbName || ''}${p.blFarbe !== null && !p.farbName ? html`<span data-stil="color:var(--mut)">BL ${p.blFarbe}</span>` : ''}</td>
    <td data-stil="text-align:right">${quantityCell}</td>
    <td data-stil="font-size:var(--fs-1);white-space:nowrap">${conditionSelect}${conditionNow === '' && conditionCell ? html`<div data-stil="margin-top:2px">${conditionCell}</div>` : ''}</td>
    <td data-stil="text-align:right">${priceCell}</td>
    <td data-stil="font-size:var(--fs-1)">${rawHtml(outcome)}${reason ? html`<div data-stil="color:var(--mut);font-size:var(--fs-1)">${rawHtml(reason)}</div>` : ''}</td>
    <td><input type="text" value="${correction.rbId ?? ''}" placeholder="${tRaw('wanted.rb_id_ph')}" aria-label="${tRaw('wanted.feld_rb', { id })}" data-stil="width:8em;max-width:100%;font-size:var(--fs-1);padding:2px 4px;
      border:1px solid var(--feldrand);border-radius:5px"
      data-change="wantedKorrekturNummer" data-i="${i}" /></td>
    <td><select data-change="wantedKorrekturFarbe" data-i="${i}" aria-label="${tRaw('wanted.feld_farbe', { id })}"
      data-stil="max-width:140px;font-size:var(--fs-1);padding:2px;border:1px solid var(--feldrand);border-radius:5px">
      <option value="">${tRaw('wanted.keep')}</option></select></td>
  </tr>`;
}

/** @param {Report} d */
function drawTable(d) {
  const el = G('wanted-xml-tabelle');
  if (!el) return;
  const items = d.posten || [];
  if (!items.length) {
    el.replaceChildren();
    return;
  }
  setzeHtml(
    el,
    html`<table class="dt" aria-label="${tRaw('wanted.preview_title')}" data-stil="font-size:var(--fs-2)"><thead><tr>
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
 * /v1/parts/brick-colors goes over the network the first time; the table shouldn't wait for it. Until
 * then every dropdown shows "unchanged", and that is exactly the right default.
 */
async function fillColorChoices() {
  const colors = await loadBrickColors();
  if (!colors?.length) return;
  const opts = colors
    .map(c => html`<option value="${c.id}" data-hex="${rawHex(c.hex)}">${colorName(c.name)}</option>`)
    .join('');
  for (const sel of /** @type {NodeListOf<HTMLSelectElement>} */ (
    G('wanted-xml-tabelle').querySelectorAll('select[data-change="wantedKorrekturFarbe"]')
  )) {
    const i = Number(sel.dataset.i);
    const chosen = _corrections.get(i)?.rbFarbe;
    setzeHtml(sel, html`<option value="">${tRaw('wanted.keep')}</option>${rawHtml(opts)}`);
    if (chosen !== undefined && chosen !== null) sel.value = String(chosen);
  }
}

/** Remember an entered Rebrickable number (or clear the entry). @this {unknown} */
function wantedKorrekturNummer() {
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
function wantedKorrekturFarbe() {
  const el = this instanceof HTMLInputElement || this instanceof HTMLSelectElement ? this : null;
  if (!el) return;
  const i = Number(el.dataset.i);
  const k = { ..._corrections.get(i) };
  if (el.value === '') delete k.rbFarbe;
  else k.rbFarbe = parseInt(el.value, 10);
  setCorrection(i, k);
}

/**
 * A pre-filled preview field (quantity, condition, purchase price). Its own handler, because it compares
 * against the report instead of checking for empty: typing back the original value takes the correction
 * back.
 * @this {unknown}
 */
function wantedKorrekturWert() {
  const el = this instanceof HTMLInputElement || this instanceof HTMLSelectElement ? this : null;
  if (!el) return;
  const i = Number(el.dataset.i);
  const name = el.dataset.feld;
  const p = _report?.posten?.[i];
  if (!p) return;
  const k = { ..._corrections.get(i) };
  const raw = el.value.trim();

  if (name === 'menge') {
    const m = parseInt(raw, 10);
    // Don't send anything unusable: the server would reject the whole correction, and the color next to it
    // would be lost too. The field shows the current value again instead.
    if (!Number.isFinite(m) || m < 1) {
      el.value = String(k.menge ?? p.menge);
      return;
    }
    if (m === p.menge) delete k.menge;
    else k.menge = m;
  } else if (name === 'zustand') {
    const w = raw === '' ? null : raw;
    if (w === (p.zustand ?? null)) delete k.zustand;
    else k.zustand = w;
  } else if (name === 'kaufpreis') {
    const old = p.maxPreis ?? null;
    /** @type {number | null} */
    let w = null;
    if (raw !== '') {
      const z = Number(raw);
      if (!Number.isFinite(z) || z < 0) {
        el.value = String(k.kaufpreis ?? old ?? '');
        return;
      }
      // 0 means "none", like MAXPRICE=-1 in the file.
      w = z > 0 ? z : null;
    }
    if (w === old) delete k.kaufpreis;
    else k.kaufpreis = w;
  } else return;

  setCorrection(i, k);
}

/** @param {number} i @param {Record<string, string | number | null>} k */
function setCorrection(i, k) {
  if (Object.keys(k).length === 0) _corrections.delete(i);
  else _corrections.set(i, k);
  const button = G('wanted-xml-schreiben');
  if (button) {
    // The count on the button, so it's visible that corrections travel with it — otherwise it stays a
    // promise you can only check afterwards.
    button.textContent = _corrections.size
      ? `${tRaw('settings.wanted_write')} (${_corrections.size})`
      : tRaw('settings.wanted_write');
  }
}

G('wanted-xml-modal')?.addEventListener('click', e => e.target === e.currentTarget && wantedXmlSchliessen());

// Attach the icon here once to all three buttons instead of three times in the HTML. Into its own <span>
// with no data-i18n: the translation sets textContent and would throw it away on a language switch.
for (const el of document.querySelectorAll('[data-wanted-icon]')) setzeHtml(el, XML_ICON_SVG);

// Names below are registry-exposed (data-click/data-change in index.html) — kept unchanged.
registerActions({
  wantedKorrekturFarbe,
  wantedKorrekturWert,
  wantedKorrekturNummer,
  wantedXmlGewaehlt,
  wantedXmlNeuLesen,
  wantedXmlSchliessen,
  wantedXmlSchreiben,
});
