import type { DbInterface } from '../../../db/database';
import type { FinancesReadContract } from '../readContract';
import { marketPriceSql } from '../../../db/moneySql';

export type State = 'N' | 'U';
type PriceRow = { avg_price: string | null; qty_avg_price: string | null; condition: State };

/** Only real prices above zero. */
export function setPriceFromCache(db: DbInterface, setNumber: string, condition: string, currency: string) {
  return db.get<{ market_price: string }>(
    `SELECT ${marketPriceSql()} AS market_price FROM price_cache
       WHERE set_number=$1 AND condition IN ('N','U') AND currency_code=$3 AND ${marketPriceSql()} IS NOT NULL
       ORDER BY (condition = $2) DESC LIMIT 1`,
    [setNumber, condition, currency],
  );
}

export function partEntryState(
  db: DbInterface,
  l: FinancesReadContract,
  userId: number,
  partNumber: string,
  colorId: number,
) {
  return db.get<{ any_used: number | null; cnt: string }>(
    `SELECT MAX(CASE WHEN condition='U' THEN 1 ELSE 0 END) AS any_used, COUNT(*) AS cnt FROM ${l.partAcquisitions()} e WHERE user_id=$1 AND part_number=$2 AND color_id=$3`,
    [userId, partNumber, colorId],
  );
}

export function minifigEntryState(db: DbInterface, l: FinancesReadContract, userId: number, figNumber: string) {
  return db.get<{ any_used: number | null; cnt: string }>(
    `SELECT MAX(CASE WHEN condition='U' THEN 1 ELSE 0 END) AS any_used, COUNT(*) AS cnt FROM ${l.figAcquisitions()} e WHERE user_id=$1 AND fig_number=$2`,
    [userId, figNumber],
  );
}

export function minifigsPricesFromCache(db: DbInterface, numbers: string[], currency: string, ttlHours: number) {
  return db.all<PriceRow & { fig_number: string }>(
    `SELECT fig_number, condition, avg_price, qty_avg_price FROM minifig_price_cache
      WHERE fig_number = ANY($1) AND currency_code = $2
        AND fetched_at > NOW() - make_interval(hours => $3)`,
    [numbers, currency, ttlHours],
  );
}

export function partsPricesFromCache(db: DbInterface, numbers: string[], currency: string, ttlHours: number) {
  return db.all<PriceRow & { part_number: string; color_id: number }>(
    `SELECT part_number, color_id, condition, avg_price, qty_avg_price FROM part_price_cache
      WHERE part_number = ANY($1) AND currency_code = $2
        AND fetched_at > NOW() - make_interval(hours => $3)`,
    [numbers, currency, ttlHours],
  );
}

/** Like estimatedMinifigsPrice for many figures in one query; key `nummer|zustand`. */
export async function estimatedMinifigsPrices(db: DbInterface, minifigs: string[], currency: string, ttlHours: number) {
  const from = new Map<string, { price: number; abdeckung: number | null }>();
  if (!minifigs.length) return from;
  const rows = await db.all<{ fig_number: string; condition: string; market_price: string; coverage: string | null }>(
    `SELECT fig_number, condition, ${marketPriceSql()} AS market_price, coverage FROM minifig_price_cache
      WHERE fig_number = ANY($1) AND currency_code = $2 AND estimated AND ${marketPriceSql()} IS NOT NULL
        AND fetched_at > NOW() - make_interval(hours => $3)`,
    [[...new Set(minifigs)], currency, ttlHours],
  );
  for (const z of rows)
    from.set(`${z.fig_number}|${z.condition}`, {
      price: Number(z.market_price),
      abdeckung: z.coverage == null ? null : Number(z.coverage),
    });
  return from;
}

export function estimatedMinifigsPrice(
  db: DbInterface,
  figNumber: string,
  condition: string,
  currency: string,
  ttlHours: number,
) {
  return db.get<{ market_price: string | null; coverage: string | null }>(
    `SELECT ${marketPriceSql()} AS market_price, coverage FROM minifig_price_cache
        WHERE fig_number = $1 AND condition = $2 AND currency_code = $3 AND estimated
          AND fetched_at > NOW() - make_interval(hours => $4)`,
    [figNumber, condition, currency, ttlHours],
  );
}

export function rememberEstimatedMinifigsPrice(
  db: DbInterface,
  figNumber: string,
  condition: string,
  currency: string,
  price: number,
  coverage: number,
) {
  return db.run(
    `INSERT INTO minifig_price_cache (fig_number, condition, currency_code, avg_price, qty_avg_price, estimated, coverage)
       VALUES ($1,$2,$3,$4,$4,TRUE,$5) ON CONFLICT (fig_number,condition,currency_code)
       DO UPDATE SET avg_price=$4, qty_avg_price=$4, fetched_at=NOW(), estimated=TRUE, coverage=$5`,
    [figNumber, condition, currency, price, coverage],
  );
}

export function rememberEstimatedMinifigsHistory(
  db: DbInterface,
  figNumber: string,
  condition: string,
  currency: string,
  price: number,
  coverage: number,
) {
  return db.run(
    `INSERT INTO minifig_price_history (fig_number, condition, currency_code, avg_price, qty_avg_price, estimated, coverage)
       VALUES ($1,$2,$3,$4,$4,TRUE,$5) ON CONFLICT DO NOTHING`,
    [figNumber, condition, currency, price, coverage],
  );
}
