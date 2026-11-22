/**
 * SQL building blocks for money amounts in the display currency. They live in db/
 * because repositories of several finance queries use them and no
 * repository may import a service.
 */

/** The purchase price in the display currency `w` (SQL parameter), a foreign currency
 * at the rate of the purchase day or before (0077). Without a rate NULL: the price then
 * counts as "foreign currency, not included". */
export function purchasePriceIn(column: string, w: string): string {
  return `in_waehrung(${column}, currency, ${w}, COALESCE(day, (created_at AT TIME ZONE 'UTC')::date))`;
}

/** The three columns of every acquisition query of the valuation: price, foreign, converted. */
export function purchasePriceColumns(column: string, w: string): string {
  const k = purchasePriceIn(column, w);
  return `${k} AS ${column},
            (currency <> ${w} AND ${column} IS NOT NULL AND ${k} IS NULL) AS kaufpreis_fremd,
            CASE WHEN currency <> ${w} AND ${k} IS NULL THEN ${column} END AS kaufpreis_original,
            (currency <> ${w} AND ${k} IS NOT NULL) AS kaufpreis_umgerechnet`;
}

/** Quantity-weighted average over the rows in which `k` has a price. */
export const averageOver = (k: string) =>
  `SUM(${k} * quantity) FILTER (WHERE ${k} IS NOT NULL)::numeric / NULLIF(SUM(quantity) FILTER (WHERE ${k} IS NOT NULL), 0)`;

/** The market price of a price row (alias `t`), the same rule as marketPriceFrom()
 * in src/catalog/bricklinkPrices.ts: avg_price, otherwise qty_avg_price, 0 is no
 * price. NULL means "no price", so as a filter `… IS NOT NULL`. */
export function marketPriceSql(t = ''): string {
  const p = t ? `${t}.` : '';
  return `(CASE WHEN ${p}avg_price > 0 THEN ${p}avg_price WHEN ${p}qty_avg_price > 0 THEN ${p}qty_avg_price END)`;
}
