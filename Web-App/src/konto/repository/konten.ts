import * as db from '../../../db/database';

/**
 * Datenzugriff für Konten, Profil, Registrierung, Rücksetzen und QR-Anmeldung.
 * Die Routen in routes/auth.ts prüfen Eingaben und Rechte und schreiben die
 * Antwort; was in der Datenbank geschieht, steht hier an einer Stelle.
 */
export type KontoKurz = { id: number; username: string; is_admin: number };

export function kontoKurz(id: number): Promise<KontoKurz | undefined> {
  return db.get('SELECT id, username, is_admin FROM users WHERE id = $1', [id]);
}

export function kontoVoll(id: number): Promise<any> {
  return db.get('SELECT * FROM users WHERE id=$1', [id]);
}

export function profil(id: number): Promise<any> {
  return db.get('SELECT id, username, email, first_name, last_name, email_verified FROM users WHERE id=$1', [id]);
}

/** Der Login sucht Name ODER E-Mail ohne Gross/klein — beides muss deshalb über beide Spalten eindeutig sein. */
export async function nameVergeben(name: string, ausser: number): Promise<boolean> {
  return !!await db.get(
    'SELECT id FROM users WHERE (LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1)) AND id != $2', [name, ausser]);
}

export async function emailVergeben(email: string, ausser: number): Promise<boolean> {
  return !!await db.get(
    'SELECT id FROM users WHERE (LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($1)) AND id != $2', [email, ausser]);
}

/** Spalten, die die Profiländerung setzen darf — die Namen gehen in die Anweisung, nicht als Parameter. */
const PROFILSPALTEN = new Set(['username', 'first_name', 'last_name', 'email', 'email_verified',
  'verification_token', 'token_expires']);

export async function aendereProfil(id: number, felder: Record<string, unknown>): Promise<void> {
  const spalten = Object.keys(felder);
  if (!spalten.length) return;
  for (const s of spalten) if (!PROFILSPALTEN.has(s)) throw new Error(`Profilspalte nicht erlaubt: ${s}`);
  await db.run(`UPDATE users SET ${spalten.map((s, i) => `${s}=$${i + 1}`).join(',')} WHERE id=$${spalten.length + 1}`,
    [...spalten.map(s => felder[s]), id]);
}

export function kontenListe(): Promise<any[]> {
  return db.all(
    `SELECT u.id, u.username, u.is_admin, u.created_at,
            EXISTS (SELECT 1 FROM zweiter_faktor z WHERE z.user_id = u.id AND z.aktiv) AS zweiter_faktor
       FROM users u ORDER BY u.id`);
}

/** @returns die neue Kennung, oder null, wenn der Name schon vergeben ist */
export async function legeKontoAn(username: string, hash: string, verwalter: boolean): Promise<number | null> {
  const neu = await db.get('INSERT INTO users (username, password_hash, is_admin) VALUES ($1, $2, $3) RETURNING id',
    [username, hash, verwalter ? 1 : 0]);
  return neu ? neu.id : null;
}

export function verwalterVorher(id: number): Promise<{ is_admin: number } | undefined> {
  return db.get('SELECT is_admin FROM users WHERE id = $1', [id]);
}

export async function setzeVerwalter(id: number, ja: boolean): Promise<void> {
  await db.run('UPDATE users SET is_admin = $1 WHERE id = $2', [ja ? 1 : 0, id]);
}

/** @returns ob es das Konto gab */
export async function setzePasswortHash(id: number, hash: string): Promise<boolean> {
  return !!(await db.run('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, id])).changes;
}

/** Eigenes Passwort geändert: auch die Aufforderung dazu ist erledigt. */
export async function setzeEigenesPasswort(id: number, hash: string): Promise<void> {
  await db.run('UPDATE users SET password_hash = $1, must_change_password = 0 WHERE id = $2', [hash, id]);
}

export async function kontoExistiert(id: number): Promise<boolean> {
  return !!await db.get('SELECT 1 FROM users WHERE id = $1', [id]);
}

/** Nie das eigene Konto. @returns ob eine Zeile gelöscht wurde */
export async function loescheKonto(id: number, eigenes: number | null): Promise<boolean> {
  return (await db.run('DELETE FROM users WHERE id = $1 AND id != $2', [id, eigenes])).changes > 0;
}

export async function raeumeQrTokensAuf(): Promise<void> {
  await db.run(`DELETE FROM qr_login_tokens WHERE expires_at < NOW() - INTERVAL '1 hour'`);
}

export async function legeQrTokenAn(hash: string, uid: number | null, bis: Date, tage: number | null): Promise<void> {
  await db.run('INSERT INTO qr_login_tokens (token, user_id, expires_at, token_days) VALUES ($1,$2,$3,$4)',
    [hash, uid, bis, tage]);
}

/** Atomar entwerten: Nur die erste Anfrage bekommt die Zeile, jede weitere läuft ins Leere. */
export function loeseQrTokenEin(hash: string): Promise<{ user_id: number; token_days: number | null } | undefined> {
  return db.get(
    `UPDATE qr_login_tokens SET used_at = NOW()
     WHERE token = $1 AND used_at IS NULL AND expires_at > NOW()
     RETURNING user_id, token_days`, [hash]);
}

export async function nameOderEmailVergeben(username: string, email: string): Promise<boolean> {
  return !!await db.get('SELECT id FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($2)', [username, email]);
}

/**
 * Selbst registriertes Konto anlegen. Ohne RETURNING: Die Kompatschicht
 * hängt an ein INSERT ohne ON CONFLICT selbst `ON CONFLICT DO NOTHING` an,
 * dahinter wäre RETURNING ein Syntaxfehler — daher die Kennung per SELECT.
 */
export async function registriereKonto(k: { username: string; email: string; first_name?: string | null;
  last_name?: string | null; hash: string; tokenHash: string; bis: Date }): Promise<number | null> {
  await db.run(
    'INSERT INTO users (username, email, first_name, last_name, password_hash, is_admin, is_active, email_verified, verification_token, token_expires) VALUES ($1,$2,$3,$4,$5,0,1,0,$6,$7)',
    [k.username, k.email, k.first_name || null, k.last_name || null, k.hash, k.tokenHash, k.bis]);
  const neu = await db.get('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [k.username]);
  return neu?.id ?? null;
}

export function aktivesKontoNachEmail(email: string): Promise<any> {
  return db.get('SELECT * FROM users WHERE LOWER(email) = LOWER($1) AND is_active = 1', [email]);
}

export async function setzeRuecksetzToken(id: number, hash: string, bis: Date): Promise<void> {
  await db.run('UPDATE users SET reset_token=$1, reset_token_expires=$2 WHERE id=$3', [hash, bis, id]);
}

export function kontoNachRuecksetzToken(hash: string): Promise<{ id: number } | undefined> {
  return db.get('SELECT id FROM users WHERE reset_token = $1 AND reset_token_expires > NOW()', [hash]);
}

export async function setzePasswortNachRuecksetzen(id: number, hash: string): Promise<void> {
  await db.run('UPDATE users SET password_hash=$1, reset_token=NULL, reset_token_expires=NULL WHERE id=$2', [hash, id]);
}

/** Ein gültiges App-Token nach den ersten 16 Zeichen — für den Serverbeweis der App. */
export function tokenNachKennung(kennung: string): Promise<{ token: string } | undefined> {
  return db.get(
    `SELECT token FROM api_tokens
      WHERE left(token, 16) = $1
        AND (expires_at IS NULL OR expires_at > NOW())
        AND (hard_expires_at IS NULL OR hard_expires_at > NOW())
      LIMIT 1`, [kennung]);
}

export interface Zugang {
  token: string; label: string | null; created_at: Date; last_used: Date | null;
  hard_expires_at: Date | null; expires_at: Date | null; scope: 'app' | 'voll';
  ip_bereich: string | null; never_expires: boolean; rotiert_am: Date;
}

/**
 * Die gültigen Zugänge (Tokens) eines Kontos. expires_at ist die frühere der
 * beiden Fristen — gleitend und fest —, also der Tag, an dem das Gerät
 * ausgesperrt wird. Ein getauschter Token in seiner Überlappung zählt nicht
 * mehr als eigenes Gerät.
 */
export function zugaengeDesKontos(uid: number): Promise<Zugang[]> {
  return db.all<Zugang>(
    `SELECT token, label, created_at, last_used, hard_expires_at, LEAST(expires_at, hard_expires_at) AS expires_at,
            scope, ip_bereich, never_expires, rotiert_am
       FROM api_tokens
      WHERE user_id = $1 AND ersetzt_durch IS NULL
        AND (expires_at IS NULL OR expires_at > NOW())
        AND (hard_expires_at IS NULL OR hard_expires_at > NOW())
      ORDER BY created_at DESC`, [uid]);
}

/** Scope und Fristen eines Tokens nach seinem Hash — für die Antworten an die App. */
export function tokenStand(hash: string): Promise<{ scope: 'app' | 'voll'; expires_at: Date | null;
    hard_expires_at: Date | null; never_expires: boolean; rotiert_am: Date } | undefined> {
  return db.get(
    `SELECT scope, LEAST(expires_at, hard_expires_at) AS expires_at, hard_expires_at, never_expires, rotiert_am
       FROM api_tokens WHERE token = $1`, [hash]);
}

/** Zugänge entwerten, deren Kennung mit `praefix` beginnt (LIKE-sicher übergeben). */
export async function zugaengeLoeschen(uid: number, praefix: string): Promise<number> {
  return (await db.run("DELETE FROM api_tokens WHERE user_id = $1 AND token LIKE $2 ESCAPE '\\'", [uid, praefix + '%'])).changes;
}

/** Alle Browser-Sitzungen des Kontos ausser der eigenen beenden. */
export async function andereSitzungenBeenden(uid: number, eigeneSid: string): Promise<number> {
  return (await db.run("DELETE FROM user_sessions WHERE sess::jsonb->>'userId' = $1 AND sid <> $2", [String(uid), eigeneSid])).changes;
}

/** Muss das Konto sein Passwort beim nächsten Mal ändern? (Erststart mit Vorgabepasswort.) */
export async function mussPasswortAendern(uid: number): Promise<boolean> {
  const r = await db.get<{ must_change_password: number | boolean | null }>('SELECT must_change_password FROM users WHERE id = $1', [uid]);
  return r?.must_change_password === 1 || r?.must_change_password === true;
}
