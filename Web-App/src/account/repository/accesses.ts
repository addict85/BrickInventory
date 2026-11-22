import type { Row, DbInterface } from '../../../db/database';
/** Tokens are only stored as SHA-256 in the table; every function takes the hash,
 * never the plaintext. */

export type TokenScope = 'app' | 'voll';

export type TokenRow = {
  user_id: number;
  expires_at: string | Date | null;
  hard_expires_at: string | Date | null;
  last_used: string | Date | null;
  sliding: boolean;
  never_expires: boolean;
  scope: TokenScope;
  rotated_at: string | Date | null;
  previous_token: string | null;
  label: string | null;
  ip_range: string | null;
  created_at: string | Date;
  username: string;
  konto_is_admin: boolean;
  is_admin?: boolean;
  muss_passwort_aendern: boolean;
};

/** Deadlines and account state in the query: an expired token or one
 * of a deactivated account is never returned. */
export function validToken(db: DbInterface, hash: string) {
  return db.get<TokenRow>(
    `
    SELECT t.user_id, t.expires_at, t.hard_expires_at, t.last_used, t.sliding, t.never_expires,
           t.scope, t.rotated_at, t.previous_token, t.label, t.ip_range, t.created_at,
           u.username, u.is_admin AS konto_is_admin, u.must_change_password AS muss_passwort_aendern
    FROM api_tokens t JOIN users u ON u.id = t.user_id
    WHERE t.token = $1 AND u.is_active
      AND (t.expires_at      IS NULL OR t.expires_at      > NOW())
      AND (t.hard_expires_at IS NULL OR t.hard_expires_at > NOW())`,
    [hash],
  );
}

/** created_at travels through JavaScript on the swap and loses the microseconds. */
const family = (column: string) => `date_trunc('milliseconds', ${column})`;

export async function endOverlap(db: DbInterface, previous_token: string, hash: string): Promise<void> {
  await db.run(
    `WITH weg AS (DELETE FROM api_tokens WHERE token = $1 AND replaced_by = $2 RETURNING token, user_id, created_at)
    INSERT INTO api_tokens_consumed (token, user_id, token_family)
    SELECT token, user_id, ${family('created_at')} FROM weg WHERE created_at IS NOT NULL ON CONFLICT DO NOTHING`,
    [previous_token, hash],
  );
  await db.run('UPDATE api_tokens SET previous_token = NULL WHERE token = $1', [hash]);
}

/** The WHERE clause lets at most one write per day through, even
 * across several processes. */
export async function touchToken(db: DbInterface, hash: string, idleDays: number, area: string | null): Promise<void> {
  await db.run(
    `UPDATE api_tokens
        SET last_used = NOW(),
            ip_range = COALESCE($3, ip_range),
            expires_at = CASE WHEN sliding AND expires_at IS NOT NULL
                              THEN NOW() + make_interval(days => $2) ELSE expires_at END
      WHERE token = $1
        AND (last_used IS NULL OR last_used < NOW() - INTERVAL '1 day'
             OR (sliding AND expires_at < NOW() + make_interval(days => $2) - INTERVAL '1 day'))`,
    [hash, idleDays, area],
  );
}

export type NewToken = {
  hash: string;
  userId: number;
  label: string;
  scope: TokenScope;
  bereich: string | null;
  /** 'kurz' = seven fixed days (or fewer, if fixedDays is smaller) */
  art: 'gleitend' | 'kurz';
  idleDays: number;
  /** The fixed end (hard_expires_at) in days; every token has one. */
  fixedDays: number;
};

export async function createToken(db: DbInterface, t: NewToken): Promise<void> {
  if (t.art === 'gleitend') {
    await db.run(
      `INSERT INTO api_tokens (token, user_id, label, expires_at, sliding, hard_expires_at, scope, ip_range)
       VALUES ($1,$2,$3, NOW() + make_interval(days => $4), TRUE, NOW() + make_interval(days => $5), $6, $7)
       ON CONFLICT DO NOTHING`,
      [t.hash, t.userId, t.label, t.idleDays, t.fixedDays, t.scope, t.bereich],
    );
  } else {
    await db.run(
      `INSERT INTO api_tokens (token, user_id, label, expires_at, sliding, hard_expires_at, scope, ip_range)
       VALUES ($1,$2,$3, NOW() + make_interval(days => LEAST(7, $4)), FALSE, NOW() + make_interval(days => LEAST(7, $4)),
               $5, $6) ON CONFLICT DO NOTHING`,
      [t.hash, t.userId, t.label, t.fixedDays, t.scope, t.bereich],
    );
  }
}

/** Rows from before migration 0126 or from an older process: a fixed end from now on. */
export async function boundUnlimited(db: DbInterface, maxDays: number): Promise<number> {
  return (
    (
      await db.run(
        `UPDATE api_tokens SET hard_expires_at = NOW() + make_interval(days => $1), never_expires = FALSE
          WHERE hard_expires_at IS NULL`,
        [maxDays],
      )
    ).changes || 0
  );
}

export type SwapSource = {
  user_id: number;
  label: string | null;
  scope: TokenScope;
  sliding: boolean;
  never_expires: boolean;
  expires_at: Date | null;
  hard_expires_at: Date | null;
  created_at: Date;
  replaced_by: string | null;
};

/** Locked: two swaps of the same token run one after another. */
export function lockSwapSource(tx: DbInterface, hash: string) {
  return tx.get<SwapSource>(
    `SELECT user_id, label, scope, sliding, never_expires, expires_at, hard_expires_at, created_at, replaced_by
       FROM api_tokens
      WHERE token = $1
        AND (expires_at      IS NULL OR expires_at      > NOW())
        AND (hard_expires_at IS NULL OR hard_expires_at > NOW())
      FOR UPDATE`,
    [hash],
  );
}

/** The still unused successor of a swap: when and from which network it was created. */
export function unusedSuccessor(tx: DbInterface, successor: string, alt: string) {
  return tx.get<{ alter_s: number; ip_range: string | null }>(
    `SELECT EXTRACT(EPOCH FROM NOW() - rotated_at)::float AS alter_s, ip_range
       FROM api_tokens WHERE token = $1 AND previous_token = $2`,
    [successor, alt],
  );
}

/** The whole family of a token (same created_at), including successors. */
export async function deleteFamily(tx: DbInterface, userId: number, seit: Date): Promise<void> {
  await tx.run(`DELETE FROM api_tokens WHERE user_id = $1 AND ${family('created_at')} = ${family('$2::timestamptz')}`, [
    userId,
    seit,
  ]);
}

export async function deleteUnusedSuccessor(tx: DbInterface, successor: string, alt: string): Promise<void> {
  await tx.run('DELETE FROM api_tokens WHERE token = $1 AND previous_token = $2', [successor, alt]);
}

/** The successor inherits label, scope and deadlines; the sliding deadline starts again. */
export function createSuccessor(
  tx: DbInterface,
  fresh: string,
  alt: string,
  z: SwapSource,
  idleDays: number,
  area: string | null,
) {
  return tx.get<{ expires_at: Date | null; hard_expires_at: Date | null; rotated_at: Date }>(
    `INSERT INTO api_tokens (token, user_id, label, created_at, last_used, expires_at, sliding,
                             hard_expires_at, never_expires, scope, ip_range, rotated_at, previous_token)
     VALUES ($1, $2, $3, $4, NOW(),
             CASE WHEN $5 AND $6::timestamptz IS NOT NULL THEN NOW() + make_interval(days => $7) ELSE $6::timestamptz END,
             $5, $8, $9, $10, $11, NOW(), $12)
     RETURNING LEAST(expires_at, hard_expires_at) AS expires_at, hard_expires_at, rotated_at`,
    [
      fresh,
      z.user_id,
      z.label,
      z.created_at,
      z.sliding,
      z.expires_at,
      idleDays,
      z.hard_expires_at,
      z.never_expires,
      z.scope,
      area,
      alt,
    ],
  );
}

export function limitTimePredecessor(tx: DbInterface, alt: string, fresh: string, seconds: number) {
  return tx.get<{ expires_at: Date }>(
    `UPDATE api_tokens
        SET replaced_by = $2, sliding = FALSE, never_expires = FALSE,
            expires_at = LEAST(COALESCE(expires_at, 'infinity'::timestamptz), NOW() + make_interval(secs => $3))
      WHERE token = $1 RETURNING expires_at`,
    [alt, fresh, seconds],
  );
}

/** A consumed token came back: its family ends including successors. Only after
 * the grace period, otherwise it would hit requests still in flight with the old one. */
export function lockFamily(db: DbInterface, hash: string, gracePeriodSec: number) {
  return db.get<{ user_id: number; label: string | null }>(
    `
    WITH v AS (DELETE FROM api_tokens_consumed WHERE token = $1 AND consumed_at < NOW() - make_interval(secs => $2)
               RETURNING user_id, token_family),
         t AS (DELETE FROM api_tokens a USING v WHERE a.user_id = v.user_id AND ${family('a.created_at')} = v.token_family RETURNING a.label),
         r AS (DELETE FROM api_tokens_consumed x USING v WHERE x.user_id = v.user_id AND x.token_family = v.token_family AND x.token <> $1)
    SELECT v.user_id, (SELECT label FROM t LIMIT 1) AS label FROM v`,
    [hash, gracePeriodSec],
  );
}

export async function deleteOrphanedConsumed(db: DbInterface): Promise<number> {
  return (
    (
      await db.run(`DELETE FROM api_tokens_consumed v WHERE NOT EXISTS
    (SELECT 1 FROM api_tokens t WHERE t.user_id = v.user_id AND ${family('t.created_at')} = v.token_family)`)
    ).changes || 0
  );
}

export async function deleteToken(db: DbInterface, hash: string): Promise<void> {
  await db.run('DELETE FROM api_tokens WHERE token = $1', [hash]);
}

export async function deleteTokensOfAccount(
  db: DbInterface,
  userId: number,
  except: string | null = null,
): Promise<void> {
  if (except) await db.run('DELETE FROM api_tokens WHERE user_id = $1 AND token <> $2', [userId, except]);
  else await db.run('DELETE FROM api_tokens WHERE user_id = $1', [userId]);
}

/** Keeps the `behalten` most recently used besides `eigene` (the hash of the id); the others fall. */
export async function capSessions(db: DbInterface, userId: number, own: string, keep: number): Promise<number> {
  return (
    (
      await db.run(
        `DELETE FROM user_sessions WHERE sid IN (SELECT sid FROM user_sessions
    WHERE sess::jsonb->>'userId' = $1 AND sid <> $2 ORDER BY expire DESC OFFSET $3)`,
        [String(userId), own, keep],
      )
    ).changes || 0
  );
}

/** Counts only tokens without a successor: a swapped one in its overlap is the same device. */
export async function capTokens(db: DbInterface, userId: number, own: string, keep: number): Promise<number> {
  return (
    (
      await db.run(
        `DELETE FROM api_tokens WHERE token IN (SELECT token FROM api_tokens
    WHERE user_id = $1 AND token <> $2 AND replaced_by IS NULL
    ORDER BY COALESCE(last_used, created_at) DESC OFFSET $3)`,
        [userId, own, keep],
      )
    ).changes || 0
  );
}

export async function deleteSessionsOfAccount(
  db: DbInterface,
  userId: number,
  except: string | null = null,
): Promise<void> {
  if (except === null) await db.run("DELETE FROM user_sessions WHERE sess::jsonb->>'userId' = $1", [String(userId)]);
  else
    await db.run("DELETE FROM user_sessions WHERE sess::jsonb->>'userId' = $1 AND sid IS DISTINCT FROM $2", [
      String(userId),
      except,
    ]);
}

/** null: account missing or locked. */
export async function sessionVersion(db: DbInterface, uid: number): Promise<number | null> {
  const r = await db.get<{ v: number | null }>(
    'SELECT CASE WHEN is_active THEN session_version END AS v FROM users WHERE id = $1',
    [uid],
  );
  return r?.v ?? null;
}

export async function countSessionVersionHigh(db: DbInterface, uid: number): Promise<number> {
  const r = await db.get<{ v: number }>(
    'UPDATE users SET session_version = session_version + 1 WHERE id = $1 RETURNING session_version AS v',
    [uid],
  );
  return r?.v ?? 0;
}

export async function pullOldRowsAfter(db: DbInterface, idleDays: number): Promise<number> {
  return (
    (
      await db.run(
        `UPDATE api_tokens
        SET sliding = TRUE,
            expires_at = COALESCE(last_used, created_at) + make_interval(days => $1)
      WHERE expires_at IS NULL AND NOT never_expires`,
        [idleDays],
      )
    ).changes || 0
  );
}

/** Both deadlines in one statement — a second one would be the place where a rule is missing. */
export async function deleteExpiredAccesses(db: DbInterface): Promise<number> {
  return (
    (
      await db.run(
        `DELETE FROM api_tokens
      WHERE (expires_at      IS NOT NULL AND expires_at      < NOW())
         OR (hard_expires_at IS NOT NULL AND hard_expires_at < NOW())`,
      )
    ).changes || 0
  );
}

/** NOT never_expires: a row without a date is legacy data or the explicit choice "unlimited". */
export async function deleteUnused(db: DbInterface, idleDays: number): Promise<number> {
  return (
    (
      await db.run(
        `DELETE FROM api_tokens
      WHERE expires_at IS NULL AND NOT never_expires
        AND COALESCE(last_used, created_at) < NOW() - make_interval(days => $1)`,
        [idleDays],
      )
    ).changes || 0
  );
}

/** Two hits (a name equal to another account's address, only possible in
 * legacy data) mean "no account": which one was meant cannot be decided. */
export async function accountToLogin(db: DbInterface, name: string) {
  const hits = await db.all<
    Row<{
      id: number;
      password_hash: string;
      is_active: boolean;
      email_verified: boolean;
      is_admin: boolean;
      email: string | null;
      registration_pending: boolean;
    }>
  >('SELECT * FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1) LIMIT 2', [name]);
  if (hits.length > 1)
    console.warn('[anmeldung] Name passt auf zwei Konten (Benutzername und Adresse) — Anmeldung abgewiesen');
  return hits.length === 1 ? hits[0] : undefined;
}

/** Only if the old hash still applies: a password changed concurrently stays. */
export async function replacePasswordHash(db: DbInterface, id: number, alt: string, fresh: string): Promise<void> {
  await db.run('UPDATE users SET password_hash = $3 WHERE id = $1 AND password_hash = $2', [id, alt, fresh]);
}

export function passwordHash(db: DbInterface, id: number) {
  return db.get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [id]);
}
