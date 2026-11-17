import type { DbSchnittstelle } from '../../../db/database';

/** Das Geheimnis liegt verschlüsselt. */

export async function ersetzeCodes(tx: DbSchnittstelle, uid: number, hashes: string[]): Promise<void> {
  await tx.run('DELETE FROM second_factor_codes WHERE user_id = $1', [uid]);
  for (const h of hashes)
    await tx.run('INSERT INTO second_factor_codes (user_id, code_hash) VALUES ($1, $2)', [uid, h]);
}

export async function aktiv(db: DbSchnittstelle, uid: number): Promise<boolean> {
  const r = await db.get<{ active: boolean }>('SELECT active FROM second_factor WHERE user_id = $1', [uid]);
  return r?.active === true;
}

/** Die Konten mit aktivem Faktor, für die Kontenliste der Verwaltung. */
export async function mitAktivemFaktor(db: DbSchnittstelle, ids: number[]): Promise<Set<number>> {
  const z = await db.all<{ user_id: number }>(
    'SELECT user_id FROM second_factor WHERE active AND user_id = ANY($1::int[])',
    [ids],
  );
  return new Set(z.map(r => r.user_id));
}

export async function faktorStand(
  db: DbSchnittstelle,
  uid: number,
): Promise<{ active: boolean; uebrig: number; altBis: Date | null }> {
  const r = await db.get<{ active: boolean; uebrig: number; alt_bis: Date | null }>(
    `SELECT COALESCE((SELECT active FROM second_factor WHERE user_id = $1), FALSE) AS active,
            (SELECT COUNT(*)::int FROM second_factor_codes WHERE user_id = $1 AND consumed_at IS NULL) AS uebrig,
            (SELECT MAX(old_valid_until) FROM second_factor_codes WHERE user_id = $1 AND consumed_at IS NULL) AS alt_bis`,
    [uid],
  );
  return { active: r?.active === true, uebrig: Number(r?.uebrig ?? 0), altBis: r?.alt_bis ?? null };
}

/** Ein aktiver Faktor wird nicht überschrieben. */
export async function legeGeheimnisAn(
  db: DbSchnittstelle,
  uid: number,
  verschluesselt: string | null,
): Promise<boolean> {
  const r = await db.run(
    `INSERT INTO second_factor (user_id, secret) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET secret = EXCLUDED.secret, last_step = 0, created_at = NOW()
       WHERE second_factor.active = FALSE`,
    [uid, verschluesselt],
  );
  return (r.changes ?? 0) > 0;
}

export function unbestaetigtesGeheimnisSperren(tx: DbSchnittstelle, uid: number) {
  return tx.get<{ secret: string }>(
    'SELECT secret FROM second_factor WHERE user_id = $1 AND active = FALSE FOR UPDATE',
    [uid],
  );
}

export async function aktiviere(tx: DbSchnittstelle, uid: number, schritt: number): Promise<void> {
  await tx.run('UPDATE second_factor SET active = TRUE, last_step = $2 WHERE user_id = $1', [uid, schritt]);
}

export function aktivesGeheimnis(db: DbSchnittstelle, uid: number) {
  return db.get<{ secret: string }>('SELECT secret FROM second_factor WHERE user_id = $1 AND active', [uid]);
}

/** Die Bedingung steht im UPDATE: Zwei gleichzeitige Anmeldungen kommen nicht beide durch. */
export async function verbraucheSchritt(db: DbSchnittstelle, uid: number, schritt: number): Promise<boolean> {
  const r = await db.run(
    'UPDATE second_factor SET last_step = $2 WHERE user_id = $1 AND active AND last_step < $2',
    [uid, schritt],
  );
  return (r.changes ?? 0) > 0;
}

export async function verbraucheCode(db: DbSchnittstelle, uid: number, hash: string, alt = false): Promise<boolean> {
  const r = await db.run(
    `UPDATE second_factor_codes SET consumed_at = NOW()
      WHERE user_id = $1 AND code_hash = $2 AND consumed_at IS NULL
        AND ($3::boolean IS FALSE OR old_valid_until > NOW())
        AND EXISTS (SELECT 1 FROM second_factor WHERE user_id = $1 AND active)`,
    [uid, hash, alt],
  );
  return (r.changes ?? 0) > 0;
}

/** Ein Code neuer Art hat gegolten: Die übrigen dieses Satzes sind es auch, ihre Frist entfällt. */
export async function codesSindNeu(db: DbSchnittstelle, uid: number): Promise<void> {
  await db.run('UPDATE second_factor_codes SET old_valid_until = NULL WHERE user_id = $1 AND old_valid_until IS NOT NULL', [
    uid,
  ]);
}

/** Codes und Faktor zusammen: in der Transaktion des Aufrufers (src/faktoren/zweiterFaktor.ts, schalteAb). */
export async function entferne(tx: DbSchnittstelle, uid: number): Promise<void> {
  await tx.run('DELETE FROM second_factor_codes WHERE user_id = $1', [uid]);
  await tx.run('DELETE FROM second_factor WHERE user_id = $1', [uid]);
}
