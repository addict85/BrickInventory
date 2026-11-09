import * as db from '../../../db/database';

export type QrStand = 'offen' | 'wartet' | 'bestaetigt' | 'abgeholt' | 'abgelehnt' | 'abgelaufen';

export interface QrZeile {
  id: number;
  user_id: number;
  token_days: number | null;
  geraet: string | null;
  ip_bereich: string | null;
  code_hash: string | null;
  stand: QrStand;
}

const STAND = `CASE WHEN abgelehnt_am IS NOT NULL THEN 'abgelehnt' WHEN abgeholt_am IS NOT NULL THEN 'abgeholt'
  WHEN expires_at <= NOW() THEN 'abgelaufen' WHEN bestaetigt_am IS NOT NULL THEN 'bestaetigt'
  WHEN used_at IS NOT NULL THEN 'wartet' ELSE 'offen' END`;
const SPALTEN = `id::int AS id, user_id, token_days, geraet, ip_bereich, code_hash, ${STAND} AS stand`;

export async function raeumeQrKopplungenAuf(): Promise<void> {
  await db.run(`DELETE FROM qr_login_tokens WHERE expires_at < NOW() - INTERVAL '1 hour'`);
}

export async function legeQrKopplungAn(hash: string, uid: number, bis: Date, tage: number | null): Promise<number> {
  const z = await db.get<{ id: number }>(
    'INSERT INTO qr_login_tokens (token, user_id, expires_at, token_days) VALUES ($1,$2,$3,$4) RETURNING id::int AS id',
    [hash, uid, bis, tage],
  );
  if (!z) throw new Error('qr_login_tokens: INSERT ohne Zeile');
  return z.id;
}

/** Atomar: Nur der erste Scan meldet sein Gerät an; die Frist beginnt neu für die Bestätigung. */
export function melde(
  hash: string,
  a: { abholung: string; codeHash: string; geraet: string; ipBereich: string | null; fristS: number },
): Promise<QrZeile | undefined> {
  return db.get<QrZeile>(
    `UPDATE qr_login_tokens SET used_at = NOW(), abholung = $2, code_hash = $3, geraet = $4, ip_bereich = $5,
            expires_at = NOW() + make_interval(secs => $6)
      WHERE token = $1 AND used_at IS NULL AND expires_at > NOW() RETURNING ${SPALTEN}`,
    [hash, a.abholung, a.codeHash, a.geraet, a.ipBereich, a.fristS],
  );
}

export function nachAbholung(abholung: string): Promise<QrZeile | undefined> {
  return db.get<QrZeile>(`SELECT ${SPALTEN} FROM qr_login_tokens WHERE abholung = $1`, [abholung]);
}

export function qrKopplungDesKontos(id: number, uid: number): Promise<QrZeile | undefined> {
  return db.get<QrZeile>(`SELECT ${SPALTEN} FROM qr_login_tokens WHERE id = $1 AND user_id = $2`, [id, uid]);
}

/** Nur aus „bestätigt": Zwei gleichzeitige Abholungen bekommen nicht zwei Tokens. */
export async function markiereAbgeholt(id: number): Promise<boolean> {
  return !!(
    await db.run(
      `UPDATE qr_login_tokens SET abgeholt_am = NOW()
    WHERE id = $1 AND bestaetigt_am IS NOT NULL AND abgeholt_am IS NULL AND abgelehnt_am IS NULL AND expires_at > NOW()`,
      [id],
    )
  ).changes;
}

export async function markiereBestaetigt(id: number): Promise<boolean> {
  return !!(
    await db.run(
      `UPDATE qr_login_tokens SET bestaetigt_am = NOW()
    WHERE id = $1 AND used_at IS NOT NULL AND bestaetigt_am IS NULL AND abgelehnt_am IS NULL AND expires_at > NOW()`,
      [id],
    )
  ).changes;
}

/** @returns die Zahl der Fehlversuche danach */
export async function zaehleQrFehlversuch(id: number): Promise<number> {
  const z = await db.get<{ n: number }>(
    'UPDATE qr_login_tokens SET fehlversuche = fehlversuche + 1 WHERE id = $1 RETURNING fehlversuche AS n',
    [id],
  );
  return z?.n ?? 0;
}

export async function markiereAbgelehnt(id: number): Promise<void> {
  await db.run(
    'UPDATE qr_login_tokens SET abgelehnt_am = COALESCE(abgelehnt_am, NOW()) WHERE id = $1 AND abgeholt_am IS NULL',
    [id],
  );
}
