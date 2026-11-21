import type { DbInterface } from '../../../db/database';

export function ensureThrottleRow(tx: DbInterface) {
  return tx.run(`INSERT INTO voucher_balance_throttle (id) VALUES (1)
       ON CONFLICT (id) DO NOTHING`);
}

export function throttleState(tx: DbInterface, GAP_SEC: number) {
  return tx.get(
    `SELECT CEIL(GREATEST(0, EXTRACT(EPOCH FROM (locked_until - NOW()))))::int
                AS sperre_sek,
              CEIL(GREATEST(0, EXTRACT(EPOCH FROM (
                last_checked_at + make_interval(secs => $1) - NOW()))))::int
                AS abstand_sek
         FROM voucher_balance_throttle
        WHERE id = 1
          FOR UPDATE`,
    [GAP_SEC],
  );
}

export function rememberCall(tx: DbInterface) {
  return tx.run('UPDATE voucher_balance_throttle SET last_checked_at = NOW() WHERE id = 1');
}

export function lockThrottle(db: DbInterface, BOT_PROTECTION_PAUSE_MIN: number) {
  return db.run(
    `INSERT INTO voucher_balance_throttle (id, locked_until)
     VALUES (1, NOW() + make_interval(mins => $1))
     ON CONFLICT (id) DO UPDATE SET locked_until = EXCLUDED.locked_until`,
    [BOT_PROTECTION_PAUSE_MIN],
  );
}

export function openThrottle(db: DbInterface) {
  return db.run('UPDATE voucher_balance_throttle SET last_checked_at = NULL, locked_until = NULL WHERE id = 1');
}
