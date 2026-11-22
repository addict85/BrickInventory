import type { DbInterface } from '../../../db/database';
import type { FinancesReadContract } from '../readContract';
import { marketPriceSql } from '../../../db/moneySql';

export interface PriceSpace {
  user_id: number;
  set_number: string;
}

export async function inventoryPlaces(db: DbInterface, l: FinancesReadContract): Promise<PriceSpace[]> {
  return db.all<PriceSpace>(`SELECT DISTINCT user_id, set_number FROM ${l.setBestand()} s`);
}

export async function wantedListsPlaces(db: DbInterface, l: FinancesReadContract): Promise<PriceSpace[]> {
  return db.all<PriceSpace>(`SELECT DISTINCT user_id, set_number FROM ${l.merkliste()} w`);
}

type StateRow = { set_number: string; c: string | null };

export async function recordedStates(
  db: DbInterface,
  l: FinancesReadContract,
  userId: number,
  setNumbers: string[],
): Promise<StateRow[]> {
  return db.all<StateRow>(
    `SELECT set_number, COALESCE(condition,'N') AS c
       FROM ${l.setErfassungen('= $1')} e WHERE set_number = ANY($2)
      GROUP BY set_number, COALESCE(condition,'N')`,
    [userId, setNumbers],
  );
}

export async function desiredStates(
  db: DbInterface,
  l: FinancesReadContract,
  userId: number,
  setNumbers: string[],
): Promise<StateRow[]> {
  return db.all<StateRow>(
    `SELECT DISTINCT set_number, COALESCE(condition,'N') AS c
       FROM ${l.merkliste('= $1')} w WHERE set_number = ANY($2)`,
    [userId, setNumbers],
  );
}

/** Once a day. @returns number of new points */
export async function writeDailyStatus(db: DbInterface): Promise<number> {
  const r = await db.run(`
    INSERT INTO price_history (set_number, condition, currency_code, avg_price, qty_avg_price, min_price, max_price, recorded_at)
    SELECT set_number, condition, currency_code, avg_price, qty_avg_price, min_price, max_price, NOW()
    FROM price_cache
    WHERE ${marketPriceSql()} IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM price_history ph
        WHERE ph.set_number = price_cache.set_number
          AND ph.condition = price_cache.condition
          AND ph.currency_code = price_cache.currency_code
          AND ph.recorded_at::date = CURRENT_DATE
      ) ON CONFLICT DO NOTHING`);
  return r.changes ?? 0;
}

export async function setsWithAlarm(db: DbInterface): Promise<string[]> {
  const rows = await db.all<{ set_number: string }>('SELECT DISTINCT set_number FROM price_alerts');
  return rows.map(r => String(r.set_number));
}
