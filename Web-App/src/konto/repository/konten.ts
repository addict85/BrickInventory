import * as db from '../../../db/database';

export type KontoKurz = { id: number; username: string; is_admin: boolean };

export interface Konto {
  id: number; username: string; email: string | null; first_name: string | null; last_name: string | null;
  password_hash: string; is_admin: boolean; is_active: boolean; email_verified: boolean;
  must_change_password: boolean; created_at: Date; [spalte: string]: unknown;
}
export type Profil = Pick<Konto, 'id' | 'username' | 'email' | 'first_name' | 'last_name' | 'email_verified'>;
export type KontoInListe = Pick<Konto, 'id' | 'username' | 'is_admin' | 'is_active' | 'created_at'> & { zweiter_faktor: boolean };

export function kontoKurz(id: number): Promise<KontoKurz | undefined> {
  return db.get('SELECT id, username, is_admin FROM users WHERE id = $1', [id]);
}

export function kontoVoll(id: number): Promise<Konto | undefined> {
  return db.get<Konto>('SELECT * FROM users WHERE id=$1', [id]);
}

export function profilZeile(id: number): Promise<Profil | undefined> {
  return db.get<Profil>('SELECT id, username, email, first_name, last_name, email_verified FROM users WHERE id=$1', [id]);
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

/** Die Namen gehen in die Anweisung, nicht als Parameter — deshalb eine feste Liste. */
const PROFILSPALTEN = new Set(['username', 'first_name', 'last_name', 'email', 'email_verified',
  'verification_token', 'token_expires']);

export async function aendereProfil(id: number, felder: Record<string, unknown>): Promise<void> {
  const spalten = Object.keys(felder);
  if (!spalten.length) return;
  for (const s of spalten) if (!PROFILSPALTEN.has(s)) throw new Error(`Profilspalte nicht erlaubt: ${s}`);
  await db.run(`UPDATE users SET ${spalten.map((s, i) => `${s}=$${i + 1}`).join(',')} WHERE id=$${spalten.length + 1}`,
    [...spalten.map(s => felder[s]), id]);
}

export function alleKonten(): Promise<KontoInListe[]> {
  return db.all<KontoInListe>(
    `SELECT u.id, u.username, u.is_admin, u.is_active, u.created_at,
            EXISTS (SELECT 1 FROM zweiter_faktor z WHERE z.user_id = u.id AND z.aktiv) AS zweiter_faktor
       FROM users u ORDER BY u.id`);
}

export async function fuegeKontoEin(username: string, hash: string, verwalter: boolean): Promise<number | null> {
  const neu = await db.get('INSERT INTO users (username, password_hash, is_admin) VALUES ($1, $2, $3) RETURNING id',
    [username, hash, verwalter]);
  return neu ? neu.id : null;
}

export function verwalterVorher(id: number): Promise<{ is_admin: boolean } | undefined> {
  return db.get('SELECT is_admin FROM users WHERE id = $1', [id]);
}

export async function setzeVerwalter(id: number, ja: boolean): Promise<void> {
  await db.run('UPDATE users SET is_admin = $1 WHERE id = $2', [ja, id]);
}

/** @returns der Zustand vor der Änderung, oder undefined ohne Konto */
export async function schreibeAktiv(id: number, ja: boolean): Promise<{ vorher: boolean } | undefined> {
  return db.get(`UPDATE users u SET is_active = $2 FROM users alt
                  WHERE u.id = $1 AND alt.id = u.id RETURNING alt.is_active AS vorher`, [id, ja]);
}

export async function setzePasswortHash(id: number, hash: string): Promise<boolean> {
  return !!(await db.run('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, id])).changes;
}

/** Eigenes Passwort geändert: auch die Aufforderung dazu ist erledigt. */
export async function setzeEigenesPasswort(id: number, hash: string): Promise<void> {
  await db.run('UPDATE users SET password_hash = $1, must_change_password = false WHERE id = $2', [hash, id]);
}

export async function kontoExistiert(id: number): Promise<boolean> {
  return !!await db.get('SELECT 1 FROM users WHERE id = $1', [id]);
}

/** Nie das eigene Konto. */
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

/** Atomar entwerten: Nur die erste Anfrage bekommt die Zeile. */
export function loeseQrTokenEin(hash: string): Promise<{ user_id: number; token_days: number | null } | undefined> {
  return db.get(
    `UPDATE qr_login_tokens SET used_at = NOW()
     WHERE token = $1 AND used_at IS NULL AND expires_at > NOW()
     RETURNING user_id, token_days`, [hash]);
}

export function kontoMitEmail(email: string): Promise<KontoKurz & { email: string } | undefined> {
  return db.get('SELECT id, username, is_admin, email FROM users WHERE LOWER(email) = LOWER($1)', [email]);
}

/** Ohne RETURNING: Die Kompatschicht hängt an ein INSERT ohne ON CONFLICT
 * selbst `ON CONFLICT DO NOTHING` an, dahinter wäre RETURNING ein Syntaxfehler. */
export async function registriereKonto(k: { username: string; email: string; first_name?: string | null | undefined;
  last_name?: string | null | undefined; hash: string; tokenHash: string; bis: Date }): Promise<number | null> {
  await db.run(
    'INSERT INTO users (username, email, first_name, last_name, password_hash, is_admin, is_active, email_verified, verification_token, token_expires) VALUES ($1,$2,$3,$4,$5,false,true,false,$6,$7)',
    [k.username, k.email, k.first_name || null, k.last_name || null, k.hash, k.tokenHash, k.bis]);
  const neu = await db.get('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [k.username]);
  return neu?.id ?? null;
}

export function aktivesKontoNachEmail(email: string): Promise<Konto | undefined> {
  return db.get<Konto>('SELECT * FROM users WHERE LOWER(email) = LOWER($1) AND is_active', [email]);
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

export interface Zugang {
  token: string; label: string | null; created_at: Date; last_used: Date | null;
  hard_expires_at: Date | null; expires_at: Date | null; scope: 'app' | 'voll';
  ip_bereich: string | null; never_expires: boolean; rotiert_am: Date;
}

/** Ein getauschter Token in seiner Überlappung zählt nicht mehr als eigenes Gerät. */
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

export function tokenStand(hash: string): Promise<{ scope: 'app' | 'voll'; expires_at: Date | null;
    hard_expires_at: Date | null; never_expires: boolean; rotiert_am: Date } | undefined> {
  return db.get(
    `SELECT scope, LEAST(expires_at, hard_expires_at) AS expires_at, hard_expires_at, never_expires, rotiert_am
       FROM api_tokens WHERE token = $1`, [hash]);
}

/** `praefix` kommt LIKE-sicher. */
export async function zugaengeLoeschen(uid: number, praefix: string): Promise<number> {
  return (await db.run("DELETE FROM api_tokens WHERE user_id = $1 AND token LIKE $2 ESCAPE '\\'", [uid, praefix + '%'])).changes;
}

export async function andereSitzungenBeenden(uid: number, eigeneSid: string): Promise<number> {
  return (await db.run("DELETE FROM user_sessions WHERE sess::jsonb->>'userId' = $1 AND sid <> $2", [String(uid), eigeneSid])).changes;
}

export async function mussPasswortAendern(uid: number): Promise<boolean> {
  const r = await db.get<{ must_change_password: boolean }>('SELECT must_change_password FROM users WHERE id = $1', [uid]);
  return r?.must_change_password === true;
}
