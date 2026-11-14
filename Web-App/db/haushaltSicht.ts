/** Der Haushalt, wie ihn Bereiche unter `haushalt` lesen: account_links gehört dem Haushalt,
 * die Form des Baums steht nur hier, nicht in jedem Leser neu. */

/** Das Konto `konto` und alle Unterkonten darunter, nur abwärts: Über ein geteiltes
 * Unterkonto hinauf erreichte man sonst fremde Hauptkonten. Spalte `id`. */
export function haushaltAbwaerts(konto: string): string {
  return `WITH RECURSIVE baum(id) AS (
      SELECT ${konto}::int
      UNION
      SELECT l.sub_user_id FROM account_links l JOIN baum b ON l.main_user_id = b.id)
    SELECT id FROM baum`;
}

/** Unterkonten aus `ids`, die auch an einem Hauptkonto ausserhalb hängen; Spalten `id`, `haupt`. */
export function auchFremdGeteilt(ids: string): string {
  return `SELECT l.sub_user_id AS id, l.main_user_id AS haupt FROM account_links l
     WHERE l.sub_user_id = ANY(${ids}::int[]) AND NOT l.main_user_id = ANY(${ids}::int[])`;
}

/** Eine Zeile, wenn `konto` ein Hauptkonto hat. */
export function istUnterkonto(konto: string): string {
  return `SELECT 1 FROM account_links WHERE sub_user_id = ${konto} LIMIT 1`;
}
