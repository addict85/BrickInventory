import type { Db, DbInterface, Hit } from '../../../db/database';
import { removeAccountFromBackups } from '../../../db/migrate';
import { LOCKS } from '../../infra/lockNamespaces';
import type { Columns } from '../../../db/rows';

export type AccountShort = { id: number; username: string; is_admin: boolean; must_change_password: boolean };

export interface Account {
  id: number;
  username: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  is_admin: boolean;
  is_active: boolean;
  email_verified: boolean;
  must_change_password: boolean;
  created_at: Date;
  [column: string]: unknown;
}
export type Profile = Pick<Account, 'id' | 'username' | 'email' | 'first_name' | 'last_name' | 'email_verified'> & {
  new_email: string | null;
};
export type AccountInList = Pick<Account, 'id' | 'username' | 'is_admin' | 'is_active' | 'created_at'> & {
  awaiting_confirmation: boolean;
};

export function accountShort(db: DbInterface, id: number): Promise<AccountShort | undefined> {
  return db.get<Columns<'users', 'id' | 'username' | 'is_admin' | 'must_change_password'>>(
    'SELECT id, username, is_admin, must_change_password FROM users WHERE id = $1',
    [id],
  );
}

/** Everything except the password hash: the runtime role does not read it (migration 0115). */
const ACCOUNT_COLUMNS = `id, username, email, first_name, last_name, is_admin, is_active, email_verified,
  must_change_password, created_at, session_version, registration_pending, new_email`;

export function accountFull(db: DbInterface, id: number): Promise<Account | undefined> {
  return db.get<Account>(`SELECT ${ACCOUNT_COLUMNS} FROM users WHERE id=$1`, [id]);
}

export function profileRow(db: DbInterface, id: number): Promise<Profile | undefined> {
  return db.get<Profile>(
    'SELECT id, username, email, first_name, last_name, email_verified, new_email FROM users WHERE id=$1',
    [id],
  );
}

/** Login looks up name OR email case-insensitively — so both must be unique across both columns. */
export async function nameTaken(db: DbInterface, name: string, except: number): Promise<boolean> {
  return !!(await db.get<Columns<'users', 'id'>>(
    'SELECT id FROM users WHERE (LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1)) AND id != $2',
    [name, except],
  ));
}

/** The names go into the statement, not as parameters — hence a fixed list. Only
 * these columns may be written by the runtime role (migration 0117). */
const NAME_COLUMNS = new Set(['first_name', 'last_name']);

export async function changeNames(db: DbInterface, id: number, fields: Record<string, unknown>): Promise<void> {
  const columns = Object.keys(fields);
  if (!columns.length) return;
  for (const s of columns) if (!NAME_COLUMNS.has(s)) throw new Error(`Namensspalte nicht erlaubt: ${s}`);
  await db.run(
    `UPDATE users SET ${columns.map((s, i) => `${s}=$${i + 1}`).join(',')} WHERE id=$${columns.length + 1}`,
    [...columns.map(s => fields[s]), id],
  );
}

/** The name is what you log in with: only the system role writes it. */
export async function changeUsernames(db: DbInterface, id: number, name: string): Promise<void> {
  await db.run('UPDATE users SET username = $2 WHERE id = $1', [id, name]);
}

/** An intruder may have triggered it. @returns the discarded address or null */
export async function discardPendingAddress(db: DbInterface, id: number): Promise<string | null> {
  const r = await db.get<{ address: string }>(
    `UPDATE users u SET ${WITHOUT_EMAIL_NEW} FROM users alt
      WHERE u.id = $1 AND alt.id = u.id AND alt.new_email IS NOT NULL AND NOT alt.registration_pending
      RETURNING alt.new_email AS address`,
    [id],
  );
  return r?.address ?? null;
}

export async function rememberEmailNew(
  db: DbInterface,
  id: number,
  email: string,
  tokenHash: string,
  bis: Date,
): Promise<void> {
  await db.run('UPDATE users SET new_email = $2, new_email_token = $3, new_email_until = $4 WHERE id = $1', [
    id,
    email,
    tokenHash,
    bis,
  ]);
}

const WITHOUT_EMAIL_NEW = 'new_email = NULL, new_email_token = NULL, new_email_until = NULL';

export async function accountToEmailToken(db: DbInterface, hash: string): Promise<number | undefined> {
  return (
    await db.get<{ id: number }>('SELECT id FROM users WHERE new_email_token = $1 AND new_email_until > NOW()', [hash])
  )?.id;
}

/** Only here is the address assigned: what was free at request time may be taken by now.
 * In the caller's transaction (FOR UPDATE). @returns false if the address is taken */
export async function adoptEmailNew(tx: DbInterface, id: number, hash: string): Promise<boolean> {
  const fresh = await tx.get<{ new_email: string }>(
    'SELECT new_email FROM users WHERE id = $1 AND new_email_token = $2 FOR UPDATE',
    [id, hash],
  );
  if (!fresh) return false;
  if (
    await tx.get<unknown>(
      'SELECT 1 FROM users WHERE id <> $2 AND (LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1))',
      [fresh.new_email, id],
    )
  )
    return false;
  await tx.run(
    `UPDATE users SET email = new_email, email_verified = true, registration_pending = false,
               ${WITHOUT_EMAIL_NEW}, ${WITHOUT_RESET_LINK} WHERE id = $1`,
    [id],
  );
  return true;
}

/** A failure consumes the link as well. */
export async function discardEmailNew(db: DbInterface, id: number, hash: string): Promise<void> {
  await db.run(`UPDATE users SET ${WITHOUT_EMAIL_NEW} WHERE id = $1 AND new_email_token = $2`, [id, hash]);
}

/** Only the name: whoever has the link sees before redeeming which account it belongs to. */
export async function nameForEmailToken(db: DbInterface, hash: string): Promise<string | null> {
  return (
    (
      await db.get<{ username: string }>(
        'SELECT username FROM users WHERE new_email_token = $1 AND new_email_until > NOW()',
        [hash],
      )
    )?.username ?? null
  );
}

export async function openRegistrations(db: DbInterface, email: string): Promise<number> {
  return Number(
    (
      await db.get<{ n: string }>(
        'SELECT COUNT(*) AS n FROM users WHERE registration_pending AND LOWER(new_email) = LOWER($1) AND new_email_until > NOW()',
        [email],
      )
    )?.n ?? 0,
  );
}

/** Like adoptEmailNew, but without a link: the address may belong to another account by now.
 * In the caller's transaction; a concurrent winner shows up there as 23505. */
export async function switchRegistrationFree(
  tx: DbInterface,
  id: number,
): Promise<'ok' | 'nicht_wartend' | 'vergeben'> {
  const k = await tx.get<{ new_email: string | null }>(
    'SELECT new_email FROM users WHERE id = $1 AND registration_pending AND NOT email_verified FOR UPDATE',
    [id],
  );
  if (!k) return 'nicht_wartend';
  if (
    k.new_email &&
    (await tx.get<Hit>(
      'SELECT 1 FROM users WHERE id <> $2 AND (LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1))',
      [k.new_email, id],
    ))
  )
    return 'vergeben';
  await tx.run(
    `UPDATE users SET email = COALESCE(new_email, email), email_verified = true, registration_pending = false,
               ${WITHOUT_EMAIL_NEW} WHERE id = $1`,
    [id],
  );
  return 'ok';
}

/** Legacy data from migration 0096: pending without a valid link. */
export async function pendingWithoutLink(db: DbInterface): Promise<number[]> {
  return (
    await db.all<{ id: number }>(
      'SELECT id FROM users WHERE new_email IS NOT NULL AND new_email_until IS NULL AND NOT registration_pending ORDER BY id',
    )
  ).map(z => z.id);
}

export function allAccounts(db: DbInterface): Promise<AccountInList[]> {
  return db.all<AccountInList>(
    `SELECT u.id, u.username, u.is_admin, u.is_active, u.created_at,
            (u.registration_pending AND NOT u.email_verified) AS awaiting_confirmation
       FROM users u ORDER BY u.id`,
  );
}

export function allAddresses(db: DbInterface): Promise<{ id: number; email: string }[]> {
  return db.all<{ id: number; email: string }>(
    `SELECT id, email FROM users WHERE COALESCE(email, '') <> '' ORDER BY id`,
  );
}

export async function activeAdmin(db: DbInterface): Promise<number[]> {
  return (
    await db.all<{ id: number }>('SELECT id FROM users WHERE is_admin AND is_active AND email IS NOT NULL ORDER BY id')
  ).map(z => z.id);
}

/** An assigned password is known to the admin and whoever passed it on: only until the first change. */
export async function addAccountOne(
  db: DbInterface,
  username: string,
  hash: string,
  admin: boolean,
): Promise<number | null> {
  const fresh = await db.get<{ id: number }>(
    'INSERT INTO users (username, password_hash, is_admin, must_change_password) VALUES ($1, $2, $3, true) RETURNING id',
    [username, hash, admin],
  );
  return fresh ? fresh.id : null;
}

export const LAST_ADMIN = 'last_admin' as const;

/** Another active admin than the one in parameter `$1`. */
const OTHER_ADMIN = 'EXISTS (SELECT 1 FROM users v WHERE v.is_admin AND v.is_active AND v.id <> $1)';

/** Without the lock, two concurrent revocations would each still see the other as admin
 * (READ COMMITTED), and none would remain. It holds until the end of the caller's
 * transaction; without one it would end with the query and protect nothing. */
async function belowAdminLock<T>(tx: Db, fn: (tx: DbInterface) => Promise<T>): Promise<T> {
  if (!tx.inTransaction()) throw new Error('Die Verwaltersperre gilt nur in einer Transaktion (k.transact)');
  await tx.get<unknown>('SELECT pg_advisory_xact_lock($1, 0)', [LOCKS.ADMIN_INVENTORY]);
  return fn(tx);
}

/** @returns the state before the change, undefined without an account, or LAST_ADMIN */
export async function setAdmin(
  db: Db,
  id: number,
  ja: boolean,
): Promise<{ vorher: boolean } | typeof LAST_ADMIN | undefined> {
  return belowAdminLock(db, async tx => {
    const r = await tx.get<{ vorher: boolean }>(
      `UPDATE users u SET is_admin = $2 FROM users alt
      WHERE u.id = $1 AND alt.id = u.id AND ($2 OR NOT (alt.is_admin AND alt.is_active) OR ${OTHER_ADMIN})
      RETURNING alt.is_admin AS vorher`,
      [id, ja],
    );
    if (r) return r;
    return (await tx.get<unknown>('SELECT 1 FROM users WHERE id = $1', [id])) ? LAST_ADMIN : undefined;
  });
}

/** @returns the state before the change, undefined without an account, or LAST_ADMIN */
export async function writeActive(
  db: Db,
  id: number,
  ja: boolean,
): Promise<{ vorher: boolean } | typeof LAST_ADMIN | undefined> {
  return belowAdminLock(db, async tx => {
    const r = await tx.get<{ vorher: boolean }>(
      `UPDATE users u SET is_active = $2 FROM users alt
      WHERE u.id = $1 AND alt.id = u.id AND ($2 OR NOT (alt.is_admin AND alt.is_active) OR ${OTHER_ADMIN})
      RETURNING alt.is_active AS vorher`,
      [id, ja],
    );
    if (r) return r;
    return (await tx.get<unknown>('SELECT 1 FROM users WHERE id = $1', [id])) ? LAST_ADMIN : undefined;
  });
}

/** A still-open reset link falls with every new password: it dates from
 * the time before and would otherwise remain valid for another hour. */
const WITHOUT_RESET_LINK = 'reset_token = NULL, reset_token_expires = NULL';

/** A password set by someone else is also known to the admin: the owner replaces it. */
export async function setPasswordHash(db: DbInterface, id: number, hash: string): Promise<boolean> {
  return !!(
    await db.run(
      `UPDATE users SET password_hash = $1, must_change_password = true, ${WITHOUT_RESET_LINK} WHERE id = $2`,
      [hash, id],
    )
  ).changes;
}

/** Own password changed: the request to do so is settled as well. */
export async function setOwnPassword(db: DbInterface, id: number, hash: string): Promise<void> {
  await db.run(
    `UPDATE users SET password_hash = $1, must_change_password = false, ${WITHOUT_RESET_LINK} WHERE id = $2`,
    [hash, id],
  );
}

export async function accountExists(db: DbInterface, id: number): Promise<boolean> {
  return !!(await db.get<Hit>('SELECT 1 FROM users WHERE id = $1', [id]));
}

/** Also from the copies made before migrations; the name in the log is taken by cleanLogOn(). */
async function deleteTraces(tx: DbInterface, id: number): Promise<void> {
  await removeAccountFromBackups(tx, id);
}

/** Never the own account and never the last active admin.
 * @returns false without an account or for the own one */
export async function deleteAccount(db: Db, id: number, own: number | null): Promise<boolean | typeof LAST_ADMIN> {
  return belowAdminLock(db, async tx => {
    if (
      (
        await tx.run(
          `DELETE FROM users WHERE id = $1 AND id != $2
      AND (NOT (is_admin AND is_active) OR ${OTHER_ADMIN})`,
          [id, own],
        )
      ).changes
    ) {
      await deleteTraces(tx, id);
      return true;
    }
    return (await tx.get<unknown>('SELECT 1 FROM users WHERE id = $1 AND id != $2', [id, own])) ? LAST_ADMIN : false;
  });
}

/** The own account; the last active admin stays. */
export async function deleteOwnAccount(db: Db, id: number): Promise<boolean> {
  return belowAdminLock(db, async tx => {
    if (
      !(
        await tx.run(
          `DELETE FROM users WHERE id = $1 AND (NOT is_admin
      OR EXISTS (SELECT 1 FROM users v WHERE v.is_admin AND v.is_active AND v.id <> $1))`,
          [id],
        )
      ).changes
    )
      return false;
    await deleteTraces(tx, id);
    return true;
  });
}

/** Registrations whose address is not confirmed after `tage` days; in the
 * caller's transaction, so no trace remains without its account. */
export async function deleteOpenRegistrations(tx: DbInterface, days: number): Promise<number> {
  const route = await tx.all<{ id: number }>(
    `DELETE FROM users WHERE registration_pending AND NOT email_verified AND NOT is_admin
      AND created_at < NOW() - make_interval(days => $1::int) RETURNING id`,
    [days],
  );
  for (const { id } of route) await deleteTraces(tx, id);
  return route.length;
}

export function accountWithEmail(
  db: DbInterface,
  email: string,
): Promise<(Omit<AccountShort, 'must_change_password'> & { email: string }) | undefined> {
  // The condition on email excludes NULL.
  return db.get<Columns<'users', 'id' | 'username' | 'is_admin'> & { email: string }>(
    'SELECT id, username, is_admin, email FROM users WHERE LOWER(email) = LOWER($1)',
    [email],
  );
}

/** Without RETURNING: for an INSERT without ON CONFLICT the compat layer appends
 * `ON CONFLICT DO NOTHING` itself; RETURNING after that would be a syntax error. */
export async function registerAccount(
  db: DbInterface,
  k: {
    username: string;
    email: string;
    first_name?: string | null | undefined;
    last_name?: string | null | undefined;
    hash: string;
    tokenHash: string;
    bis: Date;
  },
): Promise<number | null> {
  await db.run(
    `INSERT INTO users (username, new_email, new_email_token, new_email_until, first_name, last_name, password_hash,
                        is_admin, is_active, email_verified, registration_pending) VALUES ($1,$2,$3,$4,$5,$6,$7,false,true,false,true)`,
    [k.username, k.email, k.tokenHash, k.bis, k.first_name || null, k.last_name || null, k.hash],
  );
  const fresh = await db.get<{ id: number }>('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [k.username]);
  return fresh?.id ?? null;
}

export function activeAccountAfterEmail(db: DbInterface, email: string): Promise<Account | undefined> {
  return db.get<Account>(
    `SELECT ${ACCOUNT_COLUMNS} FROM users WHERE LOWER(email) = LOWER($1) AND is_active AND email_verified`,
    [email],
  );
}

/** The time of the last link follows from its expiry; the condition
 * in the UPDATE lets only one through even with concurrent requests.
 * @returns false if the last link is younger than `pauseMin` */
export async function setResetTokenIfFree(
  db: DbInterface,
  id: number,
  hash: string,
  validMin: number,
  pauseMin: number,
): Promise<boolean> {
  return !!(
    await db.run(
      `UPDATE users SET reset_token = $1, reset_token_expires = NOW() + make_interval(mins => $2::int)
      WHERE id = $3 AND (reset_token_expires IS NULL
                         OR reset_token_expires < NOW() + make_interval(mins => $2::int - $4::int))`,
      [hash, validMin, id, pauseMin],
    )
  ).changes;
}

/** Like setRuecksetzTokenIfFree. Only if exactly one open registration names the address:
 * with several, a link to an account created by someone else would go to its owner. */
export function renewEmailTokenIfFree(
  db: DbInterface,
  email: string,
  hash: string,
  validStd: number,
  pauseMin: number,
) {
  return db.get<{ id: number; email: string }>(
    `UPDATE users u SET new_email_token = $2, new_email_until = NOW() + make_interval(hours => $3::int)
       FROM (SELECT MIN(id) AS id FROM users WHERE registration_pending AND LOWER(new_email) = LOWER($1)
             HAVING COUNT(*) = 1) e
      WHERE u.id = e.id AND u.is_active
        AND (u.new_email_until IS NULL OR u.new_email_until < NOW() + make_interval(hours => $3::int, mins => -$4::int))
      RETURNING u.id, u.new_email AS email`,
    [email, hash, validStd, pauseMin],
  );
}

export function accountAfterResetToken(
  db: DbInterface,
  hash: string,
): Promise<{ id: number; username: string } | undefined> {
  return db.get<Columns<'users', 'id' | 'username'>>(
    'SELECT id, username FROM users WHERE reset_token = $1 AND reset_token_expires > NOW()',
    [hash],
  );
}

/** Check and consume in one statement: otherwise two concurrent requests with
 * the same link would both set a password. */
export function resetSetPasswordAfter(
  db: DbInterface,
  tokenHash: string,
  hash: string,
): Promise<{ id: number } | undefined> {
  return db.get<{ id: number }>(
    `UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL
    WHERE reset_token = $2 AND reset_token_expires > NOW() RETURNING id`,
    [hash, tokenHash],
  );
}

export interface Access {
  token: string;
  label: string | null;
  created_at: Date;
  last_used: Date | null;
  hard_expires_at: Date | null;
  expires_at: Date | null;
  scope: 'app' | 'voll';
  ip_range: string | null;
  never_expires: boolean;
  rotated_at: Date;
}

/** A swapped token within its overlap no longer counts as a device of its own. */
export function accessesOfAccount(db: DbInterface, uid: number): Promise<Access[]> {
  return db.all<Access>(
    `SELECT token, label, created_at, last_used, hard_expires_at, LEAST(expires_at, hard_expires_at) AS expires_at,
            scope, ip_range, never_expires, rotated_at
       FROM api_tokens
      WHERE user_id = $1 AND replaced_by IS NULL
        AND (expires_at IS NULL OR expires_at > NOW())
        AND (hard_expires_at IS NULL OR hard_expires_at > NOW())
      ORDER BY created_at DESC`,
    [uid],
  );
}

export function tokenStand(
  db: DbInterface,
  hash: string,
): Promise<
  | {
      scope: 'app' | 'voll';
      expires_at: Date | null;
      hard_expires_at: Date | null;
      never_expires: boolean;
      rotated_at: Date;
    }
  | undefined
> {
  return db.get(
    `SELECT scope, LEAST(expires_at, hard_expires_at) AS expires_at, hard_expires_at, never_expires, rotated_at
       FROM api_tokens WHERE token = $1`,
    [hash],
  );
}

/** Equality on the whole identifier, no prefix. A predecessor within its
 * overlap goes too, but does not count as a device of its own. */
export async function deleteAccess(
  db: DbInterface,
  uid: number,
  key: string,
): Promise<{ count: number; label: string | null }> {
  const r = await db.get<{ n: number; label: string | null }>(
    `WITH weg AS (DELETE FROM api_tokens WHERE user_id = $1 AND (left(token, 16) = $2 OR left(replaced_by, 16) = $2)
                  RETURNING replaced_by, label)
     SELECT count(*) FILTER (WHERE replaced_by IS NULL)::int AS n, max(label) AS label FROM weg`,
    [uid, key],
  );
  return { count: r?.n ?? 0, label: r?.label ?? null };
}

/** All app accesses except `eigener`, including its predecessor and successor within the overlap. */
export async function deleteOtherAccesses(db: DbInterface, uid: number, own: string | null): Promise<number> {
  const r = await db.get<{ n: number }>(
    `WITH weg AS (DELETE FROM api_tokens WHERE user_id = $1 AND ($2::text IS NULL OR (token <> $2
                    AND replaced_by IS DISTINCT FROM $2
                    AND token IS DISTINCT FROM (SELECT replaced_by FROM api_tokens WHERE token = $2)))
                  RETURNING replaced_by)
     SELECT count(*) FILTER (WHERE replaced_by IS NULL)::int AS n FROM weg`,
    [uid, own],
  );
  return r?.n ?? 0;
}

export async function deleteOtherSessions(db: DbInterface, uid: number, ownSidHash: string): Promise<number> {
  return (
    await db.run("DELETE FROM user_sessions WHERE sess::jsonb->>'userId' = $1 AND sid <> $2", [String(uid), ownSidHash])
  ).changes;
}

export async function mustChangePassword(db: DbInterface, uid: number): Promise<boolean> {
  const r = await db.get<{ must_change_password: boolean }>('SELECT must_change_password FROM users WHERE id = $1', [
    uid,
  ]);
  return r?.must_change_password === true;
}

export function accountToNames(db: DbInterface, name: string) {
  return db.get<{ kennung: string; id: number | null }>(
    `
    SELECT lower($1::text) AS kennung,
           (SELECT id FROM users WHERE lower(username) = lower($1::text) OR lower(email) = lower($1::text)
             ORDER BY id LIMIT 1) AS id`,
    [name],
  );
}
