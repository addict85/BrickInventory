import type { DbSchnittstelle, Db } from '../../db/database';

export type Eintrag = {
  anfrage: string;
  status: number | null;
  antwort: string | null;
  wirkung: boolean;
  verwaist: boolean;
};

/** Ein Eintrag, dessen erste Anfrage nach `verwaistNachS` nicht fertig ist,
 * wird neu belegt. @returns ob belegt wurde */
export async function belege(
  db: DbSchnittstelle,
  uid: number,
  schluessel: string,
  anfrage: string,
  verwaistNachS: number,
): Promise<boolean> {
  return !!(await db.get(
    `INSERT INTO idempotenz (user_id, schluessel, anfrage) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, schluessel) DO UPDATE SET anfrage = EXCLUDED.anfrage, angelegt = NOW()
       WHERE idempotenz.status IS NULL AND NOT idempotenz.wirkung
         AND idempotenz.angelegt < NOW() - make_interval(secs => $4)
     RETURNING 1 AS ok`,
    [uid, schluessel, anfrage, verwaistNachS],
  ));
}

export function eintrag(db: DbSchnittstelle, uid: number, schluessel: string, verwaistNachS: number) {
  return db.get<Eintrag>(
    `SELECT anfrage, status, antwort, wirkung, angelegt < NOW() - make_interval(secs => $3) AS verwaist
       FROM idempotenz WHERE user_id = $1 AND schluessel = $2`,
    [uid, schluessel, verwaistNachS],
  );
}

/** Jede Transaktion in `arbeit` vermerkt vor ihrem COMMIT, in ihr, die Wirkung am Schlüssel. */
export function mitWirkungsVermerk<T>(db: Db, uid: number, schluessel: string, arbeit: () => T): T {
  return db.mitCommitBegleiter(async (tx: DbSchnittstelle) => {
    await tx.run(
      'UPDATE idempotenz SET wirkung = true WHERE user_id = $1 AND schluessel = $2 AND status IS NULL AND NOT wirkung',
      [uid, schluessel],
    );
  }, arbeit);
}

export async function schliesseAb(
  db: DbSchnittstelle,
  uid: number,
  schluessel: string,
  status: number,
  antwort: string | null,
): Promise<void> {
  await db.run('UPDATE idempotenz SET status = $3, antwort = $4 WHERE user_id = $1 AND schluessel = $2', [
    uid,
    schluessel,
    status,
    antwort,
  ]);
}

/** Eine fertige Antwort bleibt bis zum Ablauf der Frist; ein Eintrag mit Wirkung
 * wird ohne Antwort abgeschlossen, statt eine zweite zuzulassen. */
export async function loescheLaufenden(
  db: DbSchnittstelle,
  uid: number,
  schluessel: string,
  status: number,
): Promise<void> {
  await db.run(
    `WITH weg AS (DELETE FROM idempotenz WHERE user_id = $1 AND schluessel = $2 AND status IS NULL AND NOT wirkung)
     UPDATE idempotenz SET status = $3, antwort = NULL WHERE user_id = $1 AND schluessel = $2 AND status IS NULL AND wirkung`,
    [uid, schluessel, status],
  );
}

export async function loescheAndereAbdruecke(db: DbSchnittstelle, praefix: string): Promise<number> {
  return (await db.run("DELETE FROM idempotenz WHERE anfrage NOT LIKE $1 || '%'", [praefix])).changes || 0;
}

export async function loescheAelterAls(db: DbSchnittstelle, stunden: number): Promise<number> {
  return (
    (await db.run('DELETE FROM idempotenz WHERE angelegt < NOW() - make_interval(hours => $1)', [stunden])).changes || 0
  );
}

export function alteAntworten(db: DbSchnittstelle) {
  return db.all<{ user_id: number; schluessel: string; antwort: string }>(
    "SELECT user_id, schluessel, antwort FROM idempotenz WHERE antwort IS NOT NULL AND antwort NOT LIKE 'v2:%'",
  );
}

/** `AND antwort = $3`: Eine inzwischen neu geschriebene Zeile bleibt. */
export async function ersetzeAntwort(
  db: DbSchnittstelle,
  uid: number,
  schluessel: string,
  alt: string,
  neu: string,
): Promise<number> {
  return (
    (
      await db.run('UPDATE idempotenz SET antwort = $4 WHERE user_id = $1 AND schluessel = $2 AND antwort = $3', [
        uid,
        schluessel,
        alt,
        neu,
      ])
    ).changes || 0
  );
}
