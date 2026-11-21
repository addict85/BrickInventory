/** The household as areas under `haushalt` read it: account_links belongs to the household;
 * the shape of the tree lives only here, not again in every reader. */

/** The account `konto` and all sub-accounts below it, downwards only: going up through a shared
 * sub-account would otherwise reach foreign main accounts. Column `id`. */
export function householdDown(konto: string): string {
  return `WITH RECURSIVE baum(id) AS (
      SELECT ${konto}::int
      UNION
      SELECT l.sub_user_id FROM account_links l JOIN baum b ON l.main_user_id = b.id)
    SELECT id FROM baum`;
}

/** Sub-accounts from `ids` that also hang on a main account outside; columns `id`, `haupt`. */
export function auchFremdGeteilt(ids: string): string {
  return `SELECT l.sub_user_id AS id, l.main_user_id AS haupt FROM account_links l
     WHERE l.sub_user_id = ANY(${ids}::int[]) AND NOT l.main_user_id = ANY(${ids}::int[])`;
}

/** One row if `konto` has a main account. */
export function isSubAccount(konto: string): string {
  return `SELECT 1 FROM account_links WHERE sub_user_id = ${konto} LIMIT 1`;
}
