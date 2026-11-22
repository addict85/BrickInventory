/** An account condition is only a placeholder: a value in the SQL text would be an injection
 * that no driver catches anymore. The type only admits these forms; the check also holds where
 * a value arrives without a type. */
export type AccountFilter = `= $${number}` | `= ANY($${number})`;

const FORM = /^= (?:\$\d+|ANY\(\$\d+\))$/;

/** `column accounts`, e.g. `user_id = ANY($1)`; everything else throws. */
export function onAccounts(column: string, accounts: AccountFilter): string {
  if (!FORM.test(accounts)) throw new Error(`Kontobedingung „${accounts}“: erlaubt sind = $n und = ANY($n)`);
  return `${column} ${accounts}`;
}
