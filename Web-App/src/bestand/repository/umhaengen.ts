import type { DbSchnittstelle } from '../../../db/database';

export type Art = 'part' | 'fig';
const TAB = { part: 'parts', fig: 'minifigs' } as const;
const ERF = { part: 'part_acquisitions', fig: 'minifig_acquisitions' } as const;
const SCHLUESSEL = { part: 'part_number = $2 AND color_id = $3', fig: 'fig_number = $2' } as const;

export type ManuelleErfassung = {
  id: number;
  quantity: number;
  unit_price: number | null;
  condition: string;
  created_at: string;
  price_estimated: boolean;
  currency: string;
};

/** Unter dem Schlüssel der Anfrage: Sonst buchte das Verschieben die Menge einer fremden
 * Position beim Ziel unter dem Schlüssel der Anfrage. */
export function manuelleErfassung(
  tx: DbSchnittstelle,
  art: Art,
  id: number,
  uid: number,
  schluessel: (string | number)[],
) {
  const bedingung = art === 'part' ? 'part_number = $3 AND color_id = $4' : 'fig_number = $3';
  return tx.get<ManuelleErfassung>(
    `SELECT id, quantity, unit_price, COALESCE(condition,'N') AS condition, created_at, price_estimated, currency
       FROM ${ERF[art]} WHERE id = $1 AND user_id = $2 AND ${bedingung}`,
    [id, uid, ...schluessel],
  );
}

export function manuelleZeile(tx: DbSchnittstelle, art: Art, uid: number, schluessel: (string | number)[]) {
  return tx.get<{ id: number; part_number?: string; color_id?: number; fig_number?: string }>(
    `SELECT * FROM ${TAB[art]} WHERE user_id = $1 AND ${SCHLUESSEL[art]} AND COALESCE(source,'set') = 'manual'`,
    [uid, ...schluessel],
  );
}

export async function entferneManuell(
  tx: DbSchnittstelle,
  art: Art,
  uid: number,
  schluessel: (string | number)[],
  zeile: number,
): Promise<void> {
  await tx.run(`DELETE FROM ${ERF[art]} WHERE user_id = $1 AND ${SCHLUESSEL[art]}`, [uid, ...schluessel]);
  await tx.run(`DELETE FROM ${TAB[art]} WHERE id = $1 AND user_id = $2`, [zeile, uid]);
}
