/**
 * SQL-Bausteine für die BrickLink-Zuordnung (Migration 0037). Sie stehen in
 * db/, weil Repositories mehrerer Bereiche sie in ihre Abfragen einsetzen und
 * ein Repository keinen Dienst importieren darf.
 */
export type BlArt = 'part' | 'fig' | 'set';

/** LEFT JOIN auf die Zuordnung einer Rebrickable-Spalte; `art` ist ein fester Wert, kein Parameter. */
export function blJoin(rbSpalte: string, art: BlArt, alias = 'blz'): string {
  return `LEFT JOIN bl_zuordnung ${alias}
               ON ${alias}.art = '${art}' AND ${alias}.rb_id = ${rbSpalte}`;
}

/** Die BrickLink-Nummer, oder die Rebrickable-Nummer, wo beide gleich sind (bl_id NULL). */
export function blNummerSql(rbSpalte: string, alias = 'blz'): string {
  return `COALESCE(${alias}.bl_id, ${rbSpalte})`;
}
