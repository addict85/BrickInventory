import type { DbInterface } from '../../../db/database';
import type { FinancesReadContract } from '../lesevertrag';
import { marktpreisSql } from '../../../db/geldSql';

export type Zustand = 'N' | 'U';
type Preiszeile = { avg_price: string | null; qty_avg_price: string | null; condition: Zustand };

/** Nur echte Preise über null. */
export function setPriceFromCache(db: DbInterface, setNumber: string, zustand: string, waehrung: string) {
  return db.get<{ marktpreis: string }>(
    `SELECT ${marktpreisSql()} AS marktpreis FROM price_cache
       WHERE set_number=$1 AND condition IN ('N','U') AND currency_code=$3 AND ${marktpreisSql()} IS NOT NULL
       ORDER BY (condition = $2) DESC LIMIT 1`,
    [setNumber, zustand, waehrung],
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
    `SELECT MAX(CASE WHEN condition='U' THEN 1 ELSE 0 END) AS any_used, COUNT(*) AS cnt FROM ${l.teilErfassungen()} e WHERE user_id=$1 AND part_number=$2 AND color_id=$3`,
    [userId, partNumber, colorId],
  );
}

export function minifigEntryState(db: DbInterface, l: FinancesReadContract, userId: number, figNumber: string) {
  return db.get<{ any_used: number | null; cnt: string }>(
    `SELECT MAX(CASE WHEN condition='U' THEN 1 ELSE 0 END) AS any_used, COUNT(*) AS cnt FROM ${l.figurErfassungen()} e WHERE user_id=$1 AND fig_number=$2`,
    [userId, figNumber],
  );
}

export function minifigsPricesFromCache(db: DbInterface, nummern: string[], waehrung: string, ttlStunden: number) {
  return db.all<Preiszeile & { fig_number: string }>(
    `SELECT fig_number, condition, avg_price, qty_avg_price FROM minifig_price_cache
      WHERE fig_number = ANY($1) AND currency_code = $2
        AND fetched_at > NOW() - make_interval(hours => $3)`,
    [nummern, waehrung, ttlStunden],
  );
}

export function partsPricesFromCache(db: DbInterface, nummern: string[], waehrung: string, ttlStunden: number) {
  return db.all<Preiszeile & { part_number: string; color_id: number }>(
    `SELECT part_number, color_id, condition, avg_price, qty_avg_price FROM part_price_cache
      WHERE part_number = ANY($1) AND currency_code = $2
        AND fetched_at > NOW() - make_interval(hours => $3)`,
    [nummern, waehrung, ttlStunden],
  );
}

/** Wie estimatedMinifigsPrice für viele Figuren in einer Abfrage; Schlüssel `nummer|zustand`. */
export async function estimatedMinifigsPrices(
  db: DbInterface,
  figuren: string[],
  waehrung: string,
  ttlStunden: number,
) {
  const aus = new Map<string, { preis: number; abdeckung: number | null }>();
  if (!figuren.length) return aus;
  const zeilen = await db.all<{ fig_number: string; condition: string; marktpreis: string; coverage: string | null }>(
    `SELECT fig_number, condition, ${marktpreisSql()} AS marktpreis, coverage FROM minifig_price_cache
      WHERE fig_number = ANY($1) AND currency_code = $2 AND estimated AND ${marktpreisSql()} IS NOT NULL
        AND fetched_at > NOW() - make_interval(hours => $3)`,
    [[...new Set(figuren)], waehrung, ttlStunden],
  );
  for (const z of zeilen)
    aus.set(`${z.fig_number}|${z.condition}`, {
      preis: Number(z.marktpreis),
      abdeckung: z.coverage == null ? null : Number(z.coverage),
    });
  return aus;
}

export function estimatedMinifigsPrice(
  db: DbInterface,
  figNumber: string,
  zustand: string,
  waehrung: string,
  ttlStunden: number,
) {
  return db.get<{ marktpreis: string | null; coverage: string | null }>(
    `SELECT ${marktpreisSql()} AS marktpreis, coverage FROM minifig_price_cache
        WHERE fig_number = $1 AND condition = $2 AND currency_code = $3 AND estimated
          AND fetched_at > NOW() - make_interval(hours => $4)`,
    [figNumber, zustand, waehrung, ttlStunden],
  );
}

export function rememberEstimatedMinifigsPrice(
  db: DbInterface,
  figNumber: string,
  zustand: string,
  waehrung: string,
  preis: number,
  abdeckung: number,
) {
  return db.run(
    `INSERT INTO minifig_price_cache (fig_number, condition, currency_code, avg_price, qty_avg_price, estimated, coverage)
       VALUES ($1,$2,$3,$4,$4,TRUE,$5) ON CONFLICT (fig_number,condition,currency_code)
       DO UPDATE SET avg_price=$4, qty_avg_price=$4, fetched_at=NOW(), estimated=TRUE, coverage=$5`,
    [figNumber, zustand, waehrung, preis, abdeckung],
  );
}

export function rememberEstimatedMinifigsHistory(
  db: DbInterface,
  figNumber: string,
  zustand: string,
  waehrung: string,
  preis: number,
  abdeckung: number,
) {
  return db.run(
    `INSERT INTO minifig_price_history (fig_number, condition, currency_code, avg_price, qty_avg_price, estimated, coverage)
       VALUES ($1,$2,$3,$4,$4,TRUE,$5) ON CONFLICT DO NOTHING`,
    [figNumber, zustand, waehrung, preis, abdeckung],
  );
}
