import * as db from '../../../db/database';
import type { DbSchnittstelle } from '../../../db/database';

/**
 * Zähler der Anmeldebremse (rate_limit_attempts). Ein Zähler gilt ein Fenster
 * lang ab dem ersten Versuch; `laufend` zählt Prüfungen, die gerade laufen,
 * damit gleichzeitige Versuche die Grenze nicht gemeinsam überspringen.
 */

export type ZaehlerZeile = { count: string; wait_min: string; seit: string };

/** Nur ein Zähler, dessen Fenster noch offen ist. */
export function lies(key: string, fensterMin: number) {
  return db.get<ZaehlerZeile>(
    `SELECT count, EXTRACT(EPOCH FROM (first_at + make_interval(mins => $2) - NOW()))/60 AS wait_min,
            EXTRACT(EPOCH FROM (NOW() - COALESCE(last_at, first_at))) AS seit
       FROM rate_limit_attempts
      WHERE key = $1 AND first_at > NOW() - make_interval(mins => $2)`, [key, fensterMin]);
}

/** Ein Fehlversuch: zählt hoch, beginnt nach Ablauf des Fensters neu und gibt den Laufplatz frei. */
export async function erhoehe(key: string, fensterMin: number): Promise<void> {
  await db.run(
    `INSERT INTO rate_limit_attempts (key, count, first_at, last_at) VALUES ($1, 1, NOW(), NOW())
     ON CONFLICT (key) DO UPDATE SET
       last_at  = NOW(),
       count    = CASE WHEN rate_limit_attempts.first_at < NOW() - make_interval(mins => $2)
                       THEN 1 ELSE rate_limit_attempts.count + 1 END,
       first_at = CASE WHEN rate_limit_attempts.first_at < NOW() - make_interval(mins => $2)
                       THEN NOW() ELSE rate_limit_attempts.first_at END,
       laufend  = GREATEST(rate_limit_attempts.laufend - 1, 0)`, [key, fensterMin]);
}

export type Sperrstand = {
  count: string; laufend: string; abgelaufen: boolean; laufend_alt: boolean; wait_min: string; seit: string;
};

/** Legt den Zähler bei Bedarf an und sperrt ihn bis zum Ende der Transaktion. */
export async function sperre(tx: DbSchnittstelle, key: string, fensterMin: number, laufendVerfallS: number): Promise<Sperrstand> {
  await tx.run(`INSERT INTO rate_limit_attempts (key, count, first_at, last_at, laufend)
                VALUES ($1, 0, NOW(), NULL, 0) ON CONFLICT (key) DO NOTHING`, [key]);
  return (await tx.get<Sperrstand>(
    `SELECT count, laufend,
            first_at < NOW() - make_interval(mins => $2) AS abgelaufen,
            COALESCE(laufend_seit < NOW() - make_interval(secs => $3), TRUE) AS laufend_alt,
            EXTRACT(EPOCH FROM (first_at + make_interval(mins => $2) - NOW()))/60 AS wait_min,
            EXTRACT(EPOCH FROM (NOW() - COALESCE(last_at, first_at))) AS seit
       FROM rate_limit_attempts WHERE key = $1 FOR UPDATE`, [key, fensterMin, laufendVerfallS]))!;
}

/** @param neu das Fenster war abgelaufen und beginnt jetzt neu */
export async function belegeLaufplatz(tx: DbSchnittstelle, key: string, laufend: number, neu: boolean): Promise<void> {
  await tx.run(
    `UPDATE rate_limit_attempts
        SET laufend = $2, laufend_seit = NOW(),
            count = CASE WHEN $3 THEN 0 ELSE count END,
            first_at = CASE WHEN $3 THEN NOW() ELSE first_at END
      WHERE key = $1`, [key, laufend, neu]);
}

export async function gibLaufplatzFrei(key: string): Promise<void> {
  await db.run('UPDATE rate_limit_attempts SET laufend = GREATEST(laufend - 1, 0) WHERE key = $1', [key]);
}

export async function loescheZaehler(key: string): Promise<void> {
  await db.run('DELETE FROM rate_limit_attempts WHERE key = $1', [key]);
}

/** Die Kennung zählt je Konto: Name und E-Mail desselben Kontos teilen sich einen Zähler. */
export function kontoZumNamen(name: string) {
  return db.get<{ kennung: string; id: number | null }>(`
    SELECT lower($1::text) AS kennung,
           (SELECT id FROM users WHERE lower(username) = lower($1::text) OR lower(email) = lower($1::text)
             ORDER BY id LIMIT 1) AS id`, [name]);
}

/** Bekannte Paare (Adresse, Konto) gelten länger als ein Tag; alles andere verfällt nach einem Tag. */
export async function raeumeAuf(bekanntMin: number): Promise<number> {
  return (await db.run(`
    DELETE FROM rate_limit_attempts
     WHERE COALESCE(last_at, first_at) < NOW() - CASE WHEN key LIKE 'login-bekannt|%'
                                                     THEN make_interval(mins => $1) ELSE interval '1 day' END`,
    [bekanntMin])).changes || 0;
}

/** Zählt eine Anfrage und liefert den neuen Stand in einem Schritt. */
export async function zaehleHoch(key: string, fensterMin: number): Promise<{ count: string; wait_min: string }> {
  return (await db.get<{ count: string; wait_min: string }>(
    `INSERT INTO rate_limit_attempts (key, count, first_at, last_at) VALUES ($1, 1, NOW(), NOW())
     ON CONFLICT (key) DO UPDATE SET
       last_at  = NOW(),
       count    = CASE WHEN rate_limit_attempts.first_at < NOW() - make_interval(mins => $2)
                       THEN 1 ELSE rate_limit_attempts.count + 1 END,
       first_at = CASE WHEN rate_limit_attempts.first_at < NOW() - make_interval(mins => $2)
                       THEN NOW() ELSE rate_limit_attempts.first_at END
     RETURNING count, EXTRACT(EPOCH FROM (first_at + make_interval(mins => $2) - NOW()))/60 AS wait_min`,
    [key, fensterMin]))!;
}
