import type { DbInterface } from '../../../db/database';

export type QrStand = 'offen' | 'wartet' | 'bestaetigt' | 'abgeholt' | 'abgelehnt' | 'abgelaufen';

export interface QrRow {
  id: number;
  user_id: number;
  token_days: number | null;
  device: string | null;
  ip_range: string | null;
  code_hash: string | null;
  state: QrStand;
}

const STAND = `CASE WHEN rejected_at IS NOT NULL THEN 'abgelehnt' WHEN picked_up_at IS NOT NULL THEN 'abgeholt'
  WHEN expires_at <= NOW() THEN 'abgelaufen' WHEN confirmed_at IS NOT NULL THEN 'bestaetigt'
  WHEN used_at IS NOT NULL THEN 'wartet' ELSE 'offen' END`;
const COLUMNS = `id::int AS id, user_id, token_days, device AS device, ip_range, code_hash, ${STAND} AS state`;

export async function cleanQrPairingsOn(db: DbInterface): Promise<void> {
  await db.run(`DELETE FROM qr_login_tokens WHERE expires_at < NOW() - INTERVAL '1 hour'`);
}

/** @returns null if `hoechstens` pairings are already open */
export async function createQrPairing(
  db: DbInterface,
  hash: string,
  uid: number,
  bis: Date,
  days: number | null,
  atMost: number,
): Promise<number | null> {
  const z = await db.get<{ id: number }>(
    `INSERT INTO qr_login_tokens (token, user_id, expires_at, token_days) SELECT $1, $2, $3, $4
      WHERE (SELECT COUNT(*) FROM qr_login_tokens
              WHERE expires_at > NOW() AND picked_up_at IS NULL AND rejected_at IS NULL) < $5
      RETURNING id::int AS id`,
    [hash, uid, bis, days, atMost],
  );
  return z?.id ?? null;
}

/** Atomic: only the first scan registers its device; the deadline restarts for the confirmation. */
export function report(
  db: DbInterface,
  hash: string,
  a: { pickup: string; codeHash: string; device: string; ipArea: string | null; fristS: number },
): Promise<QrRow | undefined> {
  return db.get<QrRow>(
    `UPDATE qr_login_tokens SET used_at = NOW(), pickup_code = $2, code_hash = $3, device = $4, ip_range = $5,
            expires_at = NOW() + make_interval(secs => $6)
      WHERE token = $1 AND used_at IS NULL AND expires_at > NOW() RETURNING ${COLUMNS}`,
    [hash, a.pickup, a.codeHash, a.device, a.ipArea, a.fristS],
  );
}

export function afterPickup(db: DbInterface, pickup: string): Promise<QrRow | undefined> {
  return db.get<QrRow>(`SELECT ${COLUMNS} FROM qr_login_tokens WHERE pickup_code = $1`, [pickup]);
}

export function qrPairingOfAccount(db: DbInterface, id: number, uid: number): Promise<QrRow | undefined> {
  return db.get<QrRow>(`SELECT ${COLUMNS} FROM qr_login_tokens WHERE id = $1 AND user_id = $2`, [id, uid]);
}

/** Only from "confirmed": two concurrent pickups do not get two tokens. */
export async function markPickedUp(db: DbInterface, id: number): Promise<boolean> {
  return !!(
    await db.run(
      `UPDATE qr_login_tokens SET picked_up_at = NOW()
    WHERE id = $1 AND confirmed_at IS NOT NULL AND picked_up_at IS NULL AND rejected_at IS NULL AND expires_at > NOW()`,
      [id],
    )
  ).changes;
}

export async function markConfirmed(db: DbInterface, id: number): Promise<boolean> {
  return !!(
    await db.run(
      `UPDATE qr_login_tokens SET confirmed_at = NOW()
    WHERE id = $1 AND used_at IS NOT NULL AND confirmed_at IS NULL AND rejected_at IS NULL AND expires_at > NOW()`,
      [id],
    )
  ).changes;
}

/** @returns the number of failed attempts afterwards */
export async function countQrFailedAttempt(db: DbInterface, id: number): Promise<number> {
  const z = await db.get<{ n: number }>(
    'UPDATE qr_login_tokens SET failed_attempts = failed_attempts + 1 WHERE id = $1 RETURNING failed_attempts AS n',
    [id],
  );
  return z?.n ?? 0;
}

export async function markRejected(db: DbInterface, id: number): Promise<void> {
  await db.run(
    'UPDATE qr_login_tokens SET rejected_at = COALESCE(rejected_at, NOW()) WHERE id = $1 AND picked_up_at IS NULL',
    [id],
  );
}
