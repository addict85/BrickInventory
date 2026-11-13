import type { DbSchnittstelle } from '../../../db/database';
import { marktpreisSql } from '../../../db/geldSql';

export function cachePreiseFuerSets(db: DbSchnittstelle, werte: (string[] | string | number)[], ttlClause: string) {
  return db.all<{ set_number: string; condition: string; marktpreis: number | null }>(
    `SELECT set_number, condition, ${marktpreisSql()} AS marktpreis
       FROM price_cache
      WHERE set_number = ANY($1) AND condition IN ('N','U') AND currency_code = $2${ttlClause}`,
    werte,
  );
}

export function setErfassungenZumWert(db: DbSchnittstelle, userId: number, setNumber: string) {
  return db.all<{ quantity: number; condition: string | null }>(
    'SELECT quantity, condition FROM set_acquisitions WHERE user_id=$1 AND set_number=$2',
    [userId, setNumber],
  );
}
