import type { DbInterface } from '../../../db/database';
import type { FinancesReadContract } from '../readContract';
import { marketPriceSql } from '../../../db/geldSql';

export function cachePricesForSets(db: DbInterface, werte: (string[] | string | number)[], ttlClause: string) {
  return db.all<{ set_number: string; condition: string; marktpreis: number | null }>(
    `SELECT set_number, condition, ${marketPriceSql()} AS marktpreis
       FROM price_cache
      WHERE set_number = ANY($1) AND condition IN ('N','U') AND currency_code = $2${ttlClause}`,
    werte,
  );
}

export function setEntriesToValue(db: DbInterface, l: FinancesReadContract, userId: number, setNumber: string) {
  return db.all<{ quantity: number; condition: string | null }>(
    `SELECT quantity, condition FROM ${l.setErfassungen('= $1')} e WHERE set_number=$2`,
    [userId, setNumber],
  );
}
