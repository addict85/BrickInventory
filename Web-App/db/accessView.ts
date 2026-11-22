/** Token families as areas under `konto` read them: api_tokens belongs to the account. A
 * family is account plus created_at in milliseconds, as the value travels through JavaScript. */

/** Is the family (`konto`, `seit`) still alive? A condition for WHERE. */
export function familieLebt(konto: string, seit: string): string {
  return `EXISTS (SELECT 1 FROM api_tokens t WHERE t.user_id = ${konto}
  AND date_trunc('milliseconds', t.created_at) = ${seit}::timestamptz)`;
}

/** Account and family of the token with hash `hash`; columns `uid`, `seit`. */
export function tokenFamilySql(hash: string): string {
  return `SELECT user_id AS uid, date_trunc('milliseconds', created_at) AS seit FROM api_tokens WHERE token = ${hash}`;
}
