import type { DbSchnittstelle } from '../../../db/database';

export interface AnleitungsZeile {
  id: number;
  set_number: string;
  url: string;
  description: string | null;
  local_path: string | null;
  fetched_at: Date | null;
}

export function zaehleAnleitungen(db: DbSchnittstelle, setNumber: string) {
  return db.get<{ c: string }>('SELECT COUNT(*) as c FROM shared_instructions WHERE set_number = $1', [setNumber]);
}

export function anleitungenDesSets(db: DbSchnittstelle, setNumber: string) {
  return db.all<AnleitungsZeile>('SELECT * FROM shared_instructions WHERE set_number = $1', [setNumber]);
}

/** Zählen und Stand liefern in einem Schritt, wie die Anmeldebremse. */
export function zaehleQuellenAufruf(db: DbSchnittstelle, key: string) {
  return db.get(
    `INSERT INTO rate_limit_attempts (key, count, first_at, last_at) VALUES ($1, 1, NOW(), NOW())
     ON CONFLICT (key) DO UPDATE SET count = 1, first_at = NOW(), last_at = NOW()
       WHERE rate_limit_attempts.first_at < NOW() - INTERVAL '1 day'
     RETURNING key`,
    [key],
  );
}

export function loescheAnleitungenDesSets(db: DbSchnittstelle, setNumber: string) {
  return db.run('DELETE FROM shared_instructions WHERE set_number = $1', [setNumber]);
}

export function hatBrickinstructions(db: DbSchnittstelle, setNumber: string) {
  return db.get("SELECT 1 FROM shared_instructions WHERE set_number = $1 AND url LIKE '%brickinstructions%'", [
    setNumber,
  ]);
}

export function merkeAnleitung(
  db: DbSchnittstelle,
  setNumber: string,
  url: string,
  beschreibung: string | null,
  lokalerPfad: string | null,
) {
  return db.run(
    'INSERT INTO shared_instructions (set_number,url,description,local_path) VALUES ($1,$2,$3,$4) ON CONFLICT (set_number,url) DO NOTHING',
    [setNumber, url, beschreibung, lokalerPfad],
  );
}

export function setzeAnleitungsdatei(db: DbSchnittstelle, lokalerPfad: string, setNumber: string) {
  return db.run('UPDATE shared_instructions SET local_path = $1 WHERE set_number = $2 AND local_path IS NULL', [
    lokalerPfad,
    setNumber,
  ]);
}
