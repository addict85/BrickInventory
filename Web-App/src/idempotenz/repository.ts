import type { DbSchnittstelle, Db } from '../../db/database';

export type Eintrag = {
  request: string;
  status: number | null;
  response: string | null;
  has_effect: boolean;
  verwaist: boolean;
};

/** Ein Eintrag, dessen erste Anfrage nach `verwaistNachS` nicht fertig ist,
 * wird neu belegt. @returns ob belegt wurde */
export async function belege(
  db: DbSchnittstelle,
  uid: number,
  key: string,
  request: string,
  verwaistNachS: number,
): Promise<boolean> {
  return !!(await db.get<{ ok: number }>(
    `INSERT INTO idempotency (user_id, key, request) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, key) DO UPDATE SET request = EXCLUDED.request, created_at = NOW()
       WHERE idempotency.status IS NULL AND NOT idempotency.has_effect
         AND idempotency.created_at < NOW() - make_interval(secs => $4)
     RETURNING 1 AS ok`,
    [uid, key, request, verwaistNachS],
  ));
}

export function eintrag(db: DbSchnittstelle, uid: number, key: string, verwaistNachS: number) {
  return db.get<Eintrag>(
    `SELECT request, status, response, has_effect, created_at < NOW() - make_interval(secs => $3) AS verwaist
       FROM idempotency WHERE user_id = $1 AND key = $2`,
    [uid, key, verwaistNachS],
  );
}

/** Jede Transaktion in `arbeit` vermerkt vor ihrem COMMIT, in ihr, die Wirkung am Schlüssel. */
export function mitWirkungsVermerk<T>(db: Db, uid: number, key: string, arbeit: () => T): T {
  return db.mitCommitBegleiter(async (tx: DbSchnittstelle) => {
    await tx.run(
      'UPDATE idempotency SET has_effect = true WHERE user_id = $1 AND key = $2 AND status IS NULL AND NOT has_effect',
      [uid, key],
    );
  }, arbeit);
}

export async function schliesseAb(
  db: DbSchnittstelle,
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

/** Eine fertige Antwort bleibt bis zum Ablauf der Frist; ein Eintrag mit Wirkung
 * wird ohne Antwort abgeschlossen, statt eine zweite zuzulassen. */
export async function loescheLaufenden(db: DbSchnittstelle, uid: number, key: string, status: number): Promise<void> {
  await db.run(
    `WITH weg AS (DELETE FROM idempotency WHERE user_id = $1 AND key = $2 AND status IS NULL AND NOT has_effect)
     UPDATE idempotency SET status = $3, response = NULL WHERE user_id = $1 AND key = $2 AND status IS NULL AND has_effect`,
    [uid, key, status],
  );
}

export async function loescheAndereAbdruecke(db: DbSchnittstelle, praefix: string): Promise<number> {
  return (await db.run("DELETE FROM idempotency WHERE request NOT LIKE $1 || '%'", [praefix])).changes || 0;
}

export async function loescheAelterAls(db: DbSchnittstelle, stunden: number): Promise<number> {
  return (
    (await db.run('DELETE FROM idempotency WHERE created_at < NOW() - make_interval(hours => $1)', [stunden]))
      .changes || 0
  );
}

export function alteAntworten(db: DbSchnittstelle) {
  return db.all<{ user_id: number; key: string; response: string }>(
    "SELECT user_id, key, response FROM idempotency WHERE response IS NOT NULL AND response NOT LIKE 'v2:%'",
  );
}

/** `AND response = $3`: Eine inzwischen neu geschriebene Zeile bleibt. */
export async function ersetzeAntwort(
  db: DbSchnittstelle,
  uid: number,
  key: string,
  alt: string,
  neu: string,
): Promise<number> {
  return (
    (
      await db.run('UPDATE idempotency SET response = $4 WHERE user_id = $1 AND key = $2 AND response = $3', [
        uid,
        key,
        alt,
        neu,
      ])
    ).changes || 0
  );
}
