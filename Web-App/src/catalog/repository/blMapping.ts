import type { DbInterface } from '../../../db/database';
import type { BlArt } from '../../../db/blMappingSql';

/** NULLIF(bl, rb) is THE one spelling for "no differing number";
 * a second form would mean two statements for the same thing. */

/** Only verified sources write shared data, and an existing value stays:
 * only an empty row ("looked up") is filled. */
const ONLY_FILL_EMPTY = `ON CONFLICT (type, rb_id) DO UPDATE SET bl_id = EXCLUDED.bl_id, fetched_at = NOW()
     WHERE bl_mapping.bl_id IS NULL AND EXCLUDED.bl_id IS NOT NULL`;

export async function writeBlNumber(db: DbInterface, kind: BlArt, rbId: string, blId: string): Promise<void> {
  await db.run(`INSERT INTO bl_mapping (type, rb_id, bl_id) VALUES ($1,$2,NULLIF($3,$2)) ${ONLY_FILL_EMPTY}`, [
    kind,
    rbId,
    blId,
  ]);
}

/** An account's input; the newest applies. */
export async function writeBlNumberOwn(
  db: DbInterface,
  uid: number,
  kind: BlArt,
  rbId: string,
  blId: string,
): Promise<void> {
  await db.run(
    `INSERT INTO bl_mapping_custom (user_id, type, rb_id, bl_id) VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id, type, rb_id) DO UPDATE SET bl_id = EXCLUDED.bl_id, updated_at = NOW()`,
    [uid, kind, rbId, blId],
  );
}

export async function writeBlNumbers(
  db: { run: (sql: string, p?: unknown[]) => Promise<unknown> },
  kind: BlArt,
  rbIds: string[],
  blIds: string[],
): Promise<void> {
  await db.run(
    `INSERT INTO bl_mapping (type, rb_id, bl_id)
     SELECT $1, r, NULLIF(b, r) FROM unnest($2::text[], $3::text[]) AS x(r, b)
     ${ONLY_FILL_EMPTY}`,
    [kind, rbIds, blIds],
  );
}

/** DO NOTHING: the note "looked up" does not overwrite a mapping that was found. */
export async function noteLookedUp(db: DbInterface, kind: BlArt, rbId: string): Promise<void> {
  await db.run('INSERT INTO bl_mapping (type, rb_id, bl_id) VALUES ($1,$2,NULL) ON CONFLICT DO NOTHING', [kind, rbId]);
}

/** The own row of the accounts `konten` (in their order) before the shared one. */
const OWN_FIRST = `(SELECT e.bl_id FROM bl_mapping_custom e
      WHERE e.user_id = ANY($3::int[]) AND e.type = $1 AND e.rb_id = q.rb_id
      ORDER BY array_position($3::int[], e.user_id) LIMIT 1)`;

export async function differingNumber(
  db: DbInterface,
  kind: BlArt,
  rbId: string,
  konten: number[] = [],
): Promise<string | null> {
  const z = konten.length
    ? await db.get<{ bl_id: string | null }>(
        `SELECT NULLIF(COALESCE(${OWN_FIRST}, g.bl_id), q.rb_id) AS bl_id
         FROM (SELECT $2::text AS rb_id) q LEFT JOIN bl_mapping g ON g.type = $1 AND g.rb_id = q.rb_id`,
        [kind, rbId, konten],
      )
    : await db.get<{ bl_id: string | null }>('SELECT bl_id FROM bl_mapping WHERE type=$1 AND rb_id=$2', [kind, rbId]);
  return z?.bl_id || null;
}

/** null only if there is no row (never looked up). */
export async function effectiveNumber(
  db: DbInterface,
  kind: BlArt,
  rbId: string,
  konten: number[] = [],
): Promise<string | null> {
  if (konten.length) return (await effectiveNumbers(db, kind, [rbId], konten))[0]?.nr ?? null;
  const z = await db.get<{ nr: string }>(
    'SELECT COALESCE(bl_id, rb_id) AS nr FROM bl_mapping WHERE type=$1 AND rb_id=$2',
    [kind, rbId],
  );
  return z?.nr || null;
}

export function effectiveNumbers(db: DbInterface, kind: BlArt, rbIds: string[], konten: number[] = []) {
  if (!konten.length)
    return db.all<{ rb_id: string; nr: string }>(
      `SELECT rb_id, COALESCE(bl_id, rb_id) AS nr FROM bl_mapping
      WHERE type=$1 AND rb_id = ANY($2)`,
      [kind, rbIds],
    );
  return db.all<{ rb_id: string; nr: string }>(
    `SELECT q.rb_id, COALESCE(${OWN_FIRST}, g.bl_id, q.rb_id) AS nr
       FROM unnest($2::text[]) AS q(rb_id)
       LEFT JOIN bl_mapping g ON g.type = $1 AND g.rb_id = q.rb_id
      WHERE g.rb_id IS NOT NULL OR ${OWN_FIRST} IS NOT NULL`,
    [kind, rbIds, konten],
  );
}

export async function writeBlColorNumber(db: DbInterface, colorId: number, blColorId: number): Promise<void> {
  await db.run('UPDATE rb_colors SET bl_color_id = $1 WHERE id = $2', [blColorId, colorId]);
}
