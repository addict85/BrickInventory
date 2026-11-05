import type { DbSchnittstelle } from '../../../db/database';
import * as db from '../../../db/database';

/** Konto 0 ist die Summe. */

/** In einem Schritt, damit gleichzeitige Aufrufe die Grenze nicht gemeinsam überspringen. */
export function zaehleApiAufruf(tx: DbSchnittstelle, tag: string, apiName: string, id: number, grenze: number) {
  return tx.get<{ anzahl: number }>(`
      INSERT INTO api_aufrufe (tag, api, konto, anzahl) VALUES ($1, $2, $3, 1)
      ON CONFLICT (tag, api, konto) DO UPDATE SET anzahl = api_aufrufe.anzahl + 1
       WHERE api_aufrufe.anzahl < $4
      RETURNING anzahl`, [tag, apiName, id, grenze]);
}

export function aufrufeHeute(tag: string, apiName: string) {
  return db.get<{ anzahl: number }>('SELECT anzahl FROM api_aufrufe WHERE tag = $1 AND api = $2 AND konto = 0', [tag, apiName]);
}

export function aufrufeJeKonto(date: string, apiName: string, id: number, alleKonten: number) {
  return db.all<{ konto: number; anzahl: number }>('SELECT konto, anzahl FROM api_aufrufe WHERE tag = $1 AND api = $2 AND konto IN ($3, $4)', [date, apiName, id, alleKonten]);
}

export function setzeApiZaehlerZurueck(tag: string, apiName: string) {
  return db.run('DELETE FROM api_aufrufe WHERE tag = $1 AND api = $2', [tag, apiName]);
}
