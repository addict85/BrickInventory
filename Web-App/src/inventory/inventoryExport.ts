/** Here, so that no route imports another. */
import { toCsv } from '../infra/csvExport';
import type { InventoryContext } from './context';

export async function partsCsv(k: InventoryContext, uid: number) {
  // No fallback: if the query fails, the error should become visible.
  const rows = (await k.bestandExport.partsForCsv(uid)).map(r => ({
    ...r,
    unit_price: r.unit_price ?? '',
  }));

  return toCsv(['part_number', 'quantity', 'color_id', 'color_name', 'unit_price', 'condition', 'acquired_at'], rows);
}

export async function minifigsCsv(k: InventoryContext, uid: number) {
  const acqRows = (await k.bestandExport.minifigsForCsv(uid)).map(r => ({
    ...r,
    unit_price: r.unit_price ?? '',
  }));

  return toCsv(['fig_number', 'bl_fig_number', 'quantity', 'unit_price', 'condition', 'acquired_at'], acqRows);
}
