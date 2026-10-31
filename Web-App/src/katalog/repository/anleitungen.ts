import * as db from '../../../db/database';

/** Gemeinsame Anleitungen je Set (shared_instructions) und der Takt der Anleitungsquellen. */

export function zaehleAnleitungen(setNumber: string) {
  return db.get('SELECT COUNT(*) as c FROM shared_instructions WHERE set_number = $1', [setNumber]);
}

export function anleitungenDesSets(setNumber: string) {
  return db.all('SELECT * FROM shared_instructions WHERE set_number = $1', [setNumber]);
}

/** Wie die Anmeldebremse: zählen und den Stand liefern, in einem Schritt. */
export function zaehleQuellenAufruf(key: string) {
  return db.get(`INSERT INTO rate_limit_attempts (key, count, first_at, last_at) VALUES ($1, 1, NOW(), NOW())
     ON CONFLICT (key) DO UPDATE SET count = 1, first_at = NOW(), last_at = NOW()
       WHERE rate_limit_attempts.first_at < NOW() - INTERVAL '1 day'
     RETURNING key`, [key]);
}

export function loescheAnleitungenDesSets(setNumber: string) {
  return db.run('DELETE FROM shared_instructions WHERE set_number = $1', [setNumber]);
}

export function hatBrickinstructions(setNumber: string) {
  return db.get("SELECT 1 FROM shared_instructions WHERE set_number = $1 AND url LIKE '%brickinstructions%'", [setNumber]);
}

export function merkeAnleitung(setNumber: string, url: unknown, beschreibung: unknown, lokalerPfad: unknown) {
  return db.run('INSERT INTO shared_instructions (set_number,url,description,local_path) VALUES ($1,$2,$3,$4) ON CONFLICT (set_number,url) DO NOTHING', [setNumber, url, beschreibung, lokalerPfad]);
}

export function setzeAnleitungsdatei(lokalerPfad: unknown, setNumber: string) {
  return db.run('UPDATE shared_instructions SET local_path = $1 WHERE set_number = $2 AND local_path IS NULL', [lokalerPfad, setNumber]);
}
