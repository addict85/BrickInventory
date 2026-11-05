import * as db from '../../../db/database';
import { entferneKontoAusSicherungen } from '../../../db/migrate';

export type KontoKurz = { id: number; username: string; is_admin: boolean; must_change_password: boolean };

export interface Konto {
  id: number; username: string; email: string | null; first_name: string | null; last_name: string | null;
  password_hash: string; is_admin: boolean; is_active: boolean; email_verified: boolean;
  must_change_password: boolean; created_at: Date; [spalte: string]: unknown;
}
export type Profil = Pick<Konto, 'id' | 'username' | 'email' | 'first_name' | 'last_name' | 'email_verified'> & { email_neu: string | null };
export type KontoInListe = Pick<Konto, 'id' | 'username' | 'is_admin' | 'is_active' | 'created_at'> & { zweiter_faktor: boolean; wartet_auf_bestaetigung: boolean };

export function kontoKurz(id: number): Promise<KontoKurz | undefined> {
  return db.get('SELECT id, username, is_admin, must_change_password FROM users WHERE id = $1', [id]);
}

export function kontoVoll(id: number): Promise<Konto | undefined> {
  return db.get<Konto>('SELECT * FROM users WHERE id=$1', [id]);
}

export function profilZeile(id: number): Promise<Profil | undefined> {
  return db.get<Profil>('SELECT id, username, email, first_name, last_name, email_verified, email_neu FROM users WHERE id=$1', [id]);
}

/** Der Login sucht Name ODER E-Mail ohne Gross/klein — beides muss deshalb über beide Spalten eindeutig sein. */
export async function nameVergeben(name: string, ausser: number): Promise<boolean> {
  return !!await db.get(
    'SELECT id FROM users WHERE (LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1)) AND id != $2', [name, ausser]);
}

/** Nur users.email zählt: Eine Registrierung oder Profiländerung legt ihre Adresse
 * erst nach email_neu, vergeben wird sie mit der ersten Bestätigung. */
export async function emailVergeben(email: string, ausser: number): Promise<boolean> {
  return nameVergeben(email, ausser);
}

/** Die Namen gehen in die Anweisung, nicht als Parameter — deshalb eine feste Liste. */
const PROFILSPALTEN = new Set(['username', 'first_name', 'last_name']);

export async function aendereProfil(id: number, felder: Record<string, unknown>): Promise<void> {
  const spalten = Object.keys(felder);
  if (!spalten.length) return;
  for (const s of spalten) if (!PROFILSPALTEN.has(s)) throw new Error(`Profilspalte nicht erlaubt: ${s}`);
  await db.run(`UPDATE users SET ${spalten.map((s, i) => `${s}=$${i + 1}`).join(',')} WHERE id=$${spalten.length + 1}`,
    [...spalten.map(s => felder[s]), id]);
}

export async function merkeEmailNeu(id: number, email: string, tokenHash: string, bis: Date): Promise<void> {
  await db.run('UPDATE users SET email_neu = $2, email_neu_token = $3, email_neu_bis = $4 WHERE id = $1',
    [id, email, tokenHash, bis]);
}

const OHNE_EMAIL_NEU = 'email_neu = NULL, email_neu_token = NULL, email_neu_bis = NULL';

/** Erst hier wird die Adresse vergeben: Was beim Antrag frei war, kann inzwischen belegt sein.
 * Auch ein Fehlschlag verbraucht den Link. @returns undefined bei ungültigem Link */
export async function uebernimmEmailNeu(hash: string): Promise<{ id: number; ok: boolean } | undefined> {
  const k = await db.get<{ id: number }>('SELECT id FROM users WHERE email_neu_token = $1 AND email_neu_bis > NOW()', [hash]);
  if (!k) return undefined;
  const ok = await db.transaction(async (tx) => {
    const neu = await tx.get<{ email_neu: string }>(
      'SELECT email_neu FROM users WHERE id = $1 AND email_neu_token = $2 FOR UPDATE', [k.id, hash]);
    if (!neu) return false;
    if (await tx.get('SELECT 1 FROM users WHERE id <> $2 AND (LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1))',
      [neu.email_neu, k.id])) return false;
    await tx.run(`UPDATE users SET email = email_neu, email_verified = true, registrierung_offen = false,
                   ${OHNE_EMAIL_NEU}, ${OHNE_RUECKSETZLINK} WHERE id = $1`, [k.id]);
    return true;
  }).catch((e: { code?: string }) => { if (e?.code === '23505') return false; throw e; });
  if (!ok) await db.run(`UPDATE users SET ${OHNE_EMAIL_NEU} WHERE id = $1 AND email_neu_token = $2`, [k.id, hash]);
  return { id: k.id, ok };
}

/** Nur der Name: Wer den Link hat, sieht vor dem Einlösen, zu welchem Konto er gehört. */
export async function nameZuEmailToken(hash: string): Promise<string | null> {
  return (await db.get<{ username: string }>(
    'SELECT username FROM users WHERE email_neu_token = $1 AND email_neu_bis > NOW()', [hash]))?.username ?? null;
}

export async function offeneRegistrierungen(email: string): Promise<number> {
  return Number((await db.get<{ n: string }>(
    'SELECT COUNT(*) AS n FROM users WHERE registrierung_offen AND LOWER(email_neu) = LOWER($1) AND email_neu_bis > NOW()',
    [email]))?.n ?? 0);
}

/** Wie uebernimmEmailNeu, aber ohne Link: Die Adresse kann inzwischen ein anderes Konto haben. */
export async function schalteRegistrierungFrei(id: number): Promise<'ok' | 'nicht_wartend' | 'vergeben'> {
  return db.transaction(async (tx) => {
    const k = await tx.get<{ email_neu: string | null }>(
      'SELECT email_neu FROM users WHERE id = $1 AND registrierung_offen AND NOT email_verified FOR UPDATE', [id]);
    if (!k) return 'nicht_wartend' as const;
    if (k.email_neu && await tx.get('SELECT 1 FROM users WHERE id <> $2 AND (LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1))',
      [k.email_neu, id])) return 'vergeben' as const;
    await tx.run(`UPDATE users SET email = COALESCE(email_neu, email), email_verified = true, registrierung_offen = false,
                   ${OHNE_EMAIL_NEU} WHERE id = $1`, [id]);
    return 'ok' as const;
  }).catch((e: { code?: string }) => { if (e?.code === '23505') return 'vergeben' as const; throw e; });
}

/** Altbestand aus Migration 0096: ausstehend ohne gültigen Link. */
export async function ausstehendOhneLink(): Promise<number[]> {
  return (await db.all<{ id: number }>(
    'SELECT id FROM users WHERE email_neu IS NOT NULL AND email_neu_bis IS NULL AND NOT registrierung_offen ORDER BY id'))
    .map(z => z.id);
}

export function alleKonten(): Promise<KontoInListe[]> {
  return db.all<KontoInListe>(
    `SELECT u.id, u.username, u.is_admin, u.is_active, u.created_at,
            EXISTS (SELECT 1 FROM zweiter_faktor z WHERE z.user_id = u.id AND z.aktiv) AS zweiter_faktor,
            (u.registrierung_offen AND NOT u.email_verified) AS wartet_auf_bestaetigung
       FROM users u ORDER BY u.id`);
}

export function alleAdressen(): Promise<{ id: number; email: string }[]> {
  return db.all<{ id: number; email: string }>(`SELECT id, email FROM users WHERE COALESCE(email, '') <> '' ORDER BY id`);
}

export async function aktiveVerwalter(): Promise<number[]> {
  return (await db.all<{ id: number }>('SELECT id FROM users WHERE is_admin AND is_active AND email IS NOT NULL ORDER BY id'))
    .map(z => z.id);
}

/** Das Passwort hat der Verwalter vergeben und weitergegeben; es gilt nur bis zur
 * ersten Anmeldung, danach kennt es allein der Inhaber. */
export async function fuegeKontoEin(username: string, hash: string, verwalter: boolean): Promise<number | null> {
  const neu = await db.get<{ id: number }>(
    'INSERT INTO users (username, password_hash, is_admin, must_change_password) VALUES ($1, $2, $3, true) RETURNING id',
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

/** Ein noch offener Rücksetzlink fällt mit jedem neuen Passwort: Er stammt aus
 * der Zeit davor und ginge sonst eine Stunde lang weiter. */
const OHNE_RUECKSETZLINK = 'reset_token = NULL, reset_token_expires = NULL';

/** Ein fremd gesetztes Passwort kennt auch der Verwalter: Der Inhaber muss es
 * beim nächsten Anmelden ersetzen, sonst bliebe es ein zweiter Schlüssel. */
export async function setzePasswortHash(id: number, hash: string): Promise<boolean> {
  return !!(await db.run(`UPDATE users SET password_hash = $1, must_change_password = true, ${OHNE_RUECKSETZLINK} WHERE id = $2`,
    [hash, id])).changes;
}

/** Eigenes Passwort geändert: auch die Aufforderung dazu ist erledigt. */
export async function setzeEigenesPasswort(id: number, hash: string): Promise<void> {
  await db.run(`UPDATE users SET password_hash = $1, must_change_password = false, ${OHNE_RUECKSETZLINK} WHERE id = $2`, [hash, id]);
}

export async function kontoExistiert(id: number): Promise<boolean> {
  return !!await db.get('SELECT 1 FROM users WHERE id = $1', [id]);
}

/** Gelöscht heisst auch in den Kopien vor Migrationen gelöscht. Den Namen im
 * Verwaltungsprotokoll nimmt erst der Aufräumlauf (raeumeProtokollAuf). */
async function spurenLoeschen(tx: db.DbSchnittstelle, id: number): Promise<void> {
  await entferneKontoAusSicherungen(tx, id);
}

/** Nie das eigene Konto. */
export async function loescheKonto(id: number, eigenes: number | null): Promise<boolean> {
  return db.transaction(async (tx) => {
    if (!(await tx.run('DELETE FROM users WHERE id = $1 AND id != $2', [id, eigenes])).changes) return false;
    await spurenLoeschen(tx, id);
    return true;
  });
}

/** Das eigene Konto; der letzte aktive Verwalter bleibt. */
export async function loescheEigenesKonto(id: number): Promise<boolean> {
  return db.transaction(async (tx) => {
    if (!(await tx.run(`DELETE FROM users WHERE id = $1 AND (NOT is_admin
      OR EXISTS (SELECT 1 FROM users v WHERE v.is_admin AND v.is_active AND v.id <> $1))`, [id])).changes) return false;
    await spurenLoeschen(tx, id);
    return true;
  });
}

/** Registrierungen, deren Adresse nach `tage` Tagen nicht bestätigt ist. */
export async function loescheOffeneRegistrierungen(tage: number): Promise<number> {
  return db.transaction(async (tx) => {
    const weg = await tx.all<{ id: number }>(`DELETE FROM users WHERE registrierung_offen AND NOT email_verified AND NOT is_admin
      AND created_at < NOW() - make_interval(days => $1::int) RETURNING id`, [tage]);
    for (const { id } of weg) await spurenLoeschen(tx, id);
    return weg.length;
  });
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

export function kontoMitEmail(email: string): Promise<Omit<KontoKurz, 'must_change_password'> & { email: string } | undefined> {
  return db.get('SELECT id, username, is_admin, email FROM users WHERE LOWER(email) = LOWER($1)', [email]);
}

/** Ohne RETURNING: Die Kompatschicht hängt an ein INSERT ohne ON CONFLICT
 * selbst `ON CONFLICT DO NOTHING` an, dahinter wäre RETURNING ein Syntaxfehler. */
export async function registriereKonto(k: { username: string; email: string; first_name?: string | null | undefined;
  last_name?: string | null | undefined; hash: string; tokenHash: string; bis: Date }): Promise<number | null> {
  await db.run(
    `INSERT INTO users (username, email_neu, email_neu_token, email_neu_bis, first_name, last_name, password_hash,
                        is_admin, is_active, email_verified, registrierung_offen) VALUES ($1,$2,$3,$4,$5,$6,$7,false,true,false,true)`,
    [k.username, k.email, k.tokenHash, k.bis, k.first_name || null, k.last_name || null, k.hash]);
  const neu = await db.get<{ id: number }>('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [k.username]);
  return neu?.id ?? null;
}

export function aktivesKontoNachEmail(email: string): Promise<Konto | undefined> {
  return db.get<Konto>('SELECT * FROM users WHERE LOWER(email) = LOWER($1) AND is_active AND email_verified', [email]);
}

/** Der Zeitpunkt des letzten Links ergibt sich aus seinem Ablauf; die Bedingung
 * im UPDATE lässt auch bei gleichzeitigen Anfragen nur eine durch.
 * @returns false, wenn der letzte Link jünger als `pauseMin` ist */
export async function setzeRuecksetzTokenWennFrei(id: number, hash: string, gueltigMin: number, pauseMin: number): Promise<boolean> {
  return !!(await db.run(
    `UPDATE users SET reset_token = $1, reset_token_expires = NOW() + make_interval(mins => $2::int)
      WHERE id = $3 AND (reset_token_expires IS NULL
                         OR reset_token_expires < NOW() + make_interval(mins => $2::int - $4::int))`,
    [hash, gueltigMin, id, pauseMin])).changes;
}

/** Wie setzeRuecksetzTokenWennFrei. Nur wenn genau eine offene Registrierung die Adresse
 * nennt: Bei mehreren ginge ein Link zu einem fremd angelegten Konto an ihren Inhaber. */
export function erneuereEmailTokenWennFrei(email: string, hash: string, gueltigStd: number, pauseMin: number) {
  return db.get<{ id: number; email: string }>(
    `UPDATE users u SET email_neu_token = $2, email_neu_bis = NOW() + make_interval(hours => $3::int)
       FROM (SELECT MIN(id) AS id FROM users WHERE registrierung_offen AND LOWER(email_neu) = LOWER($1)
             HAVING COUNT(*) = 1) e
      WHERE u.id = e.id AND u.is_active
        AND (u.email_neu_bis IS NULL OR u.email_neu_bis < NOW() + make_interval(hours => $3::int, mins => -$4::int))
      RETURNING u.id, u.email_neu AS email`, [email, hash, gueltigStd, pauseMin]);
}

export function kontoNachRuecksetzToken(hash: string): Promise<{ id: number; username: string } | undefined> {
  return db.get('SELECT id, username FROM users WHERE reset_token = $1 AND reset_token_expires > NOW()', [hash]);
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

export async function loescheAndereSitzungen(uid: number, eigeneSid: string): Promise<number> {
  return (await db.run("DELETE FROM user_sessions WHERE sess::jsonb->>'userId' = $1 AND sid <> $2", [String(uid), eigeneSid])).changes;
}

export async function mussPasswortAendern(uid: number): Promise<boolean> {
  const r = await db.get<{ must_change_password: boolean }>('SELECT must_change_password FROM users WHERE id = $1', [uid]);
  return r?.must_change_password === true;
}
