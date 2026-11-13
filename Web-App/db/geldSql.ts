/**
 * SQL-Bausteine für Geldbeträge in der Anzeigewährung. Sie stehen in db/,
 * weil Repositories mehrerer Finanz-Abfragen sie einsetzen und kein
 * Repository einen Dienst importieren darf.
 */

/** Der Kaufpreis in der Anzeigewährung `w` (SQL-Parameter), fremde Währung
 * zum Kurs des Kauftags oder davor (0077). Ohne Kurs NULL: Der Preis zählt
 * dann als „fremde Währung, nicht eingerechnet“. */
export function kaufpreisIn(spalte: string, w: string): string {
  return `in_waehrung(${spalte}, currency, ${w}, COALESCE(tag, (created_at AT TIME ZONE 'UTC')::date))`;
}

/** Die drei Spalten jeder Erfassungsabfrage der Bewertung: Preis, fremd, umgerechnet. */
export function kaufpreisSpalten(spalte: string, w: string): string {
  const k = kaufpreisIn(spalte, w);
  return `${k} AS ${spalte},
            (currency <> ${w} AND ${spalte} IS NOT NULL AND ${k} IS NULL) AS kaufpreis_fremd,
            CASE WHEN currency <> ${w} AND ${k} IS NULL THEN ${spalte} END AS kaufpreis_original,
            (currency <> ${w} AND ${k} IS NOT NULL) AS kaufpreis_umgerechnet`;
}

/** Mengengewichteter Schnitt über die Zeilen, in denen `k` einen Preis hat. */
export const mittelUeber = (k: string) =>
  `SUM(${k} * quantity) FILTER (WHERE ${k} IS NOT NULL)::numeric / NULLIF(SUM(quantity) FILTER (WHERE ${k} IS NOT NULL), 0)`;

/** Der Marktpreis einer Preiszeile (Alias `t`), dieselbe Regel wie marktpreisAus()
 * in src/katalog/bricklinkPreise.ts: avg_price, sonst qty_avg_price, 0 ist kein
 * Preis. NULL heisst „kein Preis“, als Filter also `… IS NOT NULL`. */
export function marktpreisSql(t = ''): string {
  const p = t ? `${t}.` : '';
  return `(CASE WHEN ${p}avg_price > 0 THEN ${p}avg_price WHEN ${p}qty_avg_price > 0 THEN ${p}qty_avg_price END)`;
}
