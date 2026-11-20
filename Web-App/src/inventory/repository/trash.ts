import type { DbInterface } from '../../../db/database';
import type { InventoryReadContract } from '../readContract';
import { teilSichtJoin, figurSichtJoin, TEIL, FIGUR } from '../../../db/katalogSicht';

/** Ein Eintrag hält die gelöschten Zeilen aller Tabellen eines Bestands als
 * JSON; Wiederherstellen schreibt sie Spalte für Spalte zurück. */
export type PaperKind = 'set' | 'teil' | 'figur';

/** Die erste Tabelle ist die Stammzeile. */
const TABELLEN: Record<PaperKind, { tabelle: string; wo: string }[]> = {
  set: [
    { tabelle: 'sets', wo: 'user_id = $1 AND set_number = $2' },
    { tabelle: 'parts', wo: 'user_id = $1 AND set_number = $2' },
    { tabelle: 'minifigs', wo: 'user_id = $1 AND set_number = $2' },
    { tabelle: 'set_acquisitions', wo: 'user_id = $1 AND set_number = $2' },
  ],
  teil: [
    { tabelle: 'parts', wo: "user_id = $1 AND part_number = $2 AND color_id = $3 AND source = 'manual'" },
    { tabelle: 'part_acquisitions', wo: 'user_id = $1 AND part_number = $2 AND color_id = $3' },
  ],
  figur: [
    { tabelle: 'minifigs', wo: "user_id = $1 AND fig_number = $2 AND source = 'manual'" },
    { tabelle: 'minifig_acquisitions', wo: 'user_id = $1 AND fig_number = $2' },
  ],
};

export const tablesTheKind = (art: PaperKind): string[] => TABELLEN[art].map(t => t.tabelle);

export async function inventoryRows(
  tx: DbInterface,
  art: PaperKind,
  werte: unknown[],
): Promise<Record<string, unknown[]>> {
  const zeilen: Record<string, unknown[]> = {};
  for (const { tabelle, wo } of TABELLEN[art]) {
    const r = await tx.get<{ z: unknown[] }>(
      `SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) AS z FROM ${tabelle} t WHERE ${wo}`,
      werte,
    );
    zeilen[tabelle] = r?.z ?? [];
  }
  return zeilen;
}

const LABEL: Record<PaperKind, string> = {
  set: 'SELECT name AS b FROM rb_sets WHERE set_num = $1 AND $2::int IS NOT NULL',
  teil: `SELECT concat_ws(' · ', ${TEIL.name}, ${TEIL.farbname}) AS b
            FROM (SELECT $1::text AS nr, $2::int AS konto, $3::int AS farbe) x
            ${teilSichtJoin('x.konto', 'x.nr', 'x.farbe')}`,
  figur: `SELECT ${FIGUR.name} AS b
            FROM (SELECT $1::text AS nr, $2::int AS konto) x
            ${figurSichtJoin('x.konto', 'x.nr')}`,
};

/** Damit die Liste auch ohne Katalogzeile lesbar bleibt. */
export async function bezeichnung(
  tx: DbInterface,
  art: PaperKind,
  userId: number,
  nummer: string,
  colorId: number | null,
): Promise<string | null> {
  const r = await tx.get<{ b: string | null }>(
    LABEL[art],
    art === 'teil' ? [nummer, userId, colorId] : [nummer, userId],
  );
  return r?.b || null;
}

export async function putEntryAn(
  tx: DbInterface,
  userId: number,
  art: PaperKind,
  nummer: string,
  colorId: number | null,
  name: string | null,
  zeilen: Record<string, unknown[]>,
): Promise<number | null> {
  const r = await tx.get<{ id: number }>(
    `INSERT INTO trash (user_id, type, number, color_id, label, rows)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING id`,
    [userId, art, nummer, colorId, name, JSON.stringify(zeilen)],
  );
  return r?.id ?? null;
}

/** Wie die Tabelle sie liefert; `type` prüft die Tabelle per CHECK. */
export interface TrashRow {
  id: number;
  user_id: number;
  type: PaperKind;
  number: string;
  color_id: number | null;
  label: string | null;
  rows: Record<string, { quantity?: unknown }[]> | null;
  deleted_at: string;
  endgueltig_am: string;
}

export function eintraege(db: DbInterface, uids: number[], retentionDays: number) {
  return db.all<TrashRow>(
    `SELECT id, user_id, type, number, color_id, label, rows, deleted_at,
            deleted_at + make_interval(days => $2) AS endgueltig_am
       FROM trash WHERE user_id = ANY($1)
      ORDER BY deleted_at DESC, id DESC LIMIT 500`,
    [uids, retentionDays],
  );
}

export function lockTrashEntry(tx: DbInterface, id: number, uids: number[]) {
  return tx.get<{
    type: string;
    rows: Record<string, Record<string, unknown>[]> | null;
    number: string;
    user_id: number;
  }>('SELECT * FROM trash WHERE id = $1 AND user_id = ANY($2) FOR UPDATE', [id, uids]);
}

/** Tabellen aus TABELLEN, nur Spalten, die es noch gibt und nicht berechnet sind (eine gelöschte fällt weg). */
export async function writeBack(
  tx: DbInterface,
  art: PaperKind,
  zeilen: Record<string, Record<string, unknown>[] | undefined>,
): Promise<void> {
  for (const { tabelle } of TABELLEN[art]) {
    const liste = zeilen[tabelle] ?? [];
    const erste = liste[0];
    if (!erste) continue;
    const spalten = (
      await tx.all<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = $1
          AND is_generated = 'NEVER'`,
        [tabelle],
      )
    )
      .map(s => s.column_name)
      .filter(s => s in erste);
    const namen = spalten.map(s => `"${s}"`).join(', ');
    await tx.run(
      `INSERT INTO ${tabelle} (${namen})
       SELECT ${namen} FROM jsonb_populate_recordset(NULL::${tabelle}, $1::jsonb)`,
      [JSON.stringify(liste)],
    );
  }
}

export async function hatSetRow(
  tx: DbInterface,
  l: InventoryReadContract,
  userId: number,
  nummer: string,
): Promise<boolean> {
  return !!(await tx.get<{ da: number }>(`SELECT 1 AS da FROM ${l.setBestand('= $1')} s WHERE set_number = $2`, [
    userId,
    nummer,
  ]));
}

export async function removeTrashEntry(tx: DbInterface, id: number): Promise<void> {
  await tx.run('DELETE FROM trash WHERE id = $1', [id]);
}

export async function removeEntryOfAccount(db: DbInterface, id: number, uids: number[]): Promise<number> {
  return (await db.run('DELETE FROM trash WHERE id = $1 AND user_id = ANY($2)', [id, uids])).changes ?? 0;
}

export async function removeAll(db: DbInterface, uids: number[]): Promise<number> {
  return (await db.run('DELETE FROM trash WHERE user_id = ANY($1)', [uids])).changes ?? 0;
}

export async function removeOlder(db: DbInterface, tage: number): Promise<number> {
  return (await db.run('DELETE FROM trash WHERE deleted_at < NOW() - make_interval(days => $1)', [tage])).changes ?? 0;
}
