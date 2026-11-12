import type { DbSchnittstelle } from '../../../db/database';

export function schreibeKurse(db: DbSchnittstelle, tage: string[], waehrungen: string[], jeEur: string[]) {
  return db.run(
    `INSERT INTO wechselkurse (tag, waehrung, je_eur)
       SELECT * FROM unnest($1::date[], $2::char(3)[], $3::numeric[])
       ON CONFLICT (waehrung, tag) DO UPDATE SET je_eur = EXCLUDED.je_eur`,
    [tage, waehrungen, jeEur],
  );
}

export function gibtEsKurse(db: DbSchnittstelle) {
  return db.get('SELECT 1 AS da FROM wechselkurse LIMIT 1');
}
