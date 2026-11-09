import { schliesseErfassen, csvHochladen } from './01-bausteine.js';
import { registerActions } from './00-registry.js';
import { colorName, t, tRaw } from '../i18n.js';
import { hexZiffern, html } from './00-escapen.js';
import { api } from './01-api.js';
import { G, setzeHtml } from './01-dom.js';
import { betragAusFeld, mengeAusFeld, kaufdatumGueltig } from './01-formular.js';
import { toast } from './01-meldungen.js';
import { csvImportStatus, preisHerkunftHinweis } from './06-minifigs.js';
import { leereLagerortFeld, selectedOwner, selectedStorage } from './02-konten-orte.js';
import { loadManualParts } from './03-parts.js';

// Ein Teil von Hand erfassen: Formular oben im Teile-Reiter, Farbauswahl und CSV-Import.
/** @typedef {import('../../frontend-typen/vertrag').BrickColor} Steinfarbe */
// Inline add-part form (zuoberst im Teile-Tab)
/** @type {Steinfarbe[]} */
let _brickColors = [];

export async function loadBrickColors(){
  if(_brickColors.length) return _brickColors;
  const d = await api('GET','/v1/parts/brick-colors');
  if(d.success){ _brickColors=d.colors; renderColorDropdown(); }
  return _brickColors;
}

function updateColorDot(){
  const sel = G('ap-color-select');
  const dot = G('ap-color-dot');
  if(!sel||!dot) return;
  const hex = sel.options[sel.selectedIndex]?.dataset.hex;
  dot.style.background = hex ? '#'+hex : 'var(--s200)';
}

function renderColorDropdown(){
  const sel = G('ap-color-select'); if(!sel) return;
  // data-name bleibt der englische Rebrickable-Name — er wird beim Speichern als parts.color_name übernommen
  // und für BrickLink-Abgleiche gebraucht. Übersetzt wird nur der sichtbare Text, mit derselben Funktion wie
  // die Farbanzeige und der Filter im Teile-Reiter.
  setzeHtml(sel, html`${html`<option value="">${tRaw('parts.no_color_dash')}</option>`}${_brickColors.map(c=>html`<option value="${c.id}" data-name="${(c.name||'').replace(/"/g,'&quot;')}" data-hex="${hexZiffern(c.hex)}">${colorName(c.name)}</option>`)}`);
}

G('btn-add-part')?.addEventListener('click', async () => {
  const num = G('ap-num-inline')?.value.trim();
  const res = G('ap-inline-result');
  res.style.color = 'var(--r500)';
  if(!num){ res.textContent=tRaw('parts.number_required'); return; }
  const colorSel = G('ap-color-select');
  // „Keine Farbe“ ist null, nicht 0: 0 ist bei Rebrickable Schwarz. Mit 0 für beides suchte der Server für
  // schwarze Teile kein Farbbild und zeigte das allgemeine, meist weisse.
  // Ausführlich: docs/begruendungen/public/js/03-teil-erfassen.js.md#rawcolor
  const rawColor = colorSel?.value ?? '';
  const colorId  = String(rawColor).trim() === '' ? null : (parseInt(rawColor) || 0);
  const colorOpt  = colorSel?.options[colorSel.selectedIndex];
  const colorName = colorOpt?.dataset.name || null;
  const colorHex  = colorOpt?.dataset.hex  || null;
  const preis = betragAusFeld('ap-price-inline');
  const datumOk = kaufdatumGueltig('ap-date');
  const menge = mengeAusFeld('ap-qty-inline');
  if (!preis.ok || !menge.ok || !datumOk) return;
  const btn = G('btn-add-part'); btn.disabled=true; btn.textContent='…';
  res.style.color='var(--mut)'; res.textContent=tRaw('adding.progress');
  const d = await api('POST','/v1/parts',{
    part_number: num, color_id: colorId, color_name: colorName, color_hex: colorHex,
    quantity: menge.wert,
    unit_price: preis.wert,
    condition: G('ap-condition')?.value || 'N',
    acquired_at: G('ap-date')?.value || null,
    owner_user_id: selectedOwner('ap-owner'),
    storage: selectedStorage('ap-storage'),
  });
  btn.disabled=false; btn.textContent=tRaw('gallery.add.submit');
  if(d.success){
    const hinweisT = preisHerkunftHinweis(d.price_from_condition);
    res.style.color='var(--g700)';
    res.textContent=`${d.part_number} ${d.action==='added'?t('common.added'):t('common.updated')}`
      + (hinweisT ? ` — ${hinweisT}` : '');
    schliesseErfassen('part'); toast(res.textContent.replace(/^\u2705\s*/, ''), 'success');
    G('ap-num-inline').value=''; G('ap-qty-inline').value='1'; G('ap-price-inline').value=''; G('ap-date').value='';
    leereLagerortFeld('ap-storage');
    if(colorSel) colorSel.selectedIndex=0;
    loadManualParts();
    // Siehe die Figuren-Erfassung darueber: ein Satz braucht laenger als ein Haekchen.
    setTimeout(()=>{ res.textContent=''; }, hinweisT ? 9000 : 3000);
  } else { res.style.color='var(--r500)'; res.textContent=d.error||tRaw('settings.error'); }
});

// CSV import
async function importPartsCsv() {
  const d = await csvHochladen({ feld: 'part-csv-file', pfad: '/v1/parts/import/csv',
    zeige: (l) => csvImportStatus('part-csv-status', l ? 'running' : 'hide', tRaw('import.running')) });
  if (d) loadManualParts();
}

G('btn-csv-template').onclick = (e) => {
  e.preventDefault();
  const csv = 'part_number,quantity,color_id,color_name,unit_price,condition,acquired_at\n3001,5,4,Red,,N,2024-01-15\n3003,2,0,White,0.15,U,\n';
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'parts-template.csv';
  a.click();
};

// ── Handler beim Dispatcher anmelden (siehe js/00-registry.js) ──────────────
registerActions({
  importPartsCsv,
  updateColorDot,
});
