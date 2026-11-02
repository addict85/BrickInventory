import * as db from '../../db/database';

export type Eintrag = { anfrage: string; status: number | null; antwort: string | null };

/** Ein Eintrag, dessen erste Anfrage nach `verwaistNachS` nicht fertig ist,
 * wird neu belegt. @returns ob belegt wurde */
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

export async function schliesseAb(uid: number, schluessel: string, status: number, antwort: string | null): Promise<void> {
  await db.run('UPDATE idempotenz SET status = $3, antwort = $4 WHERE user_id = $1 AND schluessel = $2',
    [uid, schluessel, status, antwort]);
}

/** Eine fertige Antwort bleibt bis zum Ablauf der Frist. */
export async function loescheLaufenden(uid: number, schluessel: string): Promise<void> {
  await db.run('DELETE FROM idempotenz WHERE user_id = $1 AND schluessel = $2 AND status IS NULL', [uid, schluessel]);
}

export async function loescheAndereAbdruecke(praefix: string): Promise<number> {
  return (await db.run("DELETE FROM idempotenz WHERE anfrage NOT LIKE $1 || '%'", [praefix])).changes || 0;
}

export async function loescheAelterAls(stunden: number): Promise<number> {
  return (await db.run('DELETE FROM idempotenz WHERE angelegt < NOW() - make_interval(hours => $1)', [stunden])).changes || 0;
}

export function alteAntworten() {
  return db.all<{ user_id: number; schluessel: string; antwort: string }>(
    "SELECT user_id, schluessel, antwort FROM idempotenz WHERE antwort IS NOT NULL AND antwort NOT LIKE 'v2:%'");
}

/** `AND antwort = $3`: Eine inzwischen neu geschriebene Zeile bleibt. */
export async function ersetzeAntwort(uid: number, schluessel: string, alt: string, neu: string): Promise<number> {
  return (await db.run('UPDATE idempotenz SET antwort = $4 WHERE user_id = $1 AND schluessel = $2 AND antwort = $3',
    [uid, schluessel, alt, neu])).changes || 0;
}
