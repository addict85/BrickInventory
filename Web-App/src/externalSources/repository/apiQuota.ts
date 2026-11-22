import type { DbInterface } from '../../../db/database';

/** Account 0 is the sum. */

/** In one step so that concurrent calls do not jump the limit together. */
export function countApiCall(tx: DbInterface, day: string, apiName: string, id: number, limit: number) {
  return tx.get<{ count: number }>(
    `
      INSERT INTO api_calls (day, api, account_id, count) VALUES ($1, $2, $3, 1)
      ON CONFLICT (day, api, account_id) DO UPDATE SET count = api_calls.count + 1
       WHERE api_calls.count < $4
      RETURNING count`,
    [day, apiName, id, limit],
  );
}

export function callsToday(db: DbInterface, day: string, apiName: string) {
  return db.get<{ count: number }>('SELECT count FROM api_calls WHERE day = $1 AND api = $2 AND account_id = 0', [
    day,
    apiName,
  ]);
}

export function callsJeAccount(db: DbInterface, date: string, apiName: string, id: number, allAccounts: number) {
  return db.all<{ account_id: number; count: number }>(
    'SELECT account_id, count FROM api_calls WHERE day = $1 AND api = $2 AND account_id IN ($3, $4)',
    [date, apiName, id, allAccounts],
  );
}

export function setApiCounterBack(db: DbInterface, day: string, apiName: string) {
  return db.run('DELETE FROM api_calls WHERE day = $1 AND api = $2', [day, apiName]);
}
