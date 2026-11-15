import type { DbSchnittstelle } from '../../../db/database';
import type { FinanzenLesevertrag } from '../lesevertrag';
import { marktpreisSql } from '../../../db/geldSql';

export interface PreisPlatz {
  user_id: number;
  set_number: string;
}

export async function bestandsPlaetze(db: DbSchnittstelle, l: FinanzenLesevertrag): Promise<PreisPlatz[]> {
  return db.all<PreisPlatz>(`SELECT DISTINCT user_id, set_number FROM ${l.setBestand()} s`);
}

export async function merklistenPlaetze(db: DbSchnittstelle, l: FinanzenLesevertrag): Promise<PreisPlatz[]> {
  return db.all<PreisPlatz>(`SELECT DISTINCT user_id, set_number FROM ${l.merkliste()} w`);
}

type ZustandsZeile = { set_number: string; c: string | null };

export async function erfassteZustaende(
  db: DbSchnittstelle,
  l: FinanzenLesevertrag,
  userId: number,
  setNumbers: string[],
): Promise<ZustandsZeile[]> {
  return db.all<ZustandsZeile>(
    `SELECT set_number, COALESCE(condition,'N') AS c
       FROM ${l.setErfassungen('= $1')} e WHERE set_number = ANY($2)
      GROUP BY set_number, COALESCE(condition,'N')`,
    [userId, setNumbers],
  );
}

export async function gewuenschteZustaende(
  db: DbSchnittstelle,
  l: FinanzenLesevertrag,
  userId: number,
  setNumbers: string[],
): Promise<ZustandsZeile[]> {
  return db.all<ZustandsZeile>(
    `SELECT DISTINCT set_number, COALESCE(condition,'N') AS c
       FROM ${l.merkliste('= $1')} w WHERE set_number = ANY($2)`,
    [userId, setNumbers],
  );
}

/** Einmal am Tag. @returns Anzahl neuer Punkte */
export async function schreibeTagesstand(db: DbSchnittstelle): Promise<number> {
  const r = await db.run(`
    INSERT INTO price_history (set_number, condition, currency_code, avg_price, qty_avg_price, min_price, max_price, recorded_at)
    SELECT set_number, condition, currency_code, avg_price, qty_avg_price, min_price, max_price, NOW()
    FROM price_cache
    WHERE ${marktpreisSql()} IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM price_history ph
        WHERE ph.set_number = price_cache.set_number
          AND ph.condition = price_cache.condition
          AND ph.currency_code = price_cache.currency_code
          AND ph.recorded_at::date = CURRENT_DATE
      ) ON CONFLICT DO NOTHING`);
  return r.changes ?? 0;
}

export async function setsMitAlarm(db: DbSchnittstelle): Promise<string[]> {
  const rows = await db.all<{ set_number: string }>('SELECT DISTINCT set_number FROM price_alerts');
  return rows.map(r => String(r.set_number));
}
