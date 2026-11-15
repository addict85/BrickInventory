import type { DbSchnittstelle } from '../../db/database';

/** `laufend` zählt Prüfungen, die gerade laufen, damit gleichzeitige Versuche
 * die Grenze nicht gemeinsam überspringen. */

export type ZaehlerZeile = { count: string; wait_min: string; seit: string };

export function lies(db: DbSchnittstelle, key: string, fensterMin: number) {
  return db.get<ZaehlerZeile>(
    `SELECT count, EXTRACT(EPOCH FROM (first_at + make_interval(mins => $2) - NOW()))/60 AS wait_min,
            EXTRACT(EPOCH FROM (NOW() - COALESCE(last_at, first_at))) AS seit
       FROM rate_limit_attempts
      WHERE key = $1 AND first_at > NOW() - make_interval(mins => $2)`,
    [key, fensterMin],
  );
}

export async function erhoehe(db: DbSchnittstelle, key: string, fensterMin: number): Promise<number> {
  return Number(
    (
      await db.get<{ count: string }>(
        `INSERT INTO rate_limit_attempts (key, count, first_at, last_at) VALUES ($1, 1, NOW(), NOW())
     ON CONFLICT (key) DO UPDATE SET
       last_at  = NOW(),
       count    = CASE WHEN rate_limit_attempts.first_at < NOW() - make_interval(mins => $2)
                       THEN 1 ELSE rate_limit_attempts.count + 1 END,
       first_at = CASE WHEN rate_limit_attempts.first_at < NOW() - make_interval(mins => $2)
                       THEN NOW() ELSE rate_limit_attempts.first_at END,
       laufend  = GREATEST(rate_limit_attempts.laufend - 1, 0)
     RETURNING count`,
        [key, fensterMin],
      )
    )?.count ?? 0,
  );
}

export type Sperrstand = {
  count: string;
  laufend: string;
  abgelaufen: boolean;
  laufend_alt: boolean;
  wait_min: string;
  seit: string;
};

export async function sperre(
  tx: DbSchnittstelle,
  key: string,
  fensterMin: number,
  laufendVerfallS: number,
): Promise<Sperrstand> {
  await tx.run(
    `INSERT INTO rate_limit_attempts (key, count, first_at, last_at, laufend)
                VALUES ($1, 0, NOW(), NULL, 0) ON CONFLICT (key) DO NOTHING`,
    [key],
  );
  return (await tx.get<Sperrstand>(
    `SELECT count, laufend,
            first_at < NOW() - make_interval(mins => $2) AS abgelaufen,
            COALESCE(laufend_seit < NOW() - make_interval(secs => $3), TRUE) AS laufend_alt,
            EXTRACT(EPOCH FROM (first_at + make_interval(mins => $2) - NOW()))/60 AS wait_min,
            EXTRACT(EPOCH FROM (NOW() - COALESCE(last_at, first_at))) AS seit
       FROM rate_limit_attempts WHERE key = $1 FOR UPDATE`,
    [key, fensterMin, laufendVerfallS],
  ))!;
}

export async function belegeLaufplatz(tx: DbSchnittstelle, key: string, laufend: number, neu: boolean): Promise<void> {
  await tx.run(
    `UPDATE rate_limit_attempts
        SET laufend = $2, laufend_seit = NOW(),
            count = CASE WHEN $3 THEN 0 ELSE count END,
            first_at = CASE WHEN $3 THEN NOW() ELSE first_at END
      WHERE key = $1`,
    [key, laufend, neu],
  );
}

export async function gibLaufplatzFrei(db: DbSchnittstelle, key: string): Promise<void> {
  await db.run('UPDATE rate_limit_attempts SET laufend = GREATEST(laufend - 1, 0) WHERE key = $1', [key]);
}

export async function loescheZaehler(db: DbSchnittstelle, key: string): Promise<void> {
  await db.run('DELETE FROM rate_limit_attempts WHERE key = $1', [key]);
}

export async function loescheZaehlerMitPraefix(db: DbSchnittstelle, praefix: string): Promise<void> {
  await db.run('DELETE FROM rate_limit_attempts WHERE left(key, length($1)) = $1', [praefix]);
}

export async function raeumeAuf(db: DbSchnittstelle, bekanntMin: number): Promise<number> {
  return (
    (
      await db.run(
        `
    DELETE FROM rate_limit_attempts
     WHERE COALESCE(last_at, first_at) < NOW() - CASE WHEN key LIKE 'login-bekannt|%'
                                                     THEN make_interval(mins => $1) ELSE interval '1 day' END`,
        [bekanntMin],
      )
    ).changes || 0
  );
}

export async function zaehleHoch(
  db: DbSchnittstelle,
  key: string,
  fensterMin: number,
): Promise<{ count: string; wait_min: string }> {
  return (await db.get<{ count: string; wait_min: string }>(
    `INSERT INTO rate_limit_attempts (key, count, first_at, last_at) VALUES ($1, 1, NOW(), NOW())
     ON CONFLICT (key) DO UPDATE SET
       last_at  = NOW(),
       count    = CASE WHEN rate_limit_attempts.first_at < NOW() - make_interval(mins => $2)
                       THEN 1 ELSE rate_limit_attempts.count + 1 END,
       first_at = CASE WHEN rate_limit_attempts.first_at < NOW() - make_interval(mins => $2)
                       THEN NOW() ELSE rate_limit_attempts.first_at END
     RETURNING count, EXTRACT(EPOCH FROM (first_at + make_interval(mins => $2) - NOW()))/60 AS wait_min`,
    [key, fensterMin],
  ))!;
}

/** Je Konto und Stunde (Guthabenabfrage): Die Grenze fällt erst nach einer vollen Stunde. */
export function stundenStand(tx: DbSchnittstelle, key: string) {
  return tx.get<{ anzahl: number; warten_sek: number }>(
    `SELECT count AS anzahl,
       CEIL(EXTRACT(EPOCH FROM (first_at + INTERVAL '1 hour' - NOW())))::int AS warten_sek
     FROM rate_limit_attempts WHERE key = $1 AND first_at > NOW() - INTERVAL '1 hour'`,
    [key],
  );
}

export async function zaehleStunde(tx: DbSchnittstelle, key: string): Promise<void> {
  await tx.run(
    `INSERT INTO rate_limit_attempts (key, count, first_at, last_at) VALUES ($1, 1, NOW(), NOW())
     ON CONFLICT (key) DO UPDATE SET last_at = NOW(),
       count = CASE WHEN rate_limit_attempts.first_at <= NOW() - INTERVAL '1 hour' THEN 1 ELSE rate_limit_attempts.count + 1 END,
       first_at = CASE WHEN rate_limit_attempts.first_at <= NOW() - INTERVAL '1 hour' THEN NOW() ELSE rate_limit_attempts.first_at END`,
    [key],
  );
}

/** Zählen und Stand liefern in einem Schritt: eine Zeile, wenn der Tag frei war. */
export function einmalJeTag(db: DbSchnittstelle, key: string) {
  return db.get<{ key: string }>(
    `INSERT INTO rate_limit_attempts (key, count, first_at, last_at) VALUES ($1, 1, NOW(), NOW())
     ON CONFLICT (key) DO UPDATE SET count = 1, first_at = NOW(), last_at = NOW()
       WHERE rate_limit_attempts.first_at < NOW() - INTERVAL '1 day'
     RETURNING key`,
    [key],
  );
}
