/**
 * SQL-Bausteine für Geldbeträge in der Anzeigewährung. Sie stehen in db/,
 * weil Repositories mehrerer Finanz-Abfragen sie einsetzen und kein
 * Repository einen Dienst importieren darf.
 */

/**
 * Der Kaufpreis in der Anzeigewährung `w` (ein SQL-Parameter): gleiche Währung
 * unverändert, eine fremde zum Kurs des Kauftags (Migration 0077, sonst der
 * nächstfrühere). NULL, wenn kein Kurs da ist — dann zählt der Preis als
 * „fremde Währung, nicht eingerechnet“ wie vor den Kursen.
 */
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
