import { registerActions } from './registry.js';
import { colorName, locale, t, tRaw } from '../i18n.js';
import { escHex, esc, html } from './escaping.js';
import { errorMessage, api, apiRaw, stream } from './api.js';
import { imageTag, placeholderContent, imgUrl, thumbUrl } from './images.js';
import { emptyState, ico, G, buttonBusy, queryAll, setHtml } from './dom.js';
import { fieldError, isSetNumber } from './form.js';
import { toast } from './messages.js';
import { buildWantedXmlPieces } from './bricklink-xml.js';

// Safety net for unhandled errors and the temporary parts list. The application is started by
// session.js (startApp), not when loading this module.

// ── PARTS LIST (temporary parts list, resets on page leave) ─────────────────
/**
 * @typedef {{ set_number: string, name: string, unknown?: boolean }} PlSet
 * @typedef {{ part_number: string, bl_part_number: string, part_name: string, color_name: string, color_hex: string | null,
 *   color_id: number, bl_color_id?: number | null, quantity: number, image_local?: string | null, image_url: string | null, is_fig?: boolean }} PlPart
 * @typedef {{ type: string, part: string, color: number | null, colorName?: string, qty: number }} MissingPart
 */
/** The sets of the parts list; it only applies until leaving the page. @type {PlSet[]} */
let _plSets = [];
/** The generated parts list. @type {PlPart[] | null} */
let _plParts = null;
/** Rebrickable → BrickLink color number. @type {Record<string, number>} */
let _rbToBlColor = {};

/** Counts the runs of plGenerate: a fast second addition overtakes the first, and only the last one
 * draws. */
let _plRun = 0;

/** Adding recomputes the list right away: a second step "create" was regularly forgotten. */
async function plAddSet() {
  const raw = G('pl-setnr').value.trim();
  if (!raw) {
    fieldError('pl-setnr', tRaw('common.enter_set_number'));
    return;
  }
  // Support comma-separated input
  const nrs = raw
    .split(',')
    .map(s => s.trim().replace(/\s/g, ''))
    .filter(Boolean);
  const wrong = nrs.filter(nr => !isSetNumber(nr));
  if (wrong.length) {
    fieldError('pl-setnr', tRaw('gallery.add.number_invalid', { num: wrong.join(', ') }));
    return;
  }
  fieldError('pl-setnr', '');
  const names = nrs.map(nr => {
    const normalized = nr.includes('-') ? nr : nr + '-1';
    const entry = { set_number: normalized, name: normalized, unknown: false };
    _plSets.push(entry);
    // Name from the catalog; if it does not know the number, the chip says so instead of silently counting it as a set without parts
    // along.
    return api('GET', `/v2/sets/info/${normalized}`)
      .then(d => {
        if (!d.success) return;
        if (d.name && d.name !== normalized) entry.name = d.name;
        entry.unknown = d.in_catalog === false;
        plRenderSets();
      })
      .catch(() => {});
  });
  G('pl-setnr').value = '';
  G('pl-setnr').focus();
  plRenderSets();
  await Promise.all(names);
  await plGenerate();
}

G('pl-setnr')?.addEventListener('keydown', e => e.key === 'Enter' && plAddSet());

export function plRenderSets() {
  const c = G('pl-sets');
  if (!c) return;
  // Resetting only has something to do once there are sets or a finished list.
  G('btn-pl-reset').disabled = !_plSets.length && !_plParts;
  // Without a set there is nothing to recompute; what to do is said once by the empty state.
  G('btn-pl-gen').hidden = !_plSets.length;
  if (!_plSets.length) {
    setHtml(c, emptyState({ ico: 'list', titleKey: 'pl.no_sets', textKey: 'pl.empty_like' }));
    return;
  }
  setHtml(
    c,
    _plSets.map(
      (s, i) => html`
    <div class="pl-chip${s.unknown ? ' unknown' : ''}">
      <span class="pl-chip-nr">${s.set_number}</span>
      <span class="pl-chip-name">${s.unknown ? html`${'— '}${tRaw('pl.not_in_catalog')}` : s.name !== s.set_number ? html`${'— '}${s.name}` : ''}</span>
      <button type="button" class="pl-chip-remove" data-click="plRemoveSet" data-arg="${i}" aria-label="${tRaw('pl.remove', { set: s.set_number })}">${ico('close')}</button>
    </div>`,
    ),
  );
}
// Call moved to startApp() (js/init.js), which js/main.js calls AFTER all modules have been evaluated.
// In the module body it ran too early: with mutual imports the translation object from i18n.js is then not
// initialized yet, and t() throws.

/**
 * @param {number} i
 */
function plRemoveSet(i) {
  _plSets.splice(i, 1);
  _plParts = null;
  G('pl-result').replaceChildren();
  G('pl-status').textContent = '';
  plExportStatus();
  plRenderSets();
  if (_plSets.length) plGenerate();
}

/** Merging happens by the Rebrickable number, because the inventory is queried by it: several mold
 * variants share one BrickLink number, and merged by it the demand would count twice, the inventory once.
 * @param {Record<string, PlPart>} combined @param {string} setNumber @param {Record<string, number>} rbToBlColor
 * @returns {Promise<boolean>} false when the list could not be read */
async function plAddSetParts(combined, setNumber, rbToBlColor) {
  const d = await api('GET', `/v2/sets/${encodeURIComponent(setNumber)}/parts-list`);
  if (!d.success) return false;
  for (const p of d.parts || []) {
    const key = `${p.part_number}|${p.color_id || 0}`;
    const quantity = parseInt(String(p.total_quantity || 1), 10);
    if (combined[key]) {
      combined[key].quantity += quantity;
      continue;
    }
    combined[key] = {
      part_number: p.part_number,
      bl_part_number: p.bl_part_number || p.part_number,
      part_name: p.part_name || p.part_number,
      color_name: p.color_name || '–',
      color_hex: p.color_hex || null,
      color_id: p.color_id || 0,
      bl_color_id: p.bl_color_id ?? rbToBlColor[p.color_id] ?? null,
      quantity,
      image_local: null,
      image_url: p.image_url || null,
    };
  }
  return true;
}

/** @param {Record<string, PlPart>} combined @param {string} setNumber */
async function plAddSetFigs(combined, setNumber) {
  const dm = await api('GET', `/v2/sets/${encodeURIComponent(setNumber)}/minifigs-list`);
  if (!dm?.success) return;
  for (const f of dm.figs || []) {
    const figQty = parseInt(String(f.quantity || 1), 10);
    const key = `fig:${esc(f.fig_number)}`;
    if (combined[key]) {
      combined[key].quantity += figQty;
      continue;
    }
    combined[key] = {
      part_number: f.fig_number,
      bl_part_number: f.fig_number,
      part_name: f.fig_name || f.fig_number,
      color_name: tRaw('detail.minifigs'),
      color_hex: 'f5a800',
      color_id: 0,
      quantity: figQty,
      image_url: f.image_url || null,
      is_fig: true,
    };
  }
}

/** The RB→BL color mapping from the server (rb_colors.bl_color_id); without it the BL color stays open. */
async function plColorMap() {
  try {
    const cm = await api('GET', '/v2/parts/bl-color-map');
    // The values are color numbers; the contract only names the map as open (Record<string, unknown>).
    if (cm?.success) return /** @type {Record<string, number>} */ (cm.map);
  } catch (_) {}
  return /** @type {Record<string, number>} */ ({});
}

/** @param {number} errors @param {{ set_number: string }[]} known @param {{ set_number: string }[]} unknown */
function plSummary(errors, known, unknown) {
  const parts = (_plParts || []).reduce((s, x) => s + (Number(x.quantity) || 0), 0).toLocaleString(locale());
  return (
    `${tRaw('pl.summary_parts', { n: (_plParts || []).length, parts })} ${tRaw('pl.summary_sets', { n: known.length })}` +
    (errors ? ` (${tRaw('monitor.errors_n', { n: errors })})` : '') +
    (unknown.length
      ? ` · ${tRaw('pl.unknown_n', { n: unknown.length, numbers: unknown.map(s => s.set_number).join(', ') })}`
      : '')
  );
}

async function plGenerate() {
  // A typed number not yet added counts too: "create" should not fail because of a forgotten click.
  if (G('pl-setnr')?.value.trim()) {
    // plAddSet computes by itself; if the number is still in the field afterwards, it was invalid (said at the field).
    await plAddSet();
    return;
  }
  if (!_plSets.length) {
    fieldError('pl-setnr', tRaw('pl.first_set'));
    return;
  }
  const run = ++_plRun;
  G('pl-status').textContent = tRaw('pl.loading_lists');
  G('btn-pl-gen').disabled = true;
  G('pl-result').replaceChildren();
  _plParts = null;
  plExportStatus();

  /** @type {Record<string, PlPart>} key "part number|color" or "fig:number" */
  const combined = {};
  let errors = 0;
  const rbToBlColor = await plColorMap();
  _rbToBlColor = rbToBlColor;

  const known = _plSets.filter(s => !s.unknown),
    unknown = _plSets.filter(s => s.unknown);
  for (const s of known) {
    G('pl-status').textContent = tRaw('pl.loading_set', { set: s.set_number });
    // Use user-independent CSV endpoints (work for all users regardless of import history)
    try {
      if (!(await plAddSetParts(combined, s.set_number, rbToBlColor))) errors++;
    } catch (e) {
      console.error('plGenerate parts error for', s.set_number, e);
      errors++;
    }
    try {
      await plAddSetFigs(combined, s.set_number);
    } catch (e) {
      console.error('plGenerate figs error for', s.set_number, e);
    }
  }

  if (run !== _plRun) return;
  _plParts = Object.values(combined);
  G('pl-status').textContent = plSummary(errors, known, unknown);
  G('btn-pl-gen').disabled = false;
  plRenderTable(errors);
  plExportStatus();
}

/** Writes the owned quantity into every field and counts what is still missing.
 * @param {HTMLInputElement[]} fields @param {Record<string, { loose?: number, total?: number }> | undefined} holding
 * @param {boolean} onlyLose */
function plApplyHoldings(fields, holding, onlyLose) {
  let hit = 0,
    missing = 0,
    missingKinds = 0;
  for (const el of fields) {
    const [num, color] = String(el.dataset.key || '').split('__');
    const entry = holding?.[`${num}|${parseInt(color, 10) || 0}`];
    const have = (entry ? (onlyLose ? entry.loose : entry.total) : 0) ?? 0;
    el.value = String(have);
    if (have > 0) hit++;
    const needs = parseInt(el.dataset.need ?? '', 10) || 0;
    if (have < needs) {
      missing += needs - have;
      missingKinds++;
    }
  }

  return { hit, missing, missingKinds };
}

/**
 * "Can I build this?" fills the existing column "available" from the inventory instead of a second view:
 * two tables would be two places where the calculation drifts apart. The number overwrites manual inputs.
 */
async function plFillStock() {
  const fields = /** @type {HTMLInputElement[]} */ (queryAll('.pl-have-input'));
  if (!fields.length) return;
  const onlyLose = !!G('pl-stock-lose')?.checked;

  // `data-key` is `<rbPartNum>__<rbColorId>` — the Rebrickable notation.
  // Exactly that is also in the own parts table; the BrickLink number next to it is only there for the export
  // and is no good for the reconciliation.
  const parts = fields
    .map(el => {
      const [num, color] = String(el.dataset.key || '').split('__');
      return { part_number: num, color_id: parseInt(color, 10) || 0 };
    })
    .filter(t => t.part_number);

  const b = G('btn-pl-stock');
  const free = buttonBusy(b);
  // The scope comes from THIS view, no longer from the parts tab.
  // `own` and `all` are the names the server knows anyway
  // (src/household/household.ts, parseScopeMode) — so the choice is only a different operation of the same thing,
  // not a second concept next to it.
  const withSubs = !!G('pl-stock-subs')?.checked;
  const d = await api('POST', `/v2/parts/owned${withSubs ? '' : '?accounts=own'}`, { parts: parts });
  free();
  if (!d?.success) {
    toast(d?.error || t('settings.error'), 'error');
    return;
  }

  const { hit, missing, missingKinds } = plApplyHoldings(fields, d.holding, onlyLose);

  const status = G('pl-status');
  if (!status) return;
  if (!hit) status.textContent = tRaw('pl.owned_none');
  else if (!missingKinds) status.textContent = tRaw('pl.owned_complete');
  else
    status.textContent =
      tRaw('pl.owned_filled', { n: hit, m: fields.length }) +
      ' ' +
      tRaw('pl.owned_missing', { n: missing, m: missingKinds });
}

/** Export and inventory only once the list has parts: an empty file helps nobody.
 * On the phone collapsed the first time, so that the result comes first. */
function plExportStatus() {
  const box = G('pl-export'),
    options = /** @type {HTMLDetailsElement | null} */ (document.getElementById('pl-options'));
  if (!box) return;
  const empty = !_plParts?.length;
  box.hidden = empty;
  if (options) {
    options.hidden = empty;
    if (!empty && !options.dataset.decided) {
      options.dataset.decided = '1';
      options.open = !window.matchMedia?.('(max-width: 640px)').matches;
    }
  }
  for (const id of ['btn-pl-pdf', 'btn-pl-bl', 'pl-bl-condition']) G(id).disabled = empty;
}

/** One row of the parts list. @param {PlPart} p */
function plPartRow(p) {
  // Build image source: prefer local cached file, then stored URL, then Rebrickable CDN
  const imgSrc = p.image_url || '';
  const img = imgSrc
    ? imageTag({ src: imgUrl(thumbUrl(imgSrc) || imgSrc, true), alt: '', class: 'image-44', ph: 'teil' })
    : html`<span class="image-ph image-44" aria-hidden="true">${placeholderContent('teil')}</span>`;
  const pkey = `${p.part_number}__${p.color_id || 0}`;
  // No fallback to the Rebrickable color number: that would yield a valid file with the wrong color.
  // Empty means unknown; plExportBricklink leaves such items out and names them.
  const blColorId = p.bl_color_id ?? _rbToBlColor[p.color_id] ?? '';
  return html`<div data-style="display:flex;align-items:center;gap:10px;padding:5px 4px;border-bottom:1px solid var(--bdr)">${img}<span data-style="font-family:monospace;font-size:var(--fs-2);color:var(--b600);min-width:65px;flex-shrink:0" title="Rebrickable: ${p.part_number}">${p.bl_part_number || p.part_number}</span><span data-style="flex:1;font-size:var(--fs-3)">${p.part_name}</span><span data-style="font-weight:700;font-size:var(--fs-3);width:6.5em;text-align:right;flex-shrink:0">×${p.quantity.toLocaleString(locale())}</span><span data-style="width:6.5em;flex-shrink:0;padding-left:6px"><input inputmode="numeric" type="number" min="0" value="0" data-key="${pkey}" data-need="${p.quantity}" data-part="${p.bl_part_number || p.part_number}" data-color="${blColorId}" data-rb-color="${p.color_id || 0}" data-color-name="${p.color_name || ''}" data-type="${(p.bl_part_number || p.part_number || 'P').startsWith('fig-') ? 'M' : 'P'}" class="pl-have-input" aria-label="${tRaw('pl.col_have')}: ${p.bl_part_number || p.part_number} ${p.color_name || ''}" data-style="width:58px;height:28px;border:1px solid var(--field-border);border-radius:5px;padding:0 6px;font-size:var(--fs-2);text-align:center" /></span></div>`;
}

function plRenderTable(error = 0) {
  if (!_plParts?.length) {
    // Name the cause: missing parts lists come from the Rebrickable catalog, not from the input.
    setHtml(
      G('pl-result'),
      emptyState({
        ico: 'warning',
        titleKey: error ? 'pl.empty_error_title' : 'pl.empty_title',
        textKey: error ? 'pl.empty_error_text' : 'pl.empty_text',
        button: { textKey: 'list.again', click: 'plGenerate', ico: 'refresh', kind: 'bs' },
      }),
    );
    return;
  }

  // Group by color
  /** @type {Record<string, { color_name: string, color_hex: string | null, parts: PlPart[] }>} */
  const byColor = {};
  for (const p of _plParts) {
    const k = p.color_name;
    if (!byColor[k]) byColor[k] = { color_name: p.color_name, color_hex: p.color_hex, parts: [] };
    byColor[k].parts.push(p);
  }
  const sorted = Object.values(byColor).sort((a, b) => a.color_name.localeCompare(b.color_name));

  let markup = html``;
  for (const grp of sorted) {
    const colorDot = grp.color_hex
      ? html`<span data-style="display:inline-block;width:14px;height:14px;border-radius:50%;border:1px solid rgba(0,0,0,.15);vertical-align:middle;margin-right:6px" data-color-hex="${escHex(grp.color_hex, 'var(--s300)')}"></span>`
      : '';
    markup = html`${markup}${html`<div data-style="margin-bottom:1.5rem"><div data-style="font-weight:700;font-size:var(--fs-4);padding:6px 0;border-bottom:2px solid var(--b200);margin-bottom:.5rem;color:var(--b700)">${colorDot}${colorName(grp.color_name)} <span data-style="font-weight:400;color:var(--mut);font-size:var(--fs-3)">${tRaw('pl.types', { n: grp.parts.length })}</span></div><div>`}`;
    markup = html`${markup}${html`<div data-style="display:flex;align-items:center;gap:10px;padding:3px 4px;font-size:var(--fs-0);font-weight:700;color:var(--mut);text-transform:uppercase;letter-spacing:.4px;border-bottom:1.5px solid var(--b200)"><span data-style="width:44px;flex-shrink:0"></span><span data-style="min-width:65px;flex-shrink:0">${tRaw('col.nr')}</span><span data-style="flex:1">${tRaw('pl.col_name')}</span><span data-style="width:6.5em;text-align:right;flex-shrink:0;white-space:nowrap">${tRaw('pl.col_needed')}</span><span data-style="width:6.5em;padding-left:6px;flex-shrink:0;white-space:nowrap">${tRaw('pl.col_have')}</span></div>`}`;
    for (const p of grp.parts.sort((a, b) =>
      (a.bl_part_number || a.part_number).localeCompare(b.bl_part_number || b.part_number, undefined, {
        numeric: true,
      }),
    ))
      markup = html`${markup}${plPartRow(p)}`;
    markup = html`${markup}</div></div>`;
  }
  // Summary shown in status bar above table
  setHtml(G('pl-result'), markup);
}

async function plExportPdf() {
  if (!_plParts?.length) return;
  const btn = G('btn-pl-pdf');
  // The release remembers the label instead of setting it anew at the end: here '📄 PDF' stood as a
  // literal, although the button carries a data-i18n in the markup.
  const free = btn ? buttonBusy(btn, tRaw('pdf.creating')) : () => {};
  try {
    const pdfParts = _plParts.map(p => ({
      part_number: p.part_number,
      bl_part_number: p.bl_part_number || p.part_number,
      part_name: p.part_name,
      color_name: p.color_name,
      color_hex: p.color_hex,
      color_id: p.color_id,
      quantity: p.quantity,
      image_url: p.image_url,
      image_local: p.image_local || null,
      is_fig: p.is_fig || false,
    }));

    // Step 1: start the async PDF job
    const startResp = await apiRaw('POST', '/v2/sets/partslist-pdf', { body: { sets: _plSets, parts: pdfParts } });
    if (!startResp.ok) throw new Error(`HTTP ${startResp.status}`);
    const { jobId } = await startResp.json();
    if (!jobId) throw new Error(tRaw('pdf.no_job_id'));

    // Step 2: SSE instead of polling — the result comes immediately when finished. Fallback to polling if EventSource
    // is not available.
    if (btn) btn.textContent = tRaw('pdf.loading_images');
    await /** @type {Promise<void>} */ (
      new Promise((resolve, reject) => {
        let settled = false;
        // Countdown of the estimated remaining time (from etaSeconds from the server).
        /** @type {number | null} */
        let etaTimer = null;
        /** @type {number} */
        let etaRemaining = 0;
        const stopEta = () => {
          if (etaTimer) {
            clearInterval(etaTimer);
            etaTimer = null;
          }
        };
        const startEta = (/** @type {number} */ sec) => {
          if (etaTimer || !sec || sec <= 0) return;
          etaRemaining = sec;
          const tick = () => {
            if (btn)
              btn.textContent = etaRemaining > 0 ? tRaw('pdf.eta', { sec: etaRemaining }) : tRaw('pdf.almost_done');
            if (etaRemaining > 0) etaRemaining--;
          };
          tick();
          etaTimer = setInterval(tick, 1000);
        };
        const finish = (/** @type {string | null} */ err) => {
          stopEta();
          if (!settled) {
            settled = true;
            err ? reject(new Error(err)) : resolve();
          }
        };

        const trySSE = () => {
          const s = stream(`/v2/sets/partslist-pdf/stream/${jobId}`, {
            event: ({ status, error, etaSeconds }) => {
              if (status === 'running' && etaSeconds != null) startEta(etaSeconds);
              if (status === 'done') {
                s?.close();
                finish(null);
              } else if (status === 'error') {
                s?.close();
                finish(error || tRaw('pdf.server_error'));
              }
            },
            error: () => {
              if (!settled) pollPdfStatus(jobId, btn, finish, startEta);
            },
          });
          if (!s) pollPdfStatus(jobId, btn, finish, startEta);
        };
        trySSE();
      })
    );

    // Step 3: Download
    const dlResp = await apiRaw('GET', `/v2/sets/partslist-pdf/download/${jobId}`);
    if (!dlResp.ok) throw new Error(tRaw('pdf.download_error', { status: dlResp.status }));
    const blob = await dlResp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'parts-list.pdf';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast(tRaw('pdf.created'), 'success');
  } catch (e) {
    console.error('PDF error:', e);
    toast(tRaw('pdf.error_prefix') + ' ' + errorMessage(e), 'error');
  } finally {
    free();
  }
}

// Polling fallback for the PDF export (only if EventSource is not available).
/**
 * @param {string} jobId @param {HTMLElement | null} _btn
 * @param {(err: string | null) => void} finish @param {(sec: number) => void} startEta
 */
async function pollPdfStatus(jobId, _btn, finish, startEta) {
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1500));
    try {
      const r = await apiRaw('GET', `/v2/sets/partslist-pdf/status/${jobId}`);
      // An error status (job unknown, server gone) ends the waiting right away.
      if (!r.ok) {
        finish(tRaw('pdf.server_error'));
        return;
      }
      const { status, error, etaSeconds } = await r.json();
      if (status === 'running' && etaSeconds != null && startEta) startEta(etaSeconds);
      if (status === 'done') {
        finish(null);
        return;
      }
      if (status === 'error') {
        finish(error || t('pdf.server_error'));
        return;
      }
    } catch (e) {
      finish(errorMessage(e));
      return;
    }
  }
  finish(tRaw('pdf.timeout'));
}

export function plInit() {
  plRenderSets();
}

/** What is missing according to the table (demand minus available), with BrickLink color. */
function missingParts() {
  // Collect all fields "available" from the table
  const inputs = /** @type {HTMLInputElement[]} */ (queryAll('.pl-have-input'));
  /** @type {MissingPart[]} */
  const missing = [];
  inputs.forEach(inp => {
    const need = parseInt(inp.dataset.need ?? '', 10) || 0;
    const have = parseInt(inp.value, 10) || 0;
    const diff = need - have;
    if (diff > 0) {
      const rbColor = parseInt(inp.dataset.rbColor ?? '', 10) || 0;
      // `data-color` is empty if the catalog knows no BrickLink color
      // (see plRenderTable). The map is asked once more, because it may not yet have been loaded when the table
      // was drawn.
      const raw = inp.dataset.color;
      const fromCard = _rbToBlColor[rbColor];
      const blColor = fromCard ?? (raw === '' || raw === undefined ? null : parseInt(raw, 10));
      missing.push({
        type: inp.dataset.type || 'P',
        part: inp.dataset.part ?? '',
        color: blColor != null && Number.isFinite(blColor) ? blColor : null,
        colorName: inp.dataset.colorName || '',
        qty: diff,
      });
    }
  });
  return missing;
}

/** @param {Record<string, MissingPart>} blMap @param {string} key @param {MissingPart} item */
function addMissing(blMap, key, item) {
  const there = blMap[key];
  if (there) there.qty += item.qty;
  else blMap[key] = item;
}

/** The parts of a minifig; false if they could not be read (then the whole figure goes on the list).
 * @param {Record<string, MissingPart>} blMap @param {MissingPart} m */
async function addMinifigParts(blMap, m) {
  try {
    const dp = await api('GET', `/v2/minifigs/${encodeURIComponent(m.part)}/parts`);
    if (!dp?.success || !dp.parts?.length) return false;
    // MinifigParts does not name the fields of a row; this is how src/minifigs delivers them.
    const parts =
      /** @type {{ part_number: string, bl_part_number?: string | null, color_id: number, bl_color_id?: number | null, quantity?: number }[]} */ (
        dp.parts
      );
    for (const p of parts) {
      const blNum = p.bl_part_number || p.part_number;
      // The same rule as in the table: no mapping means UNKNOWN, not "take the
      // Rebrickable number".
      const blColId = p.bl_color_id ?? _rbToBlColor[p.color_id] ?? null;
      const qty = parseInt(String(p.quantity || 1), 10) * m.qty;
      addMissing(blMap, `P|${blNum}|${blColId}`, { type: 'P', part: blNum, color: blColId, qty });
    }
    return true;
  } catch (_) {
    return false;
  }
}

/** Resolve figures into their parts and add up identical BrickLink number+color.
 * @param {MissingPart[]} missing @returns {Promise<MissingPart[]>} */
async function resolveMinifigs(missing) {
  // Expand minifigs into individual parts and deduplicate by BL-ID + color
  /** @type {Record<string, MissingPart>} key "kind|part number|color" */
  const blMap = {};
  for (const m of missing) {
    if (m.type !== 'M') addMissing(blMap, `P|${m.part}|${m.color || 0}`, { ...m });
    else if (!(await addMinifigParts(blMap, m)))
      // Fallback: add whole minifig
      addMissing(blMap, `M|${m.part}|0`, { type: 'M', part: m.part, color: 0, qty: m.qty });
  }
  return Object.values(blMap);
}

/** One chunk in a new tab (for copying), several as downloads. @param {string[]} pieces */
function deliverWantedXml(pieces) {
  if (pieces.length === 1) {
    const blob = new Blob([pieces[0]], { type: 'text/plain; charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const tab = window.open(url, '_blank');
    if (!tab) {
      const a = document.createElement('a');
      a.href = url;
      a.download = 'bricklink-wanted.xml';
      a.click();
      toast(tRaw('pdf.popup_blocked'), 'info');
    } else {
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  } else {
    for (const [i, part] of pieces.entries()) {
      const url = URL.createObjectURL(new Blob([part], { type: 'text/plain; charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `bricklink-wanted-${i + 1}.xml`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  }
}

async function plExportBricklink() {
  // Ensure BL color mapping is loaded (may be empty if plGenerate was called before sync)
  if (!Object.keys(_rbToBlColor).length) {
    try {
      const cm = await api('GET', '/v2/parts/bl-color-map');
      if (cm?.success && cm.map) _rbToBlColor = /** @type {Record<string, number>} */ (cm.map);
    } catch (_) {}
  }
  const condition = G('pl-bl-condition')?.value || 'X';
  const missing = missingParts();
  if (!missing.length) {
    toast(tRaw('pl.none_missing'), 'info');
    return;
  }

  const expanded = await resolveMinifigs(missing);

  // Items without a known BrickLink color do not go along, they are named: a guessed color orders
  // the wrong part, and one only notices at the parcel. Figures (type M) have no color and are never
  // affected.
  const withoutColor = expanded.filter(m => m.type !== 'M' && (m.color === null || m.color === undefined));
  const exportable = expanded.filter(m => !withoutColor.includes(m));

  const pieces = buildWantedXmlPieces(exportable.map(m => ({ ...m, condition })));

  // BrickLink rejects a file above BL_UPLOAD_MAX_BYTES entirely. One chunk opens in the tab for copying as
  // before; several are downloaded — one tab per chunk would be a popup storm.
  deliverWantedXml(pieces);

  toast(tRaw('pl.bl_exported', { n: exportable.length }), 'success');
  if (pieces.length > 1) toast(tRaw('pl.bl_split', { n: pieces.length }), 'info');
  // Last and as a message of its own, so that it does not get lost next to the success message: what is missing has to be
  // read.
  if (withoutColor.length) {
    toast(
      tRaw('pl.bl_no_color', {
        n: withoutColor.length,
        list:
          withoutColor
            .slice(0, 5)
            .map(m => (m.colorName ? `${m.part} (${m.colorName})` : m.part))
            .join(', ') + (withoutColor.length > 5 ? ' …' : ''),
      }),
      'error',
    );
  }
}

function plReset() {
  _plSets = [];
  _plParts = null;
  G('pl-result').replaceChildren();
  G('pl-status').textContent = '';
  plExportStatus();
  plRenderSets();
}

// ── Register handlers with the dispatcher (see js/registry.js) ─────────────
/**
 * View choice cards/table for parts and minifigures: the same buttons as for the sets. The value still lives
 * in the (hidden) select field on which the load and draw logic depends.
 * @param {string} id
 * @param {string} value
 */
function chooseView(id, value) {
  const field = G(id);
  if (!field || field.value === value) return;
  field.value = value;
  queryAll(`[data-click="chooseView"][data-arg="${id}"]`).forEach(b => {
    const on = b.dataset.arg2 === value;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  field.dispatchEvent(new Event('change', { bubbles: true }));
}

registerActions({
  chooseView,
  plAddSet,
  plExportBricklink,
  plExportPdf,
  plFillStock,
  plGenerate,
  plRemoveSet,
  plReset,
});

/**
 * Reset the parts list state (on logout).
 *
 * Imported bindings are read-only in ES modules. The function keeps the knowledge of what "empty" means for
 * this state where the state is defined.
 */
export function resetPartsList() {
  _plParts = null;
  _plSets = [];
}
