/** Hier, damit keine Route eine andere importiert. */
import { toCsv } from '../infra/csvExport';
import type { InventoryContext } from './kontext';

export async function partsCsv(k: InventoryContext, uid: number) {
  // Kein Rückfall: Scheitert die Abfrage, soll der Fehler sichtbar werden.
  const rows = (await k.bestandExport.partsForCsv(uid)).map(r => ({
    ...r,
    unit_price: r.unit_price ?? '',
  }));

  return toCsv(['part_number', 'quantity', 'color_id', 'color_name', 'unit_price', 'condition', 'acquired_at'], rows);
}

export async function figurenCsv(k: InventoryContext, uid: number) {
  const acqRows = (await k.bestandExport.minifigsForCsv(uid)).map(r => ({
    ...r,
    unit_price: r.unit_price ?? '',
  }));

  return toCsv(['fig_number', 'bl_fig_number', 'quantity', 'unit_price', 'condition', 'acquired_at'], acqRows);
}
