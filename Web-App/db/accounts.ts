/** An account condition is only a placeholder: a value in the SQL text would be an injection
 * that no driver catches anymore. The type only admits these forms; the check also holds where
 * a value arrives without a type. */
export type Konten = `= $${number}` | `= ANY($${number})`;

const FORM = /^= (?:\$\d+|ANY\(\$\d+\))$/;

/** `column accounts`, e.g. `user_id = ANY($1)`; everything else throws. */
export function onAccounts(column: string, konten: Konten): string {
  if (!FORM.test(konten)) throw new Error(`Kontobedingung „${konten}“: erlaubt sind = $n und = ANY($n)`);
  return `${column} ${konten}`;
}
