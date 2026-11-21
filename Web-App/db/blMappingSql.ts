/**
 * SQL building blocks for the BrickLink mapping (migration 0037). They live in
 * db/ because repositories of several areas embed them in their queries and
 * a repository must not import a service.
 */
export type BlArt = 'part' | 'fig' | 'set';

/** LEFT JOIN on the shared mapping and the account's own for `konto`
 * (migration 0094); without an account the own one stays empty. `art` and `konto` are
 * column names or fixed values, not parameters. */
export function blJoin(rbSpalte: string, art: BlArt, konto: string | null, alias = 'blz'): string {
  return `LEFT JOIN bl_mapping ${alias}
               ON ${alias}.type = '${art}' AND ${alias}.rb_id = ${rbSpalte}
             LEFT JOIN bl_mapping_custom ${alias}_e
               ON ${alias}_e.user_id = ${konto ?? 'NULL'} AND ${alias}_e.type = '${art}' AND ${alias}_e.rb_id = ${rbSpalte}`;
}

/** The account's own number before the shared one, otherwise the Rebrickable number. */
export function blNummerSql(rbSpalte: string, alias = 'blz'): string {
  return `COALESCE(${alias}_e.bl_id, ${alias}.bl_id, ${rbSpalte})`;
}
