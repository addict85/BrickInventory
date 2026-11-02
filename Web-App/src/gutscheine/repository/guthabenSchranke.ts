import type { DbSchnittstelle } from '../../../db/database';
import * as db from '../../../db/database';

export function legeSchrankeAn(tx: DbSchnittstelle) {
  return tx.run(`INSERT INTO gutschein_guthaben_schranke (id) VALUES (1)
       ON CONFLICT (id) DO NOTHING`);
}

export function schrankenStand(tx: DbSchnittstelle, ABSTAND_SEK: number) {
  return tx.get(`SELECT CEIL(GREATEST(0, EXTRACT(EPOCH FROM (sperre_bis - NOW()))))::int
                AS sperre_sek,
              CEIL(GREATEST(0, EXTRACT(EPOCH FROM (
                letzter_abruf + make_interval(secs => $1) - NOW()))))::int
                AS abstand_sek
         FROM gutschein_guthaben_schranke
        WHERE id = 1
          FOR UPDATE`, [ABSTAND_SEK]);
}

const kontoSchluessel = (uid: number) => `guthaben-konto|${uid}`;

export function kontoStand(tx: DbSchnittstelle, uid: number) {
  return tx.get<{ anzahl: number; warten_sek: number }>(`SELECT count AS anzahl,
       CEIL(EXTRACT(EPOCH FROM (first_at + INTERVAL '1 hour' - NOW())))::int AS warten_sek
     FROM rate_limit_attempts WHERE key = $1 AND first_at > NOW() - INTERVAL '1 hour'`, [kontoSchluessel(uid)]);
}

export async function zaehleKonto(tx: DbSchnittstelle, uid: number): Promise<void> {
  await tx.run(`INSERT INTO rate_limit_attempts (key, count, first_at, last_at) VALUES ($1, 1, NOW(), NOW())
     ON CONFLICT (key) DO UPDATE SET last_at = NOW(),
       count = CASE WHEN rate_limit_attempts.first_at <= NOW() - INTERVAL '1 hour' THEN 1 ELSE rate_limit_attempts.count + 1 END,
       first_at = CASE WHEN rate_limit_attempts.first_at <= NOW() - INTERVAL '1 hour' THEN NOW() ELSE rate_limit_attempts.first_at END`,
  [kontoSchluessel(uid)]);
}

export function merkeAbruf(tx: DbSchnittstelle) {
  return tx.run('UPDATE gutschein_guthaben_schranke SET letzter_abruf = NOW() WHERE id = 1');
}

export function sperreSchranke(BOTSCHUTZ_PAUSE_MIN: number) {
  return db.run(`INSERT INTO gutschein_guthaben_schranke (id, sperre_bis)
     VALUES (1, NOW() + make_interval(mins => $1))
     ON CONFLICT (id) DO UPDATE SET sperre_bis = EXCLUDED.sperre_bis`, [BOTSCHUTZ_PAUSE_MIN]);
}

export function oeffneSchranke() {
  return db.run('UPDATE gutschein_guthaben_schranke SET letzter_abruf = NULL, sperre_bis = NULL WHERE id = 1');
}
