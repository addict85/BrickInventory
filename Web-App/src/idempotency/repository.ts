import type { DbInterface, Db } from '../../db/database';

export type Entry = {
  request: string;
  status: number | null;
  response: string | null;
  has_effect: boolean;
  orphaned: boolean;
};

/** An entry whose first request is still unfinished after `orphanedAfterS`
 * gets claimed again. @returns whether it was claimed */
export async function receipts(
  db: DbInterface,
  uid: number,
  key: string,
  request: string,
  orphanedAfterS: number,
): Promise<boolean> {
  return !!(await db.get<{ ok: number }>(
    `INSERT INTO idempotency (user_id, key, request) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, key) DO UPDATE SET request = EXCLUDED.request, created_at = NOW()
       WHERE idempotency.status IS NULL AND NOT idempotency.has_effect
         AND idempotency.created_at < NOW() - make_interval(secs => $4)
     RETURNING 1 AS ok`,
    [uid, key, request, orphanedAfterS],
  ));
}

export function entry(db: DbInterface, uid: number, key: string, orphanedAfterS: number) {
  return db.get<Entry>(
    `SELECT request, status, response, has_effect, created_at < NOW() - make_interval(secs => $3) AS verwaist
       FROM idempotency WHERE user_id = $1 AND key = $2`,
    [uid, key, orphanedAfterS],
  );
}

/** Every transaction in `work` marks the effect on the key inside itself, before its COMMIT. */
export function withEffectNote<T>(db: Db, uid: number, key: string, work: () => T): T {
  return db.withCommitCompanion(async (tx: DbInterface) => {
    await tx.run(
      'UPDATE idempotency SET has_effect = true WHERE user_id = $1 AND key = $2 AND status IS NULL AND NOT has_effect',
      [uid, key],
    );
  }, work);
}

export async function finish(
  db: DbInterface,
  uid: number,
  key: string,
  status: number,
  response: string | null,
): Promise<void> {
  await db.run('UPDATE idempotency SET status = $3, response = $4 WHERE user_id = $1 AND key = $2', [
    uid,
    key,
    status,
    response,
  ]);
}

/** A finished response stays until it expires; an entry with an effect is closed
 * without a response instead of allowing a second one. */
export async function deleteRunning(db: DbInterface, uid: number, key: string, status: number): Promise<void> {
  await db.run(
    `WITH weg AS (DELETE FROM idempotency WHERE user_id = $1 AND key = $2 AND status IS NULL AND NOT has_effect)
     UPDATE idempotency SET status = $3, response = NULL WHERE user_id = $1 AND key = $2 AND status IS NULL AND has_effect`,
    [uid, key, status],
  );
}

export async function deleteOtherPrints(db: DbInterface, prefix: string): Promise<number> {
  return (await db.run("DELETE FROM idempotency WHERE request NOT LIKE $1 || '%'", [prefix])).changes || 0;
}

export async function deleteOlderAs(db: DbInterface, hours: number): Promise<number> {
  return (
    (await db.run('DELETE FROM idempotency WHERE created_at < NOW() - make_interval(hours => $1)', [hours])).changes ||
    0
  );
}

export function oldResponses(db: DbInterface) {
  return db.all<{ user_id: number; key: string; response: string }>(
    "SELECT user_id, key, response FROM idempotency WHERE response IS NOT NULL AND response NOT LIKE 'v2:%'",
  );
}

/** `AND response = $3`: a row written anew in the meantime is left alone. */
export async function replaceResponse(
  db: DbInterface,
  uid: number,
  key: string,
  alt: string,
  fresh: string,
): Promise<number> {
  return (
    (
      await db.run('UPDATE idempotency SET response = $4 WHERE user_id = $1 AND key = $2 AND response = $3', [
        uid,
        key,
        alt,
        fresh,
      ])
    ).changes || 0
  );
}
