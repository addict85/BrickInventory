/**
 * SQL-Bausteine für die BrickLink-Zuordnung (Migration 0037). Sie stehen in
 * db/, weil Repositories mehrerer Bereiche sie in ihre Abfragen einsetzen und
 * ein Repository keinen Dienst importieren darf.
 */
export type BlArt = 'part' | 'fig' | 'set';

/** LEFT JOIN auf die gemeinsame Zuordnung und die eigene des Kontos `konto`
 * (Migration 0094); ohne Konto bleibt die eigene leer. `art` und `konto` sind
 * Spaltennamen oder feste Werte, keine Parameter. */
export function blJoin(rbSpalte: string, art: BlArt, konto: string | null, alias = 'blz'): string {
  return `LEFT JOIN bl_mapping ${alias}
               ON ${alias}.type = '${art}' AND ${alias}.rb_id = ${rbSpalte}
             LEFT JOIN bl_mapping_custom ${alias}_e
               ON ${alias}_e.user_id = ${konto ?? 'NULL'} AND ${alias}_e.type = '${art}' AND ${alias}_e.rb_id = ${rbSpalte}`;
}

/** Die eigene Nummer des Kontos vor der gemeinsamen, sonst die Rebrickable-Nummer. */
export function blNummerSql(rbSpalte: string, alias = 'blz'): string {
  return `COALESCE(${alias}_e.bl_id, ${alias}.bl_id, ${rbSpalte})`;
}
