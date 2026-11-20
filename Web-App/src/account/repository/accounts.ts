import type { Db, DbInterface, Treffer } from '../../../db/database';
import { removeAccountFromBackups } from '../../../db/migrate';
import { LOCKS } from '../../infra/lockNamespaces';
import type { Spalten } from '../../../db/zeilen';

export type AccountShort = { id: number; username: string; is_admin: boolean; must_change_password: boolean };

export interface Konto {
  id: number;
  username: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  is_admin: boolean;
  is_active: boolean;
  email_verified: boolean;
  must_change_password: boolean;
  created_at: Date;
  [spalte: string]: unknown;
}
export type Profil = Pick<Konto, 'id' | 'username' | 'email' | 'first_name' | 'last_name' | 'email_verified'> & {
  new_email: string | null;
};
export type KontoInListe = Pick<Konto, 'id' | 'username' | 'is_admin' | 'is_active' | 'created_at'> & {
  wartet_auf_bestaetigung: boolean;
};

export function accountShort(db: DbInterface, id: number): Promise<AccountShort | undefined> {
  return db.get<Spalten<'users', 'id' | 'username' | 'is_admin' | 'must_change_password'>>(
    'SELECT id, username, is_admin, must_change_password FROM users WHERE id = $1',
    [id],
  );
}

/** Alles ausser dem Passwort-Hash: Den liest die Laufzeitrolle nicht (Migration 0115). */
const KONTO_SPALTEN = `id, username, email, first_name, last_name, is_admin, is_active, email_verified,
  must_change_password, created_at, session_version, registration_pending, new_email`;

export function accountFull(db: DbInterface, id: number): Promise<Konto | undefined> {
  return db.get<Konto>(`SELECT ${KONTO_SPALTEN} FROM users WHERE id=$1`, [id]);
}

export function profileRow(db: DbInterface, id: number): Promise<Profil | undefined> {
  return db.get<Profil>(
    'SELECT id, username, email, first_name, last_name, email_verified, new_email FROM users WHERE id=$1',
    [id],
  );
}

/** Der Login sucht Name ODER E-Mail ohne Gross/klein — beides muss deshalb über beide Spalten eindeutig sein. */
export async function nameTaken(db: DbInterface, name: string, ausser: number): Promise<boolean> {
  return !!(await db.get<Spalten<'users', 'id'>>(
    'SELECT id FROM users WHERE (LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1)) AND id != $2',
    [name, ausser],
  ));
}

/** Die Namen gehen in die Anweisung, nicht als Parameter — deshalb eine feste Liste. Nur
 * diese Spalten darf die Laufzeitrolle schreiben (Migration 0117). */
const NAMENSSPALTEN = new Set(['first_name', 'last_name']);

export async function changeNames(db: DbInterface, id: number, felder: Record<string, unknown>): Promise<void> {
  const spalten = Object.keys(felder);
  if (!spalten.length) return;
  for (const s of spalten) if (!NAMENSSPALTEN.has(s)) throw new Error(`Namensspalte nicht erlaubt: ${s}`);
  await db.run(
    `UPDATE users SET ${spalten.map((s, i) => `${s}=$${i + 1}`).join(',')} WHERE id=$${spalten.length + 1}`,
    [...spalten.map(s => felder[s]), id],
  );
}

/** Mit dem Namen meldet man sich an: Den schreibt nur die Systemrolle. */
export async function changeUsernames(db: DbInterface, id: number, name: string): Promise<void> {
  await db.run('UPDATE users SET username = $2 WHERE id = $1', [id, name]);
}

/** Ein Eindringling kann ihn angestossen haben. @returns die verworfene Adresse oder null */
export async function discardPendingAddress(db: DbInterface, id: number): Promise<string | null> {
  const r = await db.get<{ adresse: string }>(
    `UPDATE users u SET ${OHNE_EMAIL_NEU} FROM users alt
      WHERE u.id = $1 AND alt.id = u.id AND alt.new_email IS NOT NULL AND NOT alt.registration_pending
      RETURNING alt.new_email AS adresse`,
    [id],
  );
  return r?.adresse ?? null;
}

export async function rememberEmailNew(
  db: DbInterface,
  id: number,
  email: string,
  tokenHash: string,
  bis: Date,
): Promise<void> {
  await db.run('UPDATE users SET new_email = $2, new_email_token = $3, new_email_until = $4 WHERE id = $1', [
    id,
    email,
    tokenHash,
    bis,
  ]);
}

const OHNE_EMAIL_NEU = 'new_email = NULL, new_email_token = NULL, new_email_until = NULL';

export async function accountToEmailToken(db: DbInterface, hash: string): Promise<number | undefined> {
  return (
    await db.get<{ id: number }>('SELECT id FROM users WHERE new_email_token = $1 AND new_email_until > NOW()', [hash])
  )?.id;
}

/** Erst hier wird die Adresse vergeben: Was beim Antrag frei war, kann inzwischen belegt sein.
 * In der Transaktion des Aufrufers (FOR UPDATE). @returns false, wenn die Adresse vergeben ist */
export async function adoptEmailNew(tx: DbInterface, id: number, hash: string): Promise<boolean> {
  const neu = await tx.get<{ new_email: string }>(
    'SELECT new_email FROM users WHERE id = $1 AND new_email_token = $2 FOR UPDATE',
    [id, hash],
  );
  if (!neu) return false;
  if (
    await tx.get<unknown>(
      'SELECT 1 FROM users WHERE id <> $2 AND (LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1))',
      [neu.new_email, id],
    )
  )
    return false;
  await tx.run(
    `UPDATE users SET email = new_email, email_verified = true, registration_pending = false,
               ${OHNE_EMAIL_NEU}, ${OHNE_RUECKSETZLINK} WHERE id = $1`,
    [id],
  );
  return true;
}

/** Auch ein Fehlschlag verbraucht den Link. */
export async function discardEmailNew(db: DbInterface, id: number, hash: string): Promise<void> {
  await db.run(`UPDATE users SET ${OHNE_EMAIL_NEU} WHERE id = $1 AND new_email_token = $2`, [id, hash]);
}

/** Nur der Name: Wer den Link hat, sieht vor dem Einlösen, zu welchem Konto er gehört. */
export async function nameZuEmailToken(db: DbInterface, hash: string): Promise<string | null> {
  return (
    (
      await db.get<{ username: string }>(
        'SELECT username FROM users WHERE new_email_token = $1 AND new_email_until > NOW()',
        [hash],
      )
    )?.username ?? null
  );
}

export async function openRegistrations(db: DbInterface, email: string): Promise<number> {
  return Number(
    (
      await db.get<{ n: string }>(
        'SELECT COUNT(*) AS n FROM users WHERE registration_pending AND LOWER(new_email) = LOWER($1) AND new_email_until > NOW()',
        [email],
      )
    )?.n ?? 0,
  );
}

/** Wie adoptEmailNew, aber ohne Link: Die Adresse kann inzwischen ein anderes Konto haben.
 * In der Transaktion des Aufrufers; ein gleichzeitiger Gewinner meldet sich dort als 23505. */
export async function switchRegistrationFree(
  tx: DbInterface,
  id: number,
): Promise<'ok' | 'nicht_wartend' | 'vergeben'> {
  const k = await tx.get<{ new_email: string | null }>(
    'SELECT new_email FROM users WHERE id = $1 AND registration_pending AND NOT email_verified FOR UPDATE',
    [id],
  );
  if (!k) return 'nicht_wartend';
  if (
    k.new_email &&
    (await tx.get<Treffer>(
      'SELECT 1 FROM users WHERE id <> $2 AND (LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1))',
      [k.new_email, id],
    ))
  )
    return 'vergeben';
  await tx.run(
    `UPDATE users SET email = COALESCE(new_email, email), email_verified = true, registration_pending = false,
               ${OHNE_EMAIL_NEU} WHERE id = $1`,
    [id],
  );
  return 'ok';
}

/** Altbestand aus Migration 0096: ausstehend ohne gültigen Link. */
export async function pendingWithoutLink(db: DbInterface): Promise<number[]> {
  return (
    await db.all<{ id: number }>(
      'SELECT id FROM users WHERE new_email IS NOT NULL AND new_email_until IS NULL AND NOT registration_pending ORDER BY id',
    )
  ).map(z => z.id);
}

export function allAccounts(db: DbInterface): Promise<KontoInListe[]> {
  return db.all<KontoInListe>(
    `SELECT u.id, u.username, u.is_admin, u.is_active, u.created_at,
            (u.registration_pending AND NOT u.email_verified) AS wartet_auf_bestaetigung
       FROM users u ORDER BY u.id`,
  );
}

export function allAddresses(db: DbInterface): Promise<{ id: number; email: string }[]> {
  return db.all<{ id: number; email: string }>(
    `SELECT id, email FROM users WHERE COALESCE(email, '') <> '' ORDER BY id`,
  );
}

export async function activeAdmin(db: DbInterface): Promise<number[]> {
  return (
    await db.all<{ id: number }>('SELECT id FROM users WHERE is_admin AND is_active AND email IS NOT NULL ORDER BY id')
  ).map(z => z.id);
}

/** Ein vergebenes Passwort kennen Verwalter und Weitergabe: nur bis zum ersten Wechsel. */
export async function addAccountOne(
  db: DbInterface,
  username: string,
  hash: string,
  verwalter: boolean,
): Promise<number | null> {
  const neu = await db.get<{ id: number }>(
    'INSERT INTO users (username, password_hash, is_admin, must_change_password) VALUES ($1, $2, $3, true) RETURNING id',
    [username, hash, verwalter],
  );
  return neu ? neu.id : null;
}

export const LAST_ADMIN = 'letzter_verwalter' as const;

/** Ein anderer aktiver Verwalter als der in Parameter `$1`. */
const ANDERER_VERWALTER = 'EXISTS (SELECT 1 FROM users v WHERE v.is_admin AND v.is_active AND v.id <> $1)';

/** Ohne die Sperre sähen zwei gleichzeitige Entzüge je den anderen noch als Verwalter
 * (READ COMMITTED), und es bliebe keiner. Sie gilt bis zum Ende der Transaktion des
 * Aufrufers; ohne eine endete sie mit der Abfrage und schützte nichts. */
async function belowAdminLock<T>(tx: Db, fn: (tx: DbInterface) => Promise<T>): Promise<T> {
  if (!tx.inTransaction()) throw new Error('Die Verwaltersperre gilt nur in einer Transaktion (k.transaktion)');
  await tx.get<unknown>('SELECT pg_advisory_xact_lock($1, 0)', [LOCKS.ADMIN_INVENTORY]);
  return fn(tx);
}

/** @returns der Zustand vor der Änderung, undefined ohne Konto, oder LAST_ADMIN */
export async function setAdmin(
  db: Db,
  id: number,
  ja: boolean,
): Promise<{ vorher: boolean } | typeof LAST_ADMIN | undefined> {
  return belowAdminLock(db, async tx => {
    const r = await tx.get<{ vorher: boolean }>(
      `UPDATE users u SET is_admin = $2 FROM users alt
      WHERE u.id = $1 AND alt.id = u.id AND ($2 OR NOT (alt.is_admin AND alt.is_active) OR ${ANDERER_VERWALTER})
      RETURNING alt.is_admin AS vorher`,
      [id, ja],
    );
    if (r) return r;
    return (await tx.get<unknown>('SELECT 1 FROM users WHERE id = $1', [id])) ? LAST_ADMIN : undefined;
  });
}

/** @returns der Zustand vor der Änderung, undefined ohne Konto, oder LAST_ADMIN */
export async function writeActive(
  db: Db,
  id: number,
  ja: boolean,
): Promise<{ vorher: boolean } | typeof LAST_ADMIN | undefined> {
  return belowAdminLock(db, async tx => {
    const r = await tx.get<{ vorher: boolean }>(
      `UPDATE users u SET is_active = $2 FROM users alt
      WHERE u.id = $1 AND alt.id = u.id AND ($2 OR NOT (alt.is_admin AND alt.is_active) OR ${ANDERER_VERWALTER})
      RETURNING alt.is_active AS vorher`,
      [id, ja],
    );
    if (r) return r;
    return (await tx.get<unknown>('SELECT 1 FROM users WHERE id = $1', [id])) ? LAST_ADMIN : undefined;
  });
}

/** Ein noch offener Rücksetzlink fällt mit jedem neuen Passwort: Er stammt aus
 * der Zeit davor und ginge sonst eine Stunde lang weiter. */
const OHNE_RUECKSETZLINK = 'reset_token = NULL, reset_token_expires = NULL';

/** Ein fremd gesetztes Passwort kennt auch der Verwalter: der Inhaber ersetzt es. */
export async function setPasswordHash(db: DbInterface, id: number, hash: string): Promise<boolean> {
  return !!(
    await db.run(
      `UPDATE users SET password_hash = $1, must_change_password = true, ${OHNE_RUECKSETZLINK} WHERE id = $2`,
      [hash, id],
    )
  ).changes;
}

/** Eigenes Passwort geändert: auch die Aufforderung dazu ist erledigt. */
export async function setOwnPassword(db: DbInterface, id: number, hash: string): Promise<void> {
  await db.run(
    `UPDATE users SET password_hash = $1, must_change_password = false, ${OHNE_RUECKSETZLINK} WHERE id = $2`,
    [hash, id],
  );
}

export async function accountExists(db: DbInterface, id: number): Promise<boolean> {
  return !!(await db.get<Treffer>('SELECT 1 FROM users WHERE id = $1', [id]));
}

/** Auch aus den Kopien vor Migrationen; den Namen im Protokoll nimmt cleanLogOn(). */
async function deleteTraces(tx: DbInterface, id: number): Promise<void> {
  await removeAccountFromBackups(tx, id);
}

/** Nie das eigene Konto und nie den letzten aktiven Verwalter.
 * @returns false ohne Konto oder beim eigenen */
export async function deleteAccount(db: Db, id: number, eigenes: number | null): Promise<boolean | typeof LAST_ADMIN> {
  return belowAdminLock(db, async tx => {
    if (
      (
        await tx.run(
          `DELETE FROM users WHERE id = $1 AND id != $2
      AND (NOT (is_admin AND is_active) OR ${ANDERER_VERWALTER})`,
          [id, eigenes],
        )
      ).changes
    ) {
      await deleteTraces(tx, id);
      return true;
    }
    return (await tx.get<unknown>('SELECT 1 FROM users WHERE id = $1 AND id != $2', [id, eigenes]))
      ? LAST_ADMIN
      : false;
  });
}

/** Das eigene Konto; der letzte aktive Verwalter bleibt. */
export async function deleteOwnAccount(db: Db, id: number): Promise<boolean> {
  return belowAdminLock(db, async tx => {
    if (
      !(
        await tx.run(
          `DELETE FROM users WHERE id = $1 AND (NOT is_admin
      OR EXISTS (SELECT 1 FROM users v WHERE v.is_admin AND v.is_active AND v.id <> $1))`,
          [id],
        )
      ).changes
    )
      return false;
    await deleteTraces(tx, id);
    return true;
  });
}

/** Registrierungen, deren Adresse nach `tage` Tagen nicht bestätigt ist; in der
 * Transaktion des Aufrufers, damit keine Spur ohne ihr Konto bleibt. */
export async function deleteOpenRegistrations(tx: DbInterface, tage: number): Promise<number> {
  const weg = await tx.all<{ id: number }>(
    `DELETE FROM users WHERE registration_pending AND NOT email_verified AND NOT is_admin
      AND created_at < NOW() - make_interval(days => $1::int) RETURNING id`,
    [tage],
  );
  for (const { id } of weg) await deleteTraces(tx, id);
  return weg.length;
}

export function accountWithEmail(
  db: DbInterface,
  email: string,
): Promise<(Omit<AccountShort, 'must_change_password'> & { email: string }) | undefined> {
  // Die Bedingung auf email schliesst NULL aus.
  return db.get<Spalten<'users', 'id' | 'username' | 'is_admin'> & { email: string }>(
    'SELECT id, username, is_admin, email FROM users WHERE LOWER(email) = LOWER($1)',
    [email],
  );
}

/** Ohne RETURNING: Die Kompatschicht hängt an ein INSERT ohne ON CONFLICT
 * selbst `ON CONFLICT DO NOTHING` an, dahinter wäre RETURNING ein Syntaxfehler. */
export async function registerAccount(
  db: DbInterface,
  k: {
    username: string;
    email: string;
    first_name?: string | null | undefined;
    last_name?: string | null | undefined;
    hash: string;
    tokenHash: string;
    bis: Date;
  },
): Promise<number | null> {
  await db.run(
    `INSERT INTO users (username, new_email, new_email_token, new_email_until, first_name, last_name, password_hash,
                        is_admin, is_active, email_verified, registration_pending) VALUES ($1,$2,$3,$4,$5,$6,$7,false,true,false,true)`,
    [k.username, k.email, k.tokenHash, k.bis, k.first_name || null, k.last_name || null, k.hash],
  );
  const neu = await db.get<{ id: number }>('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [k.username]);
  return neu?.id ?? null;
}

export function activeAccountAfterEmail(db: DbInterface, email: string): Promise<Konto | undefined> {
  return db.get<Konto>(
    `SELECT ${KONTO_SPALTEN} FROM users WHERE LOWER(email) = LOWER($1) AND is_active AND email_verified`,
    [email],
  );
}

/** Der Zeitpunkt des letzten Links ergibt sich aus seinem Ablauf; die Bedingung
 * im UPDATE lässt auch bei gleichzeitigen Anfragen nur eine durch.
 * @returns false, wenn der letzte Link jünger als `pauseMin` ist */
export async function setRuecksetzTokenIfFree(
  db: DbInterface,
  id: number,
  hash: string,
  validMin: number,
  pauseMin: number,
): Promise<boolean> {
  return !!(
    await db.run(
      `UPDATE users SET reset_token = $1, reset_token_expires = NOW() + make_interval(mins => $2::int)
      WHERE id = $3 AND (reset_token_expires IS NULL
                         OR reset_token_expires < NOW() + make_interval(mins => $2::int - $4::int))`,
      [hash, validMin, id, pauseMin],
    )
  ).changes;
}

/** Wie setRuecksetzTokenIfFree. Nur wenn genau eine offene Registrierung die Adresse
 * nennt: Bei mehreren ginge ein Link zu einem fremd angelegten Konto an ihren Inhaber. */
export function renewEmailTokenIfFree(
  db: DbInterface,
  email: string,
  hash: string,
  validStd: number,
  pauseMin: number,
) {
  return db.get<{ id: number; email: string }>(
    `UPDATE users u SET new_email_token = $2, new_email_until = NOW() + make_interval(hours => $3::int)
       FROM (SELECT MIN(id) AS id FROM users WHERE registration_pending AND LOWER(new_email) = LOWER($1)
             HAVING COUNT(*) = 1) e
      WHERE u.id = e.id AND u.is_active
        AND (u.new_email_until IS NULL OR u.new_email_until < NOW() + make_interval(hours => $3::int, mins => -$4::int))
      RETURNING u.id, u.new_email AS email`,
    [email, hash, validStd, pauseMin],
  );
}

export function accountAfterRuecksetzToken(
  db: DbInterface,
  hash: string,
): Promise<{ id: number; username: string } | undefined> {
  return db.get<Spalten<'users', 'id' | 'username'>>(
    'SELECT id, username FROM users WHERE reset_token = $1 AND reset_token_expires > NOW()',
    [hash],
  );
}

/** Prüfen und Verbrauchen in einer Anweisung: Zwei gleichzeitige Anfragen mit
 * demselben Link setzen sonst beide ein Passwort. */
export function resetSetPasswordAfter(
  db: DbInterface,
  tokenHash: string,
  hash: string,
): Promise<{ id: number } | undefined> {
  return db.get<{ id: number }>(
    `UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL
    WHERE reset_token = $2 AND reset_token_expires > NOW() RETURNING id`,
    [hash, tokenHash],
  );
}

export interface Zugang {
  token: string;
  label: string | null;
  created_at: Date;
  last_used: Date | null;
  hard_expires_at: Date | null;
  expires_at: Date | null;
  scope: 'app' | 'voll';
  ip_range: string | null;
  never_expires: boolean;
  rotated_at: Date;
}

/** Ein getauschter Token in seiner Überlappung zählt nicht mehr als eigenes Gerät. */
export function accessesOfAccount(db: DbInterface, uid: number): Promise<Zugang[]> {
  return db.all<Zugang>(
    `SELECT token, label, created_at, last_used, hard_expires_at, LEAST(expires_at, hard_expires_at) AS expires_at,
            scope, ip_range, never_expires, rotated_at
       FROM api_tokens
      WHERE user_id = $1 AND replaced_by IS NULL
        AND (expires_at IS NULL OR expires_at > NOW())
        AND (hard_expires_at IS NULL OR hard_expires_at > NOW())
      ORDER BY created_at DESC`,
    [uid],
  );
}

export function tokenStand(
  db: DbInterface,
  hash: string,
): Promise<
  | {
      scope: 'app' | 'voll';
      expires_at: Date | null;
      hard_expires_at: Date | null;
      never_expires: boolean;
      rotated_at: Date;
    }
  | undefined
> {
  return db.get(
    `SELECT scope, LEAST(expires_at, hard_expires_at) AS expires_at, hard_expires_at, never_expires, rotated_at
       FROM api_tokens WHERE token = $1`,
    [hash],
  );
}

/** Gleichheit auf der ganzen Kennung, kein Präfix. Ein Vorgänger in seiner
 * Überlappung fällt mit, zählt aber nicht als eigenes Gerät. */
export async function deleteAccess(
  db: DbInterface,
  uid: number,
  kennung: string,
): Promise<{ anzahl: number; label: string | null }> {
  const r = await db.get<{ n: number; label: string | null }>(
    `WITH weg AS (DELETE FROM api_tokens WHERE user_id = $1 AND (left(token, 16) = $2 OR left(replaced_by, 16) = $2)
                  RETURNING replaced_by, label)
     SELECT count(*) FILTER (WHERE replaced_by IS NULL)::int AS n, max(label) AS label FROM weg`,
    [uid, kennung],
  );
  return { anzahl: r?.n ?? 0, label: r?.label ?? null };
}

/** Alle App-Zugänge ausser `eigener` samt dessen Vorgänger und Nachfolger in der Überlappung. */
export async function deleteOtherAccesses(db: DbInterface, uid: number, eigener: string | null): Promise<number> {
  const r = await db.get<{ n: number }>(
    `WITH weg AS (DELETE FROM api_tokens WHERE user_id = $1 AND ($2::text IS NULL OR (token <> $2
                    AND replaced_by IS DISTINCT FROM $2
                    AND token IS DISTINCT FROM (SELECT replaced_by FROM api_tokens WHERE token = $2)))
                  RETURNING replaced_by)
     SELECT count(*) FILTER (WHERE replaced_by IS NULL)::int AS n FROM weg`,
    [uid, eigener],
  );
  return r?.n ?? 0;
}

export async function deleteOtherSessions(db: DbInterface, uid: number, ownSid: string): Promise<number> {
  return (
    await db.run("DELETE FROM user_sessions WHERE sess::jsonb->>'userId' = $1 AND sid <> $2", [String(uid), ownSid])
  ).changes;
}

export async function mussPasswortAendern(db: DbInterface, uid: number): Promise<boolean> {
  const r = await db.get<{ must_change_password: boolean }>('SELECT must_change_password FROM users WHERE id = $1', [
    uid,
  ]);
  return r?.must_change_password === true;
}

export function accountToNames(db: DbInterface, name: string) {
  return db.get<{ kennung: string; id: number | null }>(
    `
    SELECT lower($1::text) AS kennung,
           (SELECT id FROM users WHERE lower(username) = lower($1::text) OR lower(email) = lower($1::text)
             ORDER BY id LIMIT 1) AS id`,
    [name],
  );
}
