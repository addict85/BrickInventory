import * as db from '../../../db/database';

/** Marktpreise und Erfassungen für den Wert eines Sets. */

export function cachePreiseFuerSets(werte: (string[] | string | number)[], ttlClause: string) {
  return db.all(`SELECT set_number, condition, avg_price
       FROM price_cache
      WHERE set_number = ANY($1) AND condition IN ('N','U') AND currency_code = $2${ttlClause}`, werte);
}

export function setErfassungenZumWert(userId: number, setNumber: string) {
  return db.all('SELECT quantity, condition FROM set_acquisitions WHERE user_id=$1 AND set_number=$2', [userId, setNumber]);
}
