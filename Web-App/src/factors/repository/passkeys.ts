import type { DbInterface, Treffer } from '../../../db/database';

/** Challenges are kept only as a hash. */

/** @returns false if `atMost` challenges are already open */
export async function storeChallenge(
  db: DbInterface,
  hash: string,
  purpose: string,
  uid: number | null,
  until: Date,
  atMost: number,
): Promise<boolean> {
  await db.run('DELETE FROM webauthn_challenges WHERE expires_at < NOW()');
  return (
    (
      await db.run(
        `INSERT INTO webauthn_challenges (challenge, user_id, purpose, expires_at)
    SELECT $1, $2, $3, $4 WHERE (SELECT COUNT(*) FROM webauthn_challenges WHERE purpose = $3) < $5`,
        [hash, uid, purpose, until, atMost],
      )
    ).changes > 0
  );
}

/** For signed challenges: only entered after a valid signature, so without an upper limit.
 * @returns false if the challenge is already consumed */
export async function markConsumed(db: DbInterface, hash: string, purpose: string, until: Date): Promise<boolean> {
  await db.run('DELETE FROM webauthn_challenges WHERE expires_at < NOW()');
  return (
    (
      await db.run(
        `INSERT INTO webauthn_challenges (challenge, user_id, purpose, expires_at) VALUES ($1, NULL, $2, $3)
         ON CONFLICT (challenge) DO NOTHING`,
        [hash, purpose, until],
      )
    ).changes > 0
  );
}

/** Delete and check in one step: a challenge is valid exactly once. */
export async function consumeChallenge(
  db: DbInterface,
  hash: string,
  purpose: string,
  uid: number | null,
): Promise<boolean> {
  return !!(await db.get(
    `DELETE FROM webauthn_challenges
      WHERE challenge = $1 AND purpose = $2 AND expires_at > NOW()
        AND ($3::int IS NULL OR user_id = $3::int)
      RETURNING challenge`,
    [hash, purpose, uid],
  ));
}

export function accountCredentialIds(db: DbInterface, uid: number) {
  return db.all<{ credential_id: string; transports: string | null }>(
    'SELECT credential_id, transports FROM passkeys WHERE user_id = $1',
    [uid],
  );
}

export async function createCredential(
  db: DbInterface,
  uid: number,
  credentialId: string,
  publicKey: Buffer,
  counter: number,
  transports: string | null,
  name: string,
): Promise<{ id: number; name: string } | null> {
  return (
    (await db.get<{ id: number; name: string }>(
      `INSERT INTO passkeys (user_id, credential_id, public_key, sign_count, transports, name)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (credential_id) DO NOTHING RETURNING id, name`,
      [uid, credentialId, publicKey, counter, transports, name],
    )) ?? null
  );
}

export function byCredentialId(db: DbInterface, credentialId: string, uid: number | null) {
  return db.get<{ id: number; user_id: number; public_key: Buffer; sign_count: string; transports: string | null }>(
    `SELECT id, user_id, public_key, sign_count, transports FROM passkeys
      WHERE credential_id = $1 AND ($2::int IS NULL OR user_id = $2::int)`,
    [credentialId, uid],
  );
}

/** Only if the counter is still the one read: two simultaneous logins do not both succeed. */
export async function advanceCounter(db: DbInterface, id: number, neu: number, old: string): Promise<boolean> {
  return !!(
    await db.run('UPDATE passkeys SET sign_count = $2, last_used = NOW() WHERE id = $1 AND sign_count = $3', [
      id,
      neu,
      old,
    ])
  ).changes;
}

export function passkeysForAccount(db: DbInterface, uid: number) {
  return db.all<{
    id: number;
    name: string | null;
    created_at: Date;
    last_used: Date | null;
    transports: string | null;
  }>('SELECT id, name, created_at, last_used, transports FROM passkeys WHERE user_id = $1 ORDER BY created_at', [uid]);
}

export async function hasAny(db: DbInterface, uid: number): Promise<boolean> {
  return !!(await db.get<Treffer>('SELECT 1 FROM passkeys WHERE user_id = $1 LIMIT 1', [uid]));
}

export async function deleteAllForAccount(db: DbInterface, uid: number): Promise<number> {
  return (await db.run('DELETE FROM passkeys WHERE user_id = $1', [uid])).changes ?? 0;
}

export async function deletePasskeyRow(db: DbInterface, uid: number, id: number): Promise<boolean> {
  return !!(await db.run('DELETE FROM passkeys WHERE user_id = $1 AND id = $2', [uid, id])).changes;
}
