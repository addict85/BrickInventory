import type { DbSchnittstelle } from '../../../db/database';

/** Datenzugriff zum Verschieben eines Sets oder Kaufpreises zwischen Konten. */

export type Inhalt = 'parts' | 'minifigs' | 'instructions';

export async function hatInhalt(tx: DbSchnittstelle, tabelle: Inhalt, uid: number, sn: string): Promise<boolean> {
  return !!await tx.get(`SELECT 1 AS ok FROM ${tabelle} WHERE user_id=$1 AND set_number=$2 LIMIT 1`, [uid, sn]);
}

/**
 * Nur Schlüssel und Herkunft: Beschreibung, BrickLink-Nummer und Stückzahl
 * stehen im Katalog und hängen an keinem Konto.
 */
export async function kopiereInhalt(tx: DbSchnittstelle, tabelle: Inhalt, sn: string, von: number, nach: number): Promise<number> {
  const sql = {
    parts: `INSERT INTO parts (user_id, set_number, part_number, color_id, source)
            SELECT $1, set_number, part_number, color_id, source FROM parts
             WHERE user_id = $2 AND set_number = $3 AND COALESCE(source,'set') <> 'manual'`,
    minifigs: `INSERT INTO minifigs (user_id, set_number, fig_number, source)
               SELECT $1, set_number, fig_number, source FROM minifigs
                WHERE user_id = $2 AND set_number = $3 AND COALESCE(source,'set') <> 'manual'`,
    instructions: `INSERT INTO instructions (user_id, set_number, url, description, local_path)
                   SELECT $1, set_number, url, description, local_path
                     FROM instructions WHERE user_id = $2 AND set_number = $3`,
  }[tabelle];
  return (await tx.run(sql, [nach, von, sn])).changes ?? 0;
}

/** Spalten ausgeschrieben: Ein Stern verliert still eine gelöschte Spalte. */
export function setZeile(tx: DbSchnittstelle, uid: number, sn: string) {
  return tx.get<{ id: number; added_at: string }>(
    'SELECT id, user_id, set_number, added_at, updated_at, storage_id FROM sets WHERE user_id=$1 AND set_number=$2',
    [uid, sn]);
}

export type SetErfassung = {
  id: number; quantity: number; purchase_price: number | null; condition: string;
  created_at: string; price_estimated: boolean; currency: string;
};

export function erfassungenZumVerschieben(tx: DbSchnittstelle, uid: number, sn: string): Promise<SetErfassung[]> {
  return tx.all(
    `SELECT id, quantity, purchase_price, COALESCE(condition,'N') AS condition, created_at, price_estimated, currency
       FROM set_acquisitions WHERE user_id=$1 AND set_number=$2
      ORDER BY created_at ASC, id ASC`, [uid, sn]);
}

export async function legeSetAn(tx: DbSchnittstelle, uid: number, sn: string, addedAt: string): Promise<void> {
  await tx.run('INSERT INTO sets (user_id, set_number, added_at) VALUES ($1,$2,$3)', [uid, sn, addedAt]);
}

export async function loescheSetErfassung(tx: DbSchnittstelle, id: number): Promise<void> {
  await tx.run('DELETE FROM set_acquisitions WHERE id=$1', [id]);
}

/** Das Set samt Inhalt beim Absender; manuelle Teile und Figuren bleiben. */
export async function entferneSet(tx: DbSchnittstelle, uid: number, sn: string): Promise<void> {
  for (const t of ['parts', 'minifigs'])
    await tx.run(`DELETE FROM ${t} WHERE user_id=$1 AND set_number=$2 AND COALESCE(source,'set') <> 'manual'`, [uid, sn]);
  await tx.run('DELETE FROM instructions WHERE user_id=$1 AND set_number=$2', [uid, sn]);
  await tx.run('DELETE FROM set_acquisitions WHERE user_id=$1 AND set_number=$2', [uid, sn]);
  await tx.run('DELETE FROM sets WHERE user_id=$1 AND set_number=$2', [uid, sn]);
}

// ── Manuelle Teile und Figuren ──────────────────────────────────────────────

export type Art = 'part' | 'fig';
const TAB = { part: 'parts', fig: 'minifigs' } as const;
const ERF = { part: 'part_acquisitions', fig: 'minifig_acquisitions' } as const;
const SCHLUESSEL = { part: 'part_number = $2 AND color_id = $3', fig: 'fig_number = $2' } as const;

export type ManuelleErfassung = {
  id: number; quantity: number; unit_price: number | null; condition: string;
  created_at: string; price_estimated: boolean; currency: string;
};

export function manuelleErfassung(tx: DbSchnittstelle, art: Art, id: number, uid: number) {
  return tx.get<ManuelleErfassung>(
    `SELECT id, quantity, unit_price, COALESCE(condition,'N') AS condition, created_at, price_estimated, currency
       FROM ${ERF[art]} WHERE id = $1 AND user_id = $2`, [id, uid]);
}

export function manuelleZeile(tx: DbSchnittstelle, art: Art, uid: number, schluessel: (string | number)[]) {
  return tx.get<{ id: number; part_number?: string; color_id?: number; fig_number?: string }>(
    `SELECT * FROM ${TAB[art]} WHERE user_id = $1 AND ${SCHLUESSEL[art]} AND COALESCE(source,'set') = 'manual'`,
    [uid, ...schluessel]);
}

export async function erfassteMenge(tx: DbSchnittstelle, art: Art, uid: number, schluessel: (string | number)[]): Promise<number> {
  const r = await tx.get<{ summe: number }>(
    `SELECT COALESCE(SUM(quantity), 0)::int AS summe FROM ${ERF[art]} WHERE user_id = $1 AND ${SCHLUESSEL[art]}`,
    [uid, ...schluessel]);
  return Number(r?.summe ?? 0);
}

/** Ohne Menge: Sie entsteht aus der Erfassung, die gleich mitwandert. */
export async function legeManuellAn(tx: DbSchnittstelle, art: Art, uid: number, schluessel: (string | number)[]): Promise<void> {
  if (art === 'part')
    await tx.run(`INSERT INTO parts (user_id, part_number, color_id, source) VALUES ($1,$2,$3,'manual')`, [uid, ...schluessel]);
  else
    await tx.run(`INSERT INTO minifigs (user_id, fig_number, source) VALUES ($1,$2,'manual')`, [uid, ...schluessel]);
}

export async function loescheManuelleErfassung(tx: DbSchnittstelle, art: Art, id: number): Promise<void> {
  await tx.run(`DELETE FROM ${ERF[art]} WHERE id = $1`, [id]);
}

export async function entferneManuell(tx: DbSchnittstelle, art: Art, uid: number, schluessel: (string | number)[], zeile: number): Promise<void> {
  await tx.run(`DELETE FROM ${ERF[art]} WHERE user_id = $1 AND ${SCHLUESSEL[art]}`, [uid, ...schluessel]);
  await tx.run(`DELETE FROM ${TAB[art]} WHERE id = $1`, [zeile]);
}
