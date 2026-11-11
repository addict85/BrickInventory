import type { DbSchnittstelle } from '../../../db/database';

const TABELLEN = { set: 'sets', part: 'parts', fig: 'minifigs' } as const;
export type LagerTabelle = keyof typeof TABELLEN;

const BEDINGUNG: Record<LagerTabelle, (ab: number) => string> = {
  set:  (ab) => `set_number = $${ab}`,
  part: (ab) => `part_number = $${ab} AND color_id = $${ab + 1}`,
  fig:  (ab) => `fig_number = $${ab}`,
};

/** Über den Namen im Vorrat des EIGENEN Kontos: Im Haushalt kann derselbe Name
 * in zwei Konten mit je eigener ID liegen. */
export async function ordneOrtZu(dbh: DbSchnittstelle, art: LagerTabelle, besitzer: number[], ort: string | null,
                                 schluessel: string[]): Promise<number> {
  const r = await dbh.run(
    `UPDATE ${TABELLEN[art]} t
        SET storage_id = (SELECT l.id FROM storage_locations l
                           WHERE l.user_id = t.user_id
                             AND lower(l.name) = lower($2))
      WHERE t.user_id = ANY($1) AND ${BEDINGUNG[art](3)}`, [besitzer, ort, ...schluessel]);
  return r.changes ?? 0;
}

export async function besitzerMitZeile(tx: DbSchnittstelle, art: LagerTabelle, besitzer: number[], schluessel: string[]): Promise<number[]> {
  const zeilen = await tx.all<{ user_id: number }>(
    `SELECT DISTINCT t.user_id FROM ${TABELLEN[art]} t
      WHERE t.user_id = ANY($1) AND ${BEDINGUNG[art](2)}`, [besitzer, ...schluessel]);
  return zeilen.map(b => parseInt(String(b.user_id)));
}

export async function nimmOrtAuf(tx: DbSchnittstelle, ids: number[], ort: string): Promise<void> {
  await tx.run(
    `INSERT INTO storage_locations (user_id, name)
     SELECT id, $2 FROM users WHERE id = ANY($1)
     ON CONFLICT (user_id, lower(name)) DO NOTHING`, [ids, ort]);
}

export function orteDerKonten(db: DbSchnittstelle, userIds: number[]) {
  return db.all<{ id: number; user_id: number; name: string }>(`SELECT id, user_id, name FROM storage_locations
      WHERE user_id = ANY($1) ORDER BY lower(name)`, [userIds]);
}

/** Ohne Gross/klein eindeutig je Konto; null, wenn es ihn schon gibt. */
export function fuegeOrtEin(db: DbSchnittstelle, userId: number, name: string) {
  return db.get<{ id: number; user_id: number; name: string }>(`INSERT INTO storage_locations (user_id, name) VALUES ($1, $2)
     ON CONFLICT (user_id, lower(name)) DO NOTHING
     RETURNING id, user_id, name`, [userId, name]);
}

export function ortNachName(db: DbSchnittstelle, userId: number, name: string) {
  return db.get<{ id: number; user_id: number; name: string }>('SELECT id, user_id, name FROM storage_locations WHERE user_id = $1 AND lower(name) = lower($2)', [userId, name]);
}

export function ortName(db: DbSchnittstelle, id: number, userId: number) {
  return db.get<{ name: string }>('SELECT name FROM storage_locations WHERE id = $1 AND user_id = $2', [id, userId]);
}

export function andererOrtGleichenNamens(db: DbSchnittstelle, userId: number, name: string, id: number) {
  return db.get<{ id: number }>(`SELECT id FROM storage_locations
      WHERE user_id = $1 AND lower(name) = lower($2) AND id <> $3`, [userId, name, id]);
}

export function schreibeOrtNamen(db: DbSchnittstelle, id: number, userId: number, name: string) {
  return db.run('UPDATE storage_locations SET name = $3 WHERE id = $1 AND user_id = $2', [id, userId, name]);
}

export function ortBelegung(db: DbSchnittstelle, userId: number, id: number) {
  return db.get<{ n: string }>(`SELECT (SELECT COUNT(*) FROM sets     WHERE user_id = $1 AND storage_id = $2)
          + (SELECT COUNT(*) FROM parts    WHERE user_id = $1 AND storage_id = $2)
          + (SELECT COUNT(*) FROM minifigs WHERE user_id = $1 AND storage_id = $2) AS n`, [userId, id]);
}

export function entferneOrt(db: DbSchnittstelle, id: number, userId: number) {
  return db.run('DELETE FROM storage_locations WHERE id = $1 AND user_id = $2', [id, userId]);
}

export function orteMitBestand(db: DbSchnittstelle, uids: number[]) {
  return db.all<{ ort: string; sets: number; teile: number; figuren: number }>(`SELECT ort,
            SUM(sets)::int    AS sets,
            SUM(teile)::int   AS teile,
            SUM(figuren)::int AS figuren
       FROM (
         SELECT l.name AS ort, COUNT(*)::int AS sets, 0 AS teile, 0 AS figuren
           FROM sets s JOIN storage_locations l ON l.id = s.storage_id
          WHERE s.user_id = ANY($1)
          GROUP BY l.name
         UNION ALL
         SELECT l.name AS ort, 0 AS sets, COUNT(*)::int AS teile, 0 AS figuren
           FROM parts p JOIN storage_locations l ON l.id = p.storage_id
          WHERE p.user_id = ANY($1)
          GROUP BY l.name
         UNION ALL
         SELECT l.name AS ort, 0 AS sets, 0 AS teile, COUNT(*)::int AS figuren
           FROM minifigs m JOIN storage_locations l ON l.id = m.storage_id
          WHERE m.user_id = ANY($1)
          GROUP BY l.name
       ) q
      GROUP BY ort
      ORDER BY ort`, [uids]);
}

/** Sofern es den Ort noch gibt. */
export function vorgabeOrt(db: DbSchnittstelle, userId: number, schluessel: string) {
  return db.get<{ id: number; user_id: number; name: string }>(`SELECT l.id, l.user_id, l.name
       FROM user_settings e
       JOIN storage_locations l
         ON l.id = NULLIF(btrim(e.value), '')::int AND l.user_id = e.user_id
      WHERE e.user_id = $1 AND e.key = $2`, [userId, schluessel]);
}

export function ortDesKontos(db: DbSchnittstelle, id: number, userId: number) {
  return db.get<{ id: number; user_id: number; name: string }>('SELECT id, user_id, name FROM storage_locations WHERE id = $1 AND user_id = $2', [id, userId]);
}
