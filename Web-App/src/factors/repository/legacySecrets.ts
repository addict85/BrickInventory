import type { DbSchnittstelle } from '../../../db/database';

/** TOTP secrets without context (v1) or from before encryption. */
export async function legacyFactorSecrets(db: DbSchnittstelle, all = false): Promise<{ uid: number; v: string }[]> {
  return db.all<{ uid: number; v: string }>(
    `SELECT user_id AS uid, secret AS v FROM second_factor${all ? '' : " WHERE secret NOT LIKE 'v2:%'"}`,
  );
}

/** `AND secret = $3`: if another process has since changed the row, it stays as is. @returns changed rows */
export async function replaceFactorSecret(db: DbSchnittstelle, uid: number, old: string, neu: string): Promise<number> {
  return (
    (await db.run('UPDATE second_factor SET secret = $1 WHERE user_id = $2 AND secret = $3', [neu, uid, old]))
      .changes || 0
  );
}
