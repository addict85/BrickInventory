/** Token families as areas under `account` read them: api_tokens belongs to the account. A
 * family is account plus created_at in milliseconds, as the value travels through JavaScript. */

/** Is the family (`account`, `seit`) still alive? A condition for WHERE. */
export function familyAlive(account: string, since: string): string {
  return `EXISTS (SELECT 1 FROM api_tokens t WHERE t.user_id = ${account}
  AND date_trunc('milliseconds', t.created_at) = ${since}::timestamptz)`;
}

/** Account and family of the token with hash `hash`; columns `uid`, `seit`. */
export function tokenFamilySql(hash: string): string {
  return `SELECT user_id AS uid, date_trunc('milliseconds', created_at) AS since FROM api_tokens WHERE token = ${hash}`;
}
