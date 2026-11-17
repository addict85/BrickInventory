import type { DbSchnittstelle } from '../../../db/database';

/** Konto 0 ist die Summe. */

/** In einem Schritt, damit gleichzeitige Aufrufe die Grenze nicht gemeinsam überspringen. */
export function zaehleApiAufruf(tx: DbSchnittstelle, day: string, apiName: string, id: number, grenze: number) {
  return tx.get<{ count: number }>(
    `
      INSERT INTO api_calls (day, api, account_id, count) VALUES ($1, $2, $3, 1)
      ON CONFLICT (day, api, account_id) DO UPDATE SET count = api_calls.count + 1
       WHERE api_calls.count < $4
      RETURNING count`,
    [day, apiName, id, grenze],
  );
}

export function aufrufeHeute(db: DbSchnittstelle, day: string, apiName: string) {
  return db.get<{ count: number }>('SELECT count FROM api_calls WHERE day = $1 AND api = $2 AND account_id = 0', [
    day,
    apiName,
  ]);
}

export function aufrufeJeKonto(db: DbSchnittstelle, date: string, apiName: string, id: number, alleKonten: number) {
  return db.all<{ account_id: number; count: number }>(
    'SELECT account_id, count FROM api_calls WHERE day = $1 AND api = $2 AND account_id IN ($3, $4)',
    [date, apiName, id, alleKonten],
  );
}

export function setzeApiZaehlerZurueck(db: DbSchnittstelle, day: string, apiName: string) {
  return db.run('DELETE FROM api_calls WHERE day = $1 AND api = $2', [day, apiName]);
}
