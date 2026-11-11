import type { DbSchnittstelle } from '../../../db/database';

/** Die Stückzahl eines manuellen Eintrags ist die Summe seiner Erfassungen. */
export type ManuelleArt = 'part' | 'fig';
const ERF = { part: 'part_acquisitions', fig: 'minifig_acquisitions' } as const;
const SCHLUESSEL = { part: 'part_number=$2 AND color_id=$3', fig: 'fig_number=$2' } as const;

export async function summeDerErfassungen(db: DbSchnittstelle, art: ManuelleArt, uid: number, schluessel: (string | number)[]): Promise<number> {
  const r = await db.get<{ q: number }>(
    `SELECT COALESCE(SUM(quantity), 0)::int AS q FROM ${ERF[art]} WHERE user_id=$1 AND ${SCHLUESSEL[art]}`,
    [uid, ...schluessel]);
  return Number(r?.q ?? 0);
}

/** Neueste zuerst: Beim Verringern geht das zuletzt Erfasste zuerst. */
export function erfassungenNeuesteZuerst(tx: DbSchnittstelle, art: ManuelleArt, uid: number, schluessel: (string | number)[]) {
  return tx.all<{ id: number; quantity: number }>(
    `SELECT id, quantity FROM ${ERF[art]} WHERE user_id=$1 AND ${SCHLUESSEL[art]} ORDER BY created_at DESC, id DESC`,
    [uid, ...schluessel]);
}

export async function entferneErfassung(tx: DbSchnittstelle, art: ManuelleArt, id: number, konten: number[]): Promise<void> {
  await tx.run(`DELETE FROM ${ERF[art]} WHERE id=$1 AND user_id = ANY($2)`, [id, konten]);
}

export async function kuerzeErfassung(tx: DbSchnittstelle, art: ManuelleArt, id: number, um: number, konten: number[]): Promise<void> {
  await tx.run(`UPDATE ${ERF[art]} SET quantity=quantity-$1 WHERE id=$2 AND user_id = ANY($3)`, [um, id, konten]);
}
