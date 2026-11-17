import type { DbSchnittstelle } from '../../../db/database';

export function legeSchrankeAn(tx: DbSchnittstelle) {
  return tx.run(`INSERT INTO voucher_balance_throttle (id) VALUES (1)
       ON CONFLICT (id) DO NOTHING`);
}

export function schrankenStand(tx: DbSchnittstelle, ABSTAND_SEK: number) {
  return tx.get(
    `SELECT CEIL(GREATEST(0, EXTRACT(EPOCH FROM (locked_until - NOW()))))::int
                AS sperre_sek,
              CEIL(GREATEST(0, EXTRACT(EPOCH FROM (
                last_checked_at + make_interval(secs => $1) - NOW()))))::int
                AS abstand_sek
         FROM voucher_balance_throttle
        WHERE id = 1
          FOR UPDATE`,
    [ABSTAND_SEK],
  );
}

export function merkeAbruf(tx: DbSchnittstelle) {
  return tx.run('UPDATE voucher_balance_throttle SET last_checked_at = NOW() WHERE id = 1');
}

export function sperreSchranke(db: DbSchnittstelle, BOTSCHUTZ_PAUSE_MIN: number) {
  return db.run(
    `INSERT INTO voucher_balance_throttle (id, locked_until)
     VALUES (1, NOW() + make_interval(mins => $1))
     ON CONFLICT (id) DO UPDATE SET locked_until = EXCLUDED.locked_until`,
    [BOTSCHUTZ_PAUSE_MIN],
  );
}

export function oeffneSchranke(db: DbSchnittstelle) {
  return db.run('UPDATE voucher_balance_throttle SET last_checked_at = NULL, locked_until = NULL WHERE id = 1');
}
