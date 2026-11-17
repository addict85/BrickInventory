import type { DbSchnittstelle, Treffer } from '../../../db/database';

export function schreibeKurse(db: DbSchnittstelle, tage: string[], waehrungen: string[], jeEur: string[]) {
  return db.run(
    `INSERT INTO exchange_rates (day, currency, per_eur)
       SELECT * FROM unnest($1::date[], $2::char(3)[], $3::numeric[])
       ON CONFLICT (currency, day) DO UPDATE SET per_eur = EXCLUDED.per_eur`,
    [tage, waehrungen, jeEur],
  );
}

export function gibtEsKurse(db: DbSchnittstelle) {
  return db.get<Treffer>('SELECT 1 AS da FROM exchange_rates LIMIT 1');
}
