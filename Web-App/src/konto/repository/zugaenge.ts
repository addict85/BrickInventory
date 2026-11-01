import * as db from '../../../db/database';
import type { DbSchnittstelle } from '../../../db/database';
import { erhoeheSitzungsVersion } from '../sitzungsVersion';

/** Tokens stehen nur als SHA-256 in der Tabelle; jede Funktion nimmt den Hash,
 * nie den Klartext. */

export type TokenScope = 'app' | 'voll';

export type TokenZeile = {
  user_id: number; expires_at: string | Date | null; hard_expires_at: string | Date | null;
  last_used: string | Date | null; sliding: boolean; never_expires: boolean; scope: TokenScope;
  rotiert_am: string | Date | null; vorgaenger: string | null; label: string | null; ip_bereich: string | null;
  username: string; konto_is_admin: boolean; is_admin?: number; muss_passwort_aendern: boolean;
};

/** Fristen und Kontozustand in der Abfrage: Ein abgelaufener Token oder einer
 * eines deaktivierten Kontos wird nie geliefert. */
export function gueltigerToken(hash: string) {
  return db.get<TokenZeile>(`
    SELECT t.user_id, t.expires_at, t.hard_expires_at, t.last_used, t.sliding, t.never_expires,
           t.scope, t.rotiert_am, t.vorgaenger, t.label, t.ip_bereich,
           u.username, u.is_admin AS konto_is_admin, u.must_change_password AS muss_passwort_aendern
    FROM api_tokens t JOIN users u ON u.id = t.user_id
    WHERE t.token = $1 AND u.is_active
      AND (t.expires_at      IS NULL OR t.expires_at      > NOW())
      AND (t.hard_expires_at IS NULL OR t.hard_expires_at > NOW())`, [hash]);
}

export async function beendeUeberlappung(vorgaenger: string, hash: string): Promise<void> {
  await db.run('DELETE FROM api_tokens WHERE token = $1 AND ersetzt_durch = $2', [vorgaenger, hash]);
  await db.run('UPDATE api_tokens SET vorgaenger = NULL WHERE token = $1', [hash]);
}

/** Die WHERE-Klausel lässt höchstens einen Schreibvorgang je Tag durch, auch
 * über mehrere Prozesse. */
export async function beruehreToken(hash: string, leerlaufTage: number, bereich: string | null): Promise<void> {
  await db.run(
    `UPDATE api_tokens
        SET last_used = NOW(),
            ip_bereich = COALESCE($3, ip_bereich),
            expires_at = CASE WHEN sliding AND expires_at IS NOT NULL
                              THEN NOW() + make_interval(days => $2) ELSE expires_at END
      WHERE token = $1
        AND (last_used IS NULL OR last_used < NOW() - INTERVAL '1 day'
             OR (sliding AND expires_at < NOW() + make_interval(days => $2) - INTERVAL '1 day'))`,
    [hash, leerlaufTage, bereich]);
}

export type NeuerToken = {
  hash: string; userId: number; label: string; scope: TokenScope; bereich: string | null;
  /** 'kurz' = sieben feste Tage */
  art: 'unbegrenzt' | 'gleitend' | 'kurz'; leerlaufTage: number; festeTage: number | null;
};

export async function legeTokenAn(t: NeuerToken): Promise<void> {
  if (t.art === 'unbegrenzt') {
    await db.run(
      `INSERT INTO api_tokens (token, user_id, label, expires_at, sliding, hard_expires_at, never_expires, scope, ip_bereich)
       VALUES ($1,$2,$3,NULL,FALSE,NULL,TRUE,$4,$5) ON CONFLICT DO NOTHING`,
      [t.hash, t.userId, t.label, t.scope, t.bereich]);
  } else if (t.art === 'gleitend') {
    await db.run(
      `INSERT INTO api_tokens (token, user_id, label, expires_at, sliding, hard_expires_at, scope, ip_bereich)
       VALUES ($1,$2,$3, NOW() + make_interval(days => $4), TRUE,
               CASE WHEN $5::int IS NULL THEN NULL ELSE NOW() + make_interval(days => $5::int) END, $6, $7)
       ON CONFLICT DO NOTHING`,
      [t.hash, t.userId, t.label, t.leerlaufTage, t.festeTage, t.scope, t.bereich]);
  } else {
    await db.run(
      `INSERT INTO api_tokens (token, user_id, label, expires_at, sliding, scope, ip_bereich)
       VALUES ($1,$2,$3, NOW() + INTERVAL '7 days', FALSE, $4, $5) ON CONFLICT DO NOTHING`,
      [t.hash, t.userId, t.label, t.scope, t.bereich]);
  }
}

export type TauschQuelle = {
  user_id: number; label: string | null; scope: TokenScope; sliding: boolean; never_expires: boolean;
  expires_at: Date | null; hard_expires_at: Date | null; created_at: Date; ersetzt_durch: string | null;
};

/** Gesperrt: Zwei Tausche desselben Tokens laufen nacheinander. */
export function tauschQuelleSperren(tx: DbSchnittstelle, hash: string) {
  return tx.get<TauschQuelle>(
    `SELECT user_id, label, scope, sliding, never_expires, expires_at, hard_expires_at, created_at, ersetzt_durch
       FROM api_tokens
      WHERE token = $1
        AND (expires_at      IS NULL OR expires_at      > NOW())
        AND (hard_expires_at IS NULL OR hard_expires_at > NOW())
      FOR UPDATE`, [hash]);
}

export async function loescheUnbenutztenNachfolger(tx: DbSchnittstelle, nachfolger: string, alt: string): Promise<void> {
  await tx.run('DELETE FROM api_tokens WHERE token = $1 AND vorgaenger = $2', [nachfolger, alt]);
}

/** Der Nachfolger erbt Label, Scope und Fristen; die Gleitfrist beginnt neu. */
export function legeNachfolgerAn(tx: DbSchnittstelle, neu: string, alt: string, z: TauschQuelle,
                                 leerlaufTage: number, bereich: string | null) {
  return tx.get<{ expires_at: Date | null; hard_expires_at: Date | null; rotiert_am: Date }>(
    `INSERT INTO api_tokens (token, user_id, label, created_at, last_used, expires_at, sliding,
                             hard_expires_at, never_expires, scope, ip_bereich, rotiert_am, vorgaenger)
     VALUES ($1, $2, $3, $4, NOW(),
             CASE WHEN $5 AND $6::timestamptz IS NOT NULL THEN NOW() + make_interval(days => $7) ELSE $6::timestamptz END,
             $5, $8, $9, $10, $11, NOW(), $12)
     RETURNING expires_at, hard_expires_at, rotiert_am`,
    [neu, z.user_id, z.label, z.created_at, z.sliding, z.expires_at, leerlaufTage,
     z.hard_expires_at, z.never_expires, z.scope, bereich, alt]);
}

export function befristeVorgaenger(tx: DbSchnittstelle, alt: string, neu: string, sekunden: number) {
  return tx.get<{ expires_at: Date }>(
    `UPDATE api_tokens
        SET ersetzt_durch = $2, sliding = FALSE, never_expires = FALSE,
            expires_at = LEAST(COALESCE(expires_at, 'infinity'::timestamptz), NOW() + make_interval(secs => $3))
      WHERE token = $1 RETURNING expires_at`, [alt, neu, sekunden]);
}

export async function loescheToken(hash: string): Promise<void> {
  await db.run('DELETE FROM api_tokens WHERE token = $1', [hash]);
}

export async function loescheTokensDesKontos(userId: number, ausser: string | null = null): Promise<void> {
  if (ausser) await db.run('DELETE FROM api_tokens WHERE user_id = $1 AND token <> $2', [userId, ausser]);
  else await db.run('DELETE FROM api_tokens WHERE user_id = $1', [userId]);
}

/** @returns die neue Sitzungsversion; wer `ausser` behält, schreibt sie in seine Sitzung. */
export async function loescheSitzungenDesKontos(userId: number, ausser: string | null = null): Promise<number> {
  const version = await erhoeheSitzungsVersion(userId);
  if (ausser === null) await db.run("DELETE FROM user_sessions WHERE sess::jsonb->>'userId' = $1", [String(userId)]);
  else await db.run("DELETE FROM user_sessions WHERE sess::jsonb->>'userId' = $1 AND sid IS DISTINCT FROM $2",
    [String(userId), ausser]);
  return version;
}

export async function ziehAltzeilenNach(leerlaufTage: number): Promise<number> {
  return (await db.run(
    `UPDATE api_tokens
        SET sliding = TRUE,
            expires_at = COALESCE(last_used, created_at) + make_interval(days => $1)
      WHERE expires_at IS NULL AND NOT never_expires`, [leerlaufTage])).changes || 0;
}

/** Beide Fristen in einer Anweisung — eine zweite wäre die Stelle, an der eine Regel fehlt. */
export async function loescheAbgelaufene(): Promise<number> {
  return (await db.run(
    `DELETE FROM api_tokens
      WHERE (expires_at      IS NOT NULL AND expires_at      < NOW())
         OR (hard_expires_at IS NOT NULL AND hard_expires_at < NOW())`)).changes || 0;
}

/** NOT never_expires: Eine Zeile ohne Datum ist Altbestand oder die ausdrückliche Wahl „unbegrenzt". */
export async function loescheUngenutzte(leerlaufTage: number): Promise<number> {
  return (await db.run(
    `DELETE FROM api_tokens
      WHERE expires_at IS NULL AND NOT never_expires
        AND COALESCE(last_used, created_at) < NOW() - make_interval(days => $1)`, [leerlaufTage])).changes || 0;
}

export function kontoZuEmailToken(hash: string) {
  return db.get<{ id: number }>(
    'SELECT id FROM users WHERE verification_token = $1 AND token_expires > NOW() AND NOT email_verified', [hash]);
}

/** Token-Felder mit abräumen: Ein zweiter Klick meldet keinen zweiten Erfolg. */
export async function bestaetigeEmail(id: number): Promise<void> {
  await db.run('UPDATE users SET email_verified=true, verification_token=NULL, token_expires=NULL WHERE id=$1', [id]);
}

/** Zwei Treffer (ein Name gleich der Adresse eines anderen Kontos, nur im
 * Altbestand möglich) heissen „kein Konto": Welches gemeint war, ist nicht zu entscheiden. */
export async function kontoZurAnmeldung(name: string) {
  const treffer = await db.all('SELECT * FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1) LIMIT 2', [name]);
  if (treffer.length > 1) console.warn('[anmeldung] Name passt auf zwei Konten (Benutzername und Adresse) — Anmeldung abgewiesen');
  return treffer.length === 1 ? treffer[0] : undefined;
}

export function passwortHash(id: number) {
  return db.get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [id]);
}
