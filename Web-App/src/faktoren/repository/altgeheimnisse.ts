import type { DbSchnittstelle } from '../../../db/database';

/** TOTP-Geheimnisse ohne Kontext (v1) oder aus der Zeit vor der Verschlüsselung. */
export async function alteFaktorGeheimnisse(db: DbSchnittstelle, alle = false): Promise<{ uid: number; v: string }[]> {
  return db.all<{ uid: number; v: string }>(
    `SELECT user_id AS uid, secret AS v FROM second_factor${alle ? '' : " WHERE secret NOT LIKE 'v2:%'"}`,
  );
}

/** `AND geheimnis = $3`: Hat ein anderer Prozess die Zeile inzwischen geändert, bleibt sie. @returns geänderte Zeilen */
export async function ersetzeFaktorGeheimnis(
  db: DbSchnittstelle,
  uid: number,
  alt: string,
  neu: string,
): Promise<number> {
  return (
    (await db.run('UPDATE second_factor SET secret = $1 WHERE user_id = $2 AND secret = $3', [neu, uid, alt]))
      .changes || 0
  );
}
