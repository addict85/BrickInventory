import type { DbInterface } from '../../../db/database';

/** TOTP secrets without context (v1) or from before encryption. */
export async function legacyFactorSecrets(db: DbInterface, all = false): Promise<{ uid: number; v: string }[]> {
  return db.all<{ uid: number; v: string }>(
    `SELECT user_id AS uid, secret AS v FROM second_factor${all ? '' : " WHERE secret NOT LIKE 'v2:%'"}`,
  );
}

/** `AND secret = $3`: if another process has since changed the row, it stays as is. @returns changed rows */
export async function replaceFactorSecret(db: DbInterface, uid: number, old: string, fresh: string): Promise<number> {
  return (
    (await db.run('UPDATE second_factor SET secret = $1 WHERE user_id = $2 AND secret = $3', [fresh, uid, old]))
      .changes || 0
  );
}
