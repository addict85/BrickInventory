import type { DbInterface } from '../../../db/database';

/** The secret is kept encrypted. */

export async function replaceCodes(tx: DbInterface, uid: number, hashes: string[]): Promise<void> {
  await tx.run('DELETE FROM second_factor_codes WHERE user_id = $1', [uid]);
  for (const h of hashes)
    await tx.run('INSERT INTO second_factor_codes (user_id, code_hash) VALUES ($1, $2)', [uid, h]);
}

export async function readActive(db: DbInterface, uid: number): Promise<boolean> {
  const r = await db.get<{ active: boolean }>('SELECT active FROM second_factor WHERE user_id = $1', [uid]);
  return r?.active === true;
}

/** The accounts with an active factor, for the admin's account list. */
export async function withActiveFactor(db: DbInterface, ids: number[]): Promise<Set<number>> {
  const z = await db.all<{ user_id: number }>(
    'SELECT user_id FROM second_factor WHERE active AND user_id = ANY($1::int[])',
    [ids],
  );
  return new Set(z.map(r => r.user_id));
}

export async function factorStatus(
  db: DbInterface,
  uid: number,
): Promise<{ active: boolean; remaining: number; legacyUntil: Date | null }> {
  const r = await db.get<{ active: boolean; remaining: number; legacy_until: Date | null }>(
    `SELECT COALESCE((SELECT active FROM second_factor WHERE user_id = $1), FALSE) AS active,
            (SELECT COUNT(*)::int FROM second_factor_codes WHERE user_id = $1 AND consumed_at IS NULL) AS remaining,
            (SELECT MAX(old_valid_until) FROM second_factor_codes WHERE user_id = $1 AND consumed_at IS NULL) AS legacy_until`,
    [uid],
  );
  return { active: r?.active === true, remaining: Number(r?.remaining ?? 0), legacyUntil: r?.legacy_until ?? null };
}

/** An active factor is never overwritten. */
export async function createSecret(db: DbInterface, uid: number, encrypted: string | null): Promise<boolean> {
  const r = await db.run(
    `INSERT INTO second_factor (user_id, secret) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET secret = EXCLUDED.secret, last_step = 0, created_at = NOW()
       WHERE second_factor.active = FALSE`,
    [uid, encrypted],
  );
  return (r.changes ?? 0) > 0;
}

export function lockUnconfirmedSecret(tx: DbInterface, uid: number) {
  return tx.get<{ secret: string }>(
    'SELECT secret FROM second_factor WHERE user_id = $1 AND active = FALSE FOR UPDATE',
    [uid],
  );
}

export async function activate(tx: DbInterface, uid: number, step: number): Promise<void> {
  await tx.run('UPDATE second_factor SET active = TRUE, last_step = $2 WHERE user_id = $1', [uid, step]);
}

export function activeSecret(db: DbInterface, uid: number) {
  return db.get<{ secret: string }>('SELECT secret FROM second_factor WHERE user_id = $1 AND active', [uid]);
}

/** The condition sits in the UPDATE itself: two simultaneous logins do not both succeed. */
export async function consumeStep(db: DbInterface, uid: number, step: number): Promise<boolean> {
  const r = await db.run('UPDATE second_factor SET last_step = $2 WHERE user_id = $1 AND active AND last_step < $2', [
    uid,
    step,
  ]);
  return (r.changes ?? 0) > 0;
}

export async function consumeCode(db: DbInterface, uid: number, hash: string, legacy = false): Promise<boolean> {
  const r = await db.run(
    `UPDATE second_factor_codes SET consumed_at = NOW()
      WHERE user_id = $1 AND code_hash = $2 AND consumed_at IS NULL
        AND ($3::boolean IS FALSE OR old_valid_until > NOW())
        AND EXISTS (SELECT 1 FROM second_factor WHERE user_id = $1 AND active)`,
    [uid, hash, legacy],
  );
  return (r.changes ?? 0) > 0;
}

/** Once one new-style code has been valid, the rest of this set are too: their deadline falls away. */
export async function markCodesCurrent(db: DbInterface, uid: number): Promise<void> {
  await db.run(
    'UPDATE second_factor_codes SET old_valid_until = NULL WHERE user_id = $1 AND old_valid_until IS NOT NULL',
    [uid],
  );
}

/** Codes and factor together: in the caller's transaction (src/factors/secondFactor.ts, disable). */
export async function remove(tx: DbInterface, uid: number): Promise<void> {
  await tx.run('DELETE FROM second_factor_codes WHERE user_id = $1', [uid]);
  await tx.run('DELETE FROM second_factor WHERE user_id = $1', [uid]);
}
