/** Token-Familien, wie Bereiche unter `konto` sie lesen: api_tokens gehört dem Konto. Eine
 * Familie ist Konto und created_at auf Millisekunden, so wie der Wert über JavaScript reist. */

/** Lebt die Familie (`konto`, `seit`) noch? Eine Bedingung für WHERE. */
export function familieLebt(konto: string, seit: string): string {
  return `EXISTS (SELECT 1 FROM api_tokens t WHERE t.user_id = ${konto}
  AND date_trunc('milliseconds', t.created_at) = ${seit}::timestamptz)`;
}

/** Konto und Familie des Tokens mit dem Hash `hash`; Spalten `uid`, `seit`. */
export function tokenFamilieSql(hash: string): string {
  return `SELECT user_id AS uid, date_trunc('milliseconds', created_at) AS seit FROM api_tokens WHERE token = ${hash}`;
}
