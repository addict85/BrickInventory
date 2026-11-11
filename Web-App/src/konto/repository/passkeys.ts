import * as db from '../../../db/database';

/** Challenges liegen nur als Hash vor. */

/** @returns false, wenn schon `hoechstens` Challenges offen sind */
export async function speichereChallenge(hash: string, zweck: string, uid: number | null, bis: Date,
                                         hoechstens: number): Promise<boolean> {
  await db.run('DELETE FROM webauthn_challenges WHERE expires_at < NOW()');
  return (await db.run(`INSERT INTO webauthn_challenges (challenge, user_id, zweck, expires_at)
    SELECT $1, $2, $3, $4 WHERE (SELECT COUNT(*) FROM webauthn_challenges) < $5`,
    [hash, uid, zweck, bis, hoechstens])).changes > 0;
}

/** Löschen und Prüfen in einem Schritt: Eine Challenge gilt genau einmal. */
export async function verbraucheChallenge(hash: string, zweck: string, uid: number | null): Promise<boolean> {
  return !!await db.get(
    `DELETE FROM webauthn_challenges
      WHERE challenge = $1 AND zweck = $2 AND expires_at > NOW()
        AND ($3::int IS NULL OR user_id = $3::int)
      RETURNING challenge`, [hash, zweck, uid]);
}

export function kennungenDesKontos(uid: number) {
  return db.all<{ credential_id: string; transports: string | null }>(
    'SELECT credential_id, transports FROM passkeys WHERE user_id = $1', [uid]);
}

export async function legeAn(uid: number, credentialId: string, publicKey: Buffer, zaehler: number,
                             transports: string | null, name: string): Promise<{ id: number; name: string } | null> {
  return (await db.get<{ id: number; name: string }>(
    `INSERT INTO passkeys (user_id, credential_id, public_key, sign_count, transports, name)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (credential_id) DO NOTHING RETURNING id, name`,
    [uid, credentialId, publicKey, zaehler, transports, name])) ?? null;
}

export function schluessel(credentialId: string, uid: number | null) {
  return db.get<{ id: number; user_id: number; public_key: Buffer; sign_count: string; transports: string | null }>(
    `SELECT id, user_id, public_key, sign_count, transports FROM passkeys
      WHERE credential_id = $1 AND ($2::int IS NULL OR user_id = $2::int)`, [credentialId, uid]);
}

/** Nur, wenn der Zähler noch der gelesene ist: Zwei gleichzeitige Anmeldungen gelingen nicht beide. */
export async function zaehlerWeiter(id: number, neu: number, alt: string): Promise<boolean> {
  return !!(await db.run('UPDATE passkeys SET sign_count = $2, last_used = NOW() WHERE id = $1 AND sign_count = $3',
    [id, neu, alt])).changes;
}

export function desKontos(uid: number) {
  return db.all<{ id: number; name: string | null; created_at: Date; last_used: Date | null; transports: string | null }>(
    'SELECT id, name, created_at, last_used, transports FROM passkeys WHERE user_id = $1 ORDER BY created_at', [uid]);
}

export async function hatWelche(uid: number): Promise<boolean> {
  return !!await db.get('SELECT 1 FROM passkeys WHERE user_id = $1 LIMIT 1', [uid]);
}

export async function loescheAlleDesKontos(uid: number): Promise<number> {
  return (await db.run('DELETE FROM passkeys WHERE user_id = $1', [uid])).changes ?? 0;
}

export async function loeschePasskeyZeile(uid: number, id: number): Promise<boolean> {
  return !!(await db.run('DELETE FROM passkeys WHERE user_id = $1 AND id = $2', [uid, id])).changes;
}
