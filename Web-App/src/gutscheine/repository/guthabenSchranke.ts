import type { DbSchnittstelle } from '../../../db/database';
import * as db from '../../../db/database';

/** Die eine Zeile der Guthaben-Schranke (id 1): letzter Abruf und Sperre nach einer Drosselung. */

export function legeSchrankeAn(tx: DbSchnittstelle) {
  return tx.run(`INSERT INTO gutschein_guthaben_schranke (id) VALUES (1)
       ON CONFLICT (id) DO NOTHING`);
}

/** Sekunden bis zum Ende der Sperre und bis zum nächsten erlaubten Abruf. */
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
