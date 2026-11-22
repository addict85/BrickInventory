/**
 * After a bulk insert: refresh planner statistics and GIN pending lists.
 */

/** VACUUM takes no parameters, the name is inserted into the SQL — hence
 * checked, even though today every caller has it from its own source. */
const NAME_ALLOWED = /^[a-z_][a-z0-9_]*$/;

/** `runFrom` must not run inside a transaction: VACUUM fails there.
 * true if the maintenance completed. */
export async function maintainTable(runFrom: (sql: string) => Promise<unknown>, table: string): Promise<boolean> {
  if (!NAME_ALLOWED.test(table)) {
    console.error(`[pflege] "${table}" ist kein einfacher Tabellenname — nichts getan.`);
    return false;
  }
  try {
    await runFrom(`VACUUM (ANALYZE) ${table}`);
    return true;
  } catch (e) {
    console.warn(
      `[pflege] VACUUM (ANALYZE) ${table} nicht moeglich (${(e as Error)?.message || e}) — ` +
        `die Suche auf dieser Tabelle ist bis zum naechsten automatischen Aufraeumen langsamer.`,
    );
    return false;
  }
}
