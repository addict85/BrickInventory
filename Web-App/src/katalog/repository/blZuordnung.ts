import * as db from '../../../db/database';
import type { BlArt } from '../../../db/blZuordnungSql';

/** NULLIF(bl, rb) ist die EINE Schreibweise für „keine abweichende Nummer";
 * eine zweite Form hiesse zwei Aussagen für dasselbe. */

export async function schreibeBlNummer(art: BlArt, rbId: string, blId: string): Promise<void> {
  await db.run(
    `INSERT INTO bl_zuordnung (art, rb_id, bl_id) VALUES ($1,$2,NULLIF($3,$2))
     ON CONFLICT (art, rb_id) DO UPDATE SET bl_id=NULLIF($3,$2), fetched_at=NOW()`,
    [art, rbId, blId]);
}

export async function schreibeBlNummern(art: BlArt, rbIds: string[], blIds: string[],
                                        dbh: { run: (sql: string, p?: unknown[]) => Promise<unknown> } = db): Promise<void> {
  await dbh.run(
    `INSERT INTO bl_zuordnung (art, rb_id, bl_id)
     SELECT $1, r, NULLIF(b, r) FROM unnest($2::text[], $3::text[]) AS x(r, b)
     ON CONFLICT (art, rb_id) DO UPDATE SET bl_id = EXCLUDED.bl_id, fetched_at = NOW()`,
    [art, rbIds, blIds]);
}

/** DO NOTHING: Die Notiz „nachgesehen" überschreibt keine gefundene Zuordnung. */
export async function notiereNachgesehen(art: BlArt, rbId: string): Promise<void> {
  await db.run('INSERT INTO bl_zuordnung (art, rb_id, bl_id) VALUES ($1,$2,NULL) ON CONFLICT DO NOTHING', [art, rbId]);
}

export async function abweichendeNummer(art: BlArt, rbId: string): Promise<string | null> {
  const z = await db.get<{ bl_id: string | null }>('SELECT bl_id FROM bl_zuordnung WHERE art=$1 AND rb_id=$2', [art, rbId]);
  return z?.bl_id || null;
}

/** null nur, wenn es keine Zeile gibt (nie nachgesehen). */
export async function wirksameNummer(art: BlArt, rbId: string): Promise<string | null> {
  const z = await db.get<{ nr: string }>(
    'SELECT COALESCE(bl_id, rb_id) AS nr FROM bl_zuordnung WHERE art=$1 AND rb_id=$2', [art, rbId]);
  return z?.nr || null;
}

export function wirksameNummern(art: BlArt, rbIds: string[]) {
  return db.all<{ rb_id: string; nr: string }>(
    `SELECT rb_id, COALESCE(bl_id, rb_id) AS nr FROM bl_zuordnung
      WHERE art=$1 AND rb_id = ANY($2)`, [art, rbIds]);
}

export async function schreibeBlFarbnummer(colorId: number, blColorId: number): Promise<void> {
  await db.run('UPDATE rb_colors SET bl_color_id = $1 WHERE id = $2', [blColorId, colorId]);
}
