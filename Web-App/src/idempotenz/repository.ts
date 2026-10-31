import * as db from '../../db/database';

/** Datenzugriff für Idempotenzschlüssel (Migration 0084). */

export type Eintrag = { anfrage: string; status: number | null; antwort: string | null };

/**
 * Den Schlüssel für diese Anfrage belegen. Ein Eintrag, dessen erste Anfrage
 * nach `verwaistNachS` noch nicht fertig ist, gilt als abgebrochen (Absturz)
 * und wird neu belegt. @returns ob belegt wurde
 */
export async function belege(uid: number, schluessel: string, anfrage: string, verwaistNachS: number): Promise<boolean> {
  return !!await db.get(
    `INSERT INTO idempotenz (user_id, schluessel, anfrage) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, schluessel) DO UPDATE SET anfrage = EXCLUDED.anfrage, angelegt = NOW()
       WHERE idempotenz.status IS NULL AND idempotenz.angelegt < NOW() - make_interval(secs => $4)
     RETURNING 1 AS ok`, [uid, schluessel, anfrage, verwaistNachS]);
}

export function eintrag(uid: number, schluessel: string) {
  return db.get<Eintrag>('SELECT anfrage, status, antwort FROM idempotenz WHERE user_id = $1 AND schluessel = $2',
    [uid, schluessel]);
}

export async function schliesseAb(uid: number, schluessel: string, status: number, antwort: string): Promise<void> {
  await db.run('UPDATE idempotenz SET status = $3, antwort = $4 WHERE user_id = $1 AND schluessel = $2',
    [uid, schluessel, status, antwort]);
}

/** Nur einen laufenden Eintrag: Eine fertige Antwort bleibt bis zum Ablauf der Frist. */
export async function loescheLaufenden(uid: number, schluessel: string): Promise<void> {
  await db.run('DELETE FROM idempotenz WHERE user_id = $1 AND schluessel = $2 AND status IS NULL', [uid, schluessel]);
}

export async function loescheAelterAls(stunden: number): Promise<number> {
  return (await db.run('DELETE FROM idempotenz WHERE angelegt < NOW() - make_interval(hours => $1)', [stunden])).changes || 0;
}
