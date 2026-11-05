import * as db from '../../../db/database';

/** TOTP-Geheimnisse ohne Kontext (v1) oder aus der Zeit vor der Verschlüsselung. */
export async function alteFaktorGeheimnisse(alle = false): Promise<{ uid: number; v: string }[]> {
  return db.all<{ uid: number; v: string }>(
    `SELECT user_id AS uid, geheimnis AS v FROM zweiter_faktor${alle ? '' : " WHERE geheimnis NOT LIKE 'v2:%'"}`);
}

/** `AND geheimnis = $3`: Hat ein anderer Prozess die Zeile inzwischen geändert, bleibt sie. @returns geänderte Zeilen */
export async function ersetzeFaktorGeheimnis(uid: number, alt: string, neu: string): Promise<number> {
  return (await db.run('UPDATE zweiter_faktor SET geheimnis = $1 WHERE user_id = $2 AND geheimnis = $3', [neu, uid, alt])).changes || 0;
}
