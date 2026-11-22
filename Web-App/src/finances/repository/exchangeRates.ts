import type { DbInterface, Treffer } from '../../../db/database';

export function writeRates(db: DbInterface, tage: string[], currencies: string[], jeEur: string[]) {
  return db.run(
    `INSERT INTO exchange_rates (day, currency, per_eur)
       SELECT * FROM unnest($1::date[], $2::char(3)[], $3::numeric[])
       ON CONFLICT (currency, day) DO UPDATE SET per_eur = EXCLUDED.per_eur`,
    [tage, currencies, jeEur],
  );
}

export function givesEsRates(db: DbInterface) {
  return db.get<Treffer>('SELECT 1 AS da FROM exchange_rates LIMIT 1');
}
