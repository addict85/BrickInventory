import type { DbSchnittstelle } from '../../../db/database';
import { teilSichtJoin, figurSichtJoin, TEIL, FIGUR } from '../../../db/katalogSicht';

/** Ein Eintrag hält die gelöschten Zeilen aller Tabellen eines Bestands als
 * JSON; Wiederherstellen schreibt sie Spalte für Spalte zurück. */
export type PapierArt = 'set' | 'teil' | 'figur';

/** Die erste Tabelle ist die Stammzeile. */
const TABELLEN: Record<PapierArt, { tabelle: string; wo: string }[]> = {
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

export const tabellenDerArt = (art: PapierArt): string[] => TABELLEN[art].map(t => t.tabelle);

export async function bestandsZeilen(
  tx: DbSchnittstelle,
  art: PapierArt,
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

const BEZEICHNUNG: Record<PapierArt, string> = {
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
  tx: DbSchnittstelle,
  art: PapierArt,
  userId: number,
  nummer: string,
  farbeId: number | null,
): Promise<string | null> {
  const r = await tx.get<{ b: string | null }>(
    BEZEICHNUNG[art],
    art === 'teil' ? [nummer, userId, farbeId] : [nummer, userId],
  );
  return r?.b || null;
}

export async function legeEintragAn(
  tx: DbSchnittstelle,
  userId: number,
  art: PapierArt,
  nummer: string,
  farbeId: number | null,
  name: string | null,
  zeilen: Record<string, unknown[]>,
): Promise<number | null> {
  const r = await tx.get<{ id: number }>(
    `INSERT INTO papierkorb (user_id, art, nummer, farbe_id, bezeichnung, zeilen)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING id`,
    [userId, art, nummer, farbeId, name, JSON.stringify(zeilen)],
  );
  return r?.id ?? null;
}

/** Wie die Tabelle sie liefert; `art` prüft die Tabelle per CHECK. */
export interface PapierkorbZeile {
  id: number;
  user_id: number;
  art: PapierArt;
  nummer: string;
  farbe_id: number | null;
  bezeichnung: string | null;
  zeilen: Record<string, { quantity?: unknown }[]> | null;
  geloescht_am: string;
  endgueltig_am: string;
}

export function eintraege(db: DbSchnittstelle, uids: number[], aufbewahrungTage: number) {
  return db.all<PapierkorbZeile>(
    `SELECT id, user_id, art, nummer, farbe_id, bezeichnung, zeilen, geloescht_am,
            geloescht_am + make_interval(days => $2) AS endgueltig_am
       FROM papierkorb WHERE user_id = ANY($1)
      ORDER BY geloescht_am DESC, id DESC LIMIT 500`,
    [uids, aufbewahrungTage],
  );
}

export function eintragSperren(tx: DbSchnittstelle, id: number, uids: number[]) {
  return tx.get<{
    art: string;
    zeilen: Record<string, Record<string, unknown>[]> | null;
    nummer: string;
    user_id: number;
  }>('SELECT * FROM papierkorb WHERE id = $1 AND user_id = ANY($2) FOR UPDATE', [id, uids]);
}

/** Nur Spalten, die es noch gibt und die nicht berechnet sind; eine seither
 * gelöschte Spalte fällt so still weg. */
export async function schreibeZurueck(
  tx: DbSchnittstelle,
  tabelle: string,
  zeilen: Record<string, unknown>[],
): Promise<void> {
  const erste = zeilen[0];
  if (!erste) return;
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
  const liste = spalten.map(s => `"${s}"`).join(', ');
  await tx.run(
    `INSERT INTO ${tabelle} (${liste})
     SELECT ${liste} FROM jsonb_populate_recordset(NULL::${tabelle}, $1::jsonb)`,
    [JSON.stringify(zeilen)],
  );
}

export async function entferneEintrag(tx: DbSchnittstelle, id: number): Promise<void> {
  await tx.run('DELETE FROM papierkorb WHERE id = $1', [id]);
}

export async function entferneEintragDesKontos(db: DbSchnittstelle, id: number, uids: number[]): Promise<number> {
  return (await db.run('DELETE FROM papierkorb WHERE id = $1 AND user_id = ANY($2)', [id, uids])).changes ?? 0;
}

export async function entferneAlle(db: DbSchnittstelle, uids: number[]): Promise<number> {
  return (await db.run('DELETE FROM papierkorb WHERE user_id = ANY($1)', [uids])).changes ?? 0;
}

export async function entferneAeltere(db: DbSchnittstelle, tage: number): Promise<number> {
  return (
    (await db.run('DELETE FROM papierkorb WHERE geloescht_am < NOW() - make_interval(days => $1)', [tage])).changes ?? 0
  );
}
