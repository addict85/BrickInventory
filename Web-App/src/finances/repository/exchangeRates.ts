import type { DbInterface, Hit } from '../../../db/database';

export function writeRates(db: DbInterface, days: string[], currencies: string[], perEur: string[]) {
  return db.run(
    `INSERT INTO exchange_rates (day, currency, per_eur)
       SELECT * FROM unnest($1::date[], $2::char(3)[], $3::numeric[])
       ON CONFLICT (currency, day) DO UPDATE SET per_eur = EXCLUDED.per_eur`,
    [days, currencies, perEur],
  );
}

export function givesEsRates(db: DbInterface) {
  return db.get<Hit>('SELECT 1 AS da FROM exchange_rates LIMIT 1');
}
