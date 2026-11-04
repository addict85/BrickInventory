import * as db from '../../../db/database';
import type { BlArt } from '../../../db/blZuordnungSql';

/** NULLIF(bl, rb) ist die EINE Schreibweise für „keine abweichende Nummer";
 * eine zweite Form hiesse zwei Aussagen für dasselbe. */

/** Gemeinsam schreiben nur geprüfte Quellen, und ein vorhandener Wert bleibt:
 * Nur eine leere Zeile („nachgesehen") wird gefüllt. */
const NUR_LEERE_FUELLEN = `ON CONFLICT (art, rb_id) DO UPDATE SET bl_id = EXCLUDED.bl_id, fetched_at = NOW()
     WHERE bl_zuordnung.bl_id IS NULL AND EXCLUDED.bl_id IS NOT NULL`;

export async function schreibeBlNummer(art: BlArt, rbId: string, blId: string): Promise<void> {
  await db.run(
    `INSERT INTO bl_zuordnung (art, rb_id, bl_id) VALUES ($1,$2,NULLIF($3,$2)) ${NUR_LEERE_FUELLEN}`,
    [art, rbId, blId]);
}

/** Die Eingabe eines Kontos; die neueste gilt. */
export async function schreibeBlNummerEigen(uid: number, art: BlArt, rbId: string, blId: string): Promise<void> {
  await db.run(
    `INSERT INTO bl_zuordnung_eigen (user_id, art, rb_id, bl_id) VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id, art, rb_id) DO UPDATE SET bl_id = EXCLUDED.bl_id, updated_at = NOW()`,
    [uid, art, rbId, blId]);
}

export async function schreibeBlNummern(art: BlArt, rbIds: string[], blIds: string[],
                                        dbh: { run: (sql: string, p?: unknown[]) => Promise<unknown> } = db): Promise<void> {
  await dbh.run(
    `INSERT INTO bl_zuordnung (art, rb_id, bl_id)
     SELECT $1, r, NULLIF(b, r) FROM unnest($2::text[], $3::text[]) AS x(r, b)
     ${NUR_LEERE_FUELLEN}`,
    [art, rbIds, blIds]);
}

/** DO NOTHING: Die Notiz „nachgesehen" überschreibt keine gefundene Zuordnung. */
export async function notiereNachgesehen(art: BlArt, rbId: string): Promise<void> {
  await db.run('INSERT INTO bl_zuordnung (art, rb_id, bl_id) VALUES ($1,$2,NULL) ON CONFLICT DO NOTHING', [art, rbId]);
}

/** Die eigene Zeile der Konten `konten` (in deren Reihenfolge) vor der gemeinsamen. */
const EIGENE_ZUERST = `(SELECT e.bl_id FROM bl_zuordnung_eigen e
      WHERE e.user_id = ANY($3::int[]) AND e.art = $1 AND e.rb_id = q.rb_id
      ORDER BY array_position($3::int[], e.user_id) LIMIT 1)`;

export async function abweichendeNummer(art: BlArt, rbId: string, konten: number[] = []): Promise<string | null> {
  const z = konten.length
    ? await db.get<{ bl_id: string | null }>(
      `SELECT NULLIF(COALESCE(${EIGENE_ZUERST}, g.bl_id), q.rb_id) AS bl_id
         FROM (SELECT $2::text AS rb_id) q LEFT JOIN bl_zuordnung g ON g.art = $1 AND g.rb_id = q.rb_id`, [art, rbId, konten])
    : await db.get<{ bl_id: string | null }>('SELECT bl_id FROM bl_zuordnung WHERE art=$1 AND rb_id=$2', [art, rbId]);
  return z?.bl_id || null;
}

/** null nur, wenn es keine Zeile gibt (nie nachgesehen). */
export async function wirksameNummer(art: BlArt, rbId: string, konten: number[] = []): Promise<string | null> {
  if (konten.length) return (await wirksameNummern(art, [rbId], konten))[0]?.nr ?? null;
  const z = await db.get<{ nr: string }>(
    'SELECT COALESCE(bl_id, rb_id) AS nr FROM bl_zuordnung WHERE art=$1 AND rb_id=$2', [art, rbId]);
  return z?.nr || null;
}

export function wirksameNummern(art: BlArt, rbIds: string[], konten: number[] = []) {
  if (!konten.length) return db.all<{ rb_id: string; nr: string }>(
    `SELECT rb_id, COALESCE(bl_id, rb_id) AS nr FROM bl_zuordnung
      WHERE art=$1 AND rb_id = ANY($2)`, [art, rbIds]);
  return db.all<{ rb_id: string; nr: string }>(
    `SELECT q.rb_id, COALESCE(${EIGENE_ZUERST}, g.bl_id, q.rb_id) AS nr
       FROM unnest($2::text[]) AS q(rb_id)
       LEFT JOIN bl_zuordnung g ON g.art = $1 AND g.rb_id = q.rb_id
      WHERE g.rb_id IS NOT NULL OR ${EIGENE_ZUERST} IS NOT NULL`, [art, rbIds, konten]);
}

export async function schreibeBlFarbnummer(colorId: number, blColorId: number): Promise<void> {
  await db.run('UPDATE rb_colors SET bl_color_id = $1 WHERE id = $2', [blColorId, colorId]);
}
