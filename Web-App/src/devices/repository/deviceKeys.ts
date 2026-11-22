import type { DbInterface } from '../../../db/database';
import type { DevicesReadContract } from '../readContract';

/** A token family: account and created_at (to the millisecond, as it travels through JavaScript). */
export interface Family {
  uid: number;
  seit: string;
}

/** An unconfirmed key (registered before the attestation) only applies until [altBis]. */
/** The family of a token just issued, to the millisecond like familieLebt. */
export async function familyOfTokens(db: DbInterface, l: DevicesReadContract, hash: string): Promise<Family | null> {
  const z = await db.get<{ uid: number; seit: Date }>(l.tokenFamilySql('$1'), [hash]);
  return z ? { uid: z.uid, seit: new Date(z.seit).toISOString() } : null;
}

export async function keyThe(db: DbInterface, f: Family, altBis: Date): Promise<string | null> {
  const z = await db.get<{ public_key: string }>(
    `SELECT public_key FROM device_keys WHERE user_id = $1 AND token_family = $2::timestamptz
       AND (attested OR NOW() < $3)`,
    [f.uid, f.seit, altBis],
  );
  return z?.public_key ?? null;
}

export async function entryThe(db: DbInterface, f: Family): Promise<{ public_key: string; attested: boolean } | null> {
  return (
    (await db.get<{ public_key: string; attested: boolean }>(
      'SELECT public_key, attested FROM device_keys WHERE user_id = $1 AND token_family = $2::timestamptz',
      [f.uid, f.seit],
    )) ?? null
  );
}

/** Only for a living, young family; an unconfirmed key may give way to an
 * attested one in the process. Remnants of revoked families are dropped.
 * @returns whether it applies now */
export async function createKey(
  db: DbInterface,
  l: DevicesReadContract,
  f: Family,
  public_key: string,
  fristS: number,
): Promise<boolean> {
  await db.run(
    `DELETE FROM device_keys g WHERE g.user_id = $1 AND NOT ${l.familieLebt('g.user_id', 'g.token_family')}`,
    [f.uid],
  );
  return !!(await db.get<{ user_id: number }>(
    `INSERT INTO device_keys (user_id, token_family, public_key, attested)
     SELECT $1, $2::timestamptz, $3, true WHERE ${l.familieLebt('$1', '$2')} AND $2::timestamptz > NOW() - make_interval(secs => $4)
     ON CONFLICT (user_id, token_family) DO UPDATE SET public_key = EXCLUDED.public_key, attested = true,
       created_at = NOW() WHERE NOT device_keys.attested
     RETURNING user_id`,
    [f.uid, f.seit, public_key, fristS],
  ));
}

/** A nonce for the attestation challenge; at most [offen] per family, only for a young family. */
export async function createNonce(
  db: DbInterface,
  l: DevicesReadContract,
  f: Family,
  nonce: string,
  o: { fristS: number; offen: number; fromQr: boolean },
): Promise<boolean> {
  await db.run(
    `DELETE FROM device_nonces WHERE user_id = $1 AND token_family = $2::timestamptz AND (expires_at <= NOW()
    OR nonce NOT IN (SELECT nonce FROM device_nonces WHERE user_id = $1 AND token_family = $2::timestamptz
                     ORDER BY created_at DESC LIMIT $3))`,
    [f.uid, f.seit, o.offen - 1],
  );
  return !!(await db.get<{ nonce: string }>(
    `INSERT INTO device_nonces (nonce, user_id, token_family, from_qr, expires_at)
     SELECT $3, $1, $2::timestamptz, $5, $2::timestamptz + make_interval(secs => $4)
      WHERE ${l.familieLebt('$1', '$2')} AND $2::timestamptz > NOW() - make_interval(secs => $4) RETURNING nonce`,
    [f.uid, f.seit, nonce, o.fristS, o.fromQr],
  ));
}

/** The nonce issued at the QR pickup, as long as it is valid. */
export async function qrNonceThe(db: DbInterface, f: Family): Promise<{ nonce: string; expires_at: Date } | null> {
  return (
    (await db.get<{ nonce: string; expires_at: Date }>(
      `SELECT nonce, expires_at FROM device_nonces WHERE user_id = $1 AND token_family = $2::timestamptz AND from_qr
         AND expires_at > NOW()`,
      [f.uid, f.seit],
    )) ?? null
  );
}

/** Delete and read in one step: a nonce applies exactly once and only for its family. */
export async function takeNonce(db: DbInterface, f: Family, nonce: string): Promise<boolean> {
  return !!(await db.get<{ nonce: string }>(
    `DELETE FROM device_nonces WHERE nonce = $1 AND user_id = $2 AND token_family = $3::timestamptz AND expires_at > NOW()
     RETURNING nonce`,
    [nonce, f.uid, f.seit],
  ));
}

/** At most [offen] at the same time per family: picking up without redeeming does not fill the table. */
export async function createChallenge(
  db: DbInterface,
  f: Family,
  challenge: string,
  action: string,
  fristS: number,
  open: number,
): Promise<Date> {
  await db.run(
    `DELETE FROM step_up_challenges WHERE user_id = $1 AND token_family = $2::timestamptz AND (expires_at <= NOW()
    OR challenge NOT IN (SELECT challenge FROM step_up_challenges WHERE user_id = $1 AND token_family = $2::timestamptz
                         ORDER BY created_at DESC LIMIT $3))`,
    [f.uid, f.seit, open - 1],
  );
  const z = await db.get<{ expires_at: Date }>(
    `INSERT INTO step_up_challenges (challenge, user_id, token_family, action, expires_at)
     VALUES ($1, $2, $3::timestamptz, $4, NOW() + make_interval(secs => $5)) RETURNING expires_at`,
    [challenge, f.uid, f.seit, action, fristS],
  );
  if (!z) throw new Error('step_up_challenges: INSERT ohne Zeile');
  return z.expires_at;
}

/** Delete and read in one step: a challenge applies exactly once, and only for its family. */
export async function takeChallenge(db: DbInterface, f: Family, challenge: string): Promise<string | null> {
  const z = await db.get<{ action: string }>(
    `DELETE FROM step_up_challenges WHERE challenge = $1 AND user_id = $2 AND token_family = $3::timestamptz
       AND expires_at > NOW() RETURNING action`,
    [challenge, f.uid, f.seit],
  );
  return z?.action ?? null;
}

export async function openRelease(
  db: DbInterface,
  f: Family,
  action: string,
  idleS: number,
  atMostS: number,
): Promise<Date> {
  const z = await db.get<{ until_at: Date }>(
    `INSERT INTO step_up_approvals (user_id, token_family, action, until_at, max_until)
     VALUES ($1, $2::timestamptz, $3, NOW() + make_interval(secs => $4), NOW() + make_interval(secs => $5))
     ON CONFLICT (user_id, token_family, action) DO UPDATE SET until_at = EXCLUDED.until_at, max_until = EXCLUDED.max_until
     RETURNING until_at`,
    [f.uid, f.seit, action, idleS, atMostS],
  );
  if (!z) throw new Error('step_up_approvals: UPSERT ohne Zeile');
  return z.until_at;
}

/** Check and extend in one step, never beyond `max_until`. */
export async function useRelease(db: DbInterface, f: Family, action: string, idleS: number): Promise<boolean> {
  return !!(
    await db.run(
      `UPDATE step_up_approvals SET until_at = LEAST(NOW() + make_interval(secs => $4), max_until)
      WHERE user_id = $1 AND token_family = $2::timestamptz AND action = $3 AND until_at > NOW()`,
      [f.uid, f.seit, action, idleS],
    )
  ).changes;
}
