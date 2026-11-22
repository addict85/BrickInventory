import { closeCapture, uploadCsv } from './components.js';
import { registerActions } from './registry.js';
import { colorName, t, tRaw } from '../i18n.js';
import { rawHex, html } from './escaping.js';
import { api } from './api.js';
import { G, setHtml } from './dom.js';
import { amountFromField, quantityFromField, purchaseDateValid } from './form.js';
import { toast } from './messages.js';
import { csvImportStatus, priceOriginHint } from './minifigs.js';
import { emptyLocationField, selectedOwner, selectedStorage } from './account-locations.js';
import { loadManualParts } from './parts.js';

// Capture a part by hand: form at the top of the parts tab, color selection and CSV import.
/** @typedef {import('../../frontend-types/contract').BrickColor} BrickColor */
// Inline add-part form (at the very top of the parts tab)
/** @type {BrickColor[]} */
let _brickColors = [];

export async function loadBrickColors() {
  if (_brickColors.length) return _brickColors;
  const d = await api('GET', '/v2/parts/brick-colors');
  if (d.success) {
    _brickColors = d.colors;
    renderColorDropdown();
  }
  return _brickColors;
}

function updateColorDot() {
  const sel = G('ap-color-select');
  const dot = G('ap-color-dot');
  if (!sel || !dot) return;
  const hex = sel.options[sel.selectedIndex]?.dataset.hex;
  dot.style.background = hex ? '#' + hex : 'var(--s200)';
}

function renderColorDropdown() {
  const sel = G('ap-color-select');
  if (!sel) return;
  // data-name stays the English Rebrickable name — it is adopted as parts.color_name when saving
  // and needed for BrickLink reconciliations. Only the visible text is translated, with the same function as
  // the color display and the filter in the parts tab.
  setHtml(
    sel,
    html`${html`<option value="">${tRaw('parts.no_color_dash')}</option>`}${_brickColors.map(c => html`<option value="${c.id}" data-name="${(c.name || '').replace(/"/g, '&quot;')}" data-hex="${rawHex(c.hex)}">${colorName(c.name)}</option>`)}`,
  );
}

G('btn-add-part')?.addEventListener('click', async () => {
  const num = G('ap-num-inline')?.value.trim();
  const res = G('ap-inline-result');
  res.style.color = 'var(--r500)';
  if (!num) {
    res.textContent = tRaw('parts.number_required');
    return;
  }
  const colorSel = G('ap-color-select');
  // "No color" is null, not 0: 0 is black at Rebrickable. With 0 for both, the server looked for
  // no color image for black parts and showed the generic one, mostly white.
  const rawColor = colorSel?.value ?? '';
  const colorId = String(rawColor).trim() === '' ? null : parseInt(rawColor, 10) || 0;
  const colorOpt = colorSel?.options[colorSel.selectedIndex];
  const colorName = colorOpt?.dataset.name || null;
  const colorHex = colorOpt?.dataset.hex || null;
  const price = amountFromField('ap-price-inline');
  const dateOk = purchaseDateValid('ap-date');
  const quantity = quantityFromField('ap-qty-inline');
  if (!price.ok || !quantity.ok || !dateOk) return;
  const btn = G('btn-add-part');
  btn.disabled = true;
  btn.textContent = '…';
  res.style.color = 'var(--mut)';
  res.textContent = tRaw('adding.progress');
  const d = await api('POST', '/v2/parts', {
    part_number: num,
    color_id: colorId,
    color_name: colorName,
    color_hex: colorHex,
    quantity: quantity.value,
    unit_price: price.value,
    condition: G('ap-condition')?.value || 'N',
    acquired_at: G('ap-date')?.value || null,
    owner_user_id: selectedOwner('ap-owner'),
    storage: selectedStorage('ap-storage'),
  });
  btn.disabled = false;
  btn.textContent = tRaw('gallery.add.submit');
  if (d.success) {
    const hintT = priceOriginHint(d.price_from_condition);
    res.style.color = 'var(--g700)';
    res.textContent =
      `${d.part_number} ${d.action === 'added' ? t('common.added') : t('common.updated')}` +
      (hintT ? ` — ${hintT}` : '');
    closeCapture('part');
    toast(res.textContent.replace(/^\u2705\s*/, ''), 'success');
    G('ap-num-inline').value = '';
    G('ap-qty-inline').value = '1';
    G('ap-price-inline').value = '';
    G('ap-date').value = '';
    emptyLocationField('ap-storage');
    if (colorSel) colorSel.selectedIndex = 0;
    loadManualParts();
    // See the figure capture above: a sentence takes longer than a check mark.
    setTimeout(
      () => {
        res.textContent = '';
      },
      hintT ? 9000 : 3000,
    );
  } else {
    res.style.color = 'var(--r500)';
    res.textContent = d.error || tRaw('settings.error');
  }
});

// CSV import
async function importPartsCsv() {
  const d = await uploadCsv({
    field: 'part-csv-file',
    path: '/v2/parts/import/csv',
    show: l => csvImportStatus('part-csv-status', l ? 'running' : 'hide', tRaw('import.running')),
  });
  if (d) loadManualParts();
}

G('btn-csv-template').onclick = e => {
  e.preventDefault();
  const csv =
    'part_number,quantity,color_id,color_name,unit_price,condition,acquired_at\n3001,5,4,Red,,N,2024-01-15\n3003,2,0,White,0.15,U,\n';
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'parts-template.csv';
  a.click();
};

// ── Register handlers with the dispatcher (see js/registry.js) ─────────────
registerActions({
  importPartsCsv,
  updateColorDot,
});
