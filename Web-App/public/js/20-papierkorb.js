import { registerActions } from './00-registry.js';
import { locale, t, tRaw } from '../i18n.js';
import { fmtDatum, ico, G, api, esc, toast } from './01-core.js';
import { confirmDelete } from './07-admin.js';
import { loadGallery, loadStats } from './02-gallery.js';
import { loadParts } from './03-parts.js';
import { loadManualFigsTable, loadManualParts, loadMinifigs } from './06-minifigs.js';

// ═══ Papierkorb (Einstellungen → Daten) ═════════════════════════════════════
// Der Server legt beim Löschen einen Schnappschuss ab (src/bestand/papierkorb.ts);
// hier wird er angezeigt, zurückgeholt oder endgültig entfernt.

const ICON = { set: 'set', teil: 'teil', figur: 'figur' };

function zeile(e) {
  const frist = fmtDatum(e.endgueltig_am);
  return `<div class="pk-zeile">
    <span aria-hidden="true">${ico(ICON[e.art] || 'loeschen')}</span>
    <span class="pk-name"><span class="pk-nr">${esc(e.nummer)}</span>
      ${e.bezeichnung ? ' · ' + esc(e.bezeichnung) : ''}
      ${e.anzahl > 1 ? ` · ${e.anzahl}×` : ''}</span>
    <span class="pk-frist">${esc(tRaw('trash.until', { datum: frist }))}</span>
    <button class="btn bs btn-sm" data-click="papierkorbWiederherstellen" data-arg="${e.id}">${t('trash.restore')}</button>
    <button class="btn bd btn-sm" data-click="papierkorbEndgueltig" data-arg="${e.id}">${t('trash.delete_final')}</button>
  </div>`;
}

export async function ladePapierkorb() {
  const liste = G('papierkorb-liste');
  if (!liste) return;
  const d = await api('GET', '/v1/papierkorb');
  const leeren = G('papierkorb-leeren');
  if (!d?.success) { liste.innerHTML = `<div class="voucher-leer">${t('trash.load_error')}</div>`; return; }
  const eintraege = d.eintraege || [];
  liste.innerHTML = eintraege.length
    ? eintraege.map(zeile).join('')
    : `<div class="voucher-leer">${t('trash.empty')}</div>`;
  if (leeren) leeren.style.display = eintraege.length ? '' : 'none';
}

/** Alles nachladen, was ein Wiederherstellen verändert haben kann. */
function bestandNeuLaden() {
  loadGallery(); loadParts(); loadStats(); loadMinifigs(); loadManualParts(); loadManualFigsTable();
}

async function wiederherstellen(ids) {
  for (const id of ids) {
    const d = await api('POST', `/v1/papierkorb/${id}/wiederherstellen`);
    if (!d?.success) { toast(d?.error || tRaw('settings.error'), 'error'); return false; }
  }
  return true;
}

export async function papierkorbWiederherstellen(id) {
  if (!await wiederherstellen([id])) return;
  toast(tRaw('trash.restored'), 'success');
  bestandNeuLaden();
  await ladePapierkorb();
}

export async function papierkorbEndgueltig(id) {
  if (!await confirmDelete(tRaw('trash.delete_final'), t('common.delete_text'))) return;
  const d = await api('DELETE', `/v1/papierkorb/${id}`);
  if (!d?.success) { toast(d?.error || tRaw('settings.error'), 'error'); return; }
  await ladePapierkorb();
}

export async function papierkorbLeeren() {
  if (!await confirmDelete(tRaw('trash.clear'), t('trash.clear_confirm'))) return;
  const d = await api('DELETE', '/v1/papierkorb');
  if (!d?.success) { toast(d?.error || tRaw('settings.error'), 'error'); return; }
  await ladePapierkorb();
}

/**
 * Die Erfolgsmeldung nach dem Löschen, mit „Rückgängig".
 * @param {string} meldung
 * @param {{papierkorb?: number[]}} antwort die Antwort des DELETE
 */
export function geloeschtMitRueckgaengig(meldung, antwort) {
  const ids = antwort?.papierkorb || [];
  toast(meldung, 'success', ids.length ? {
    text: tRaw('trash.undo'),
    fn: async () => {
      if (!await wiederherstellen(ids)) return;
      toast(tRaw('trash.restored'), 'success');
      bestandNeuLaden();
    },
  } : undefined);
}

registerActions({ papierkorbWiederherstellen, papierkorbEndgueltig, papierkorbLeeren });
