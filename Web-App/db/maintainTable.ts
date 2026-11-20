/**
 * Nach einem Masseneinfuegen: Planerstatistik und GIN-Wartelisten auffrischen.
 */

/** VACUUM kennt keine Parameter, der Name wird ins SQL eingesetzt — darum
 * geprüft, auch wenn heute jeder Aufrufer ihn aus dem eigenen Quelltext hat. */
const NAME_ALLOWED = /^[a-z_][a-z0-9_]*$/;

/** `runFrom` darf in keiner Transaktion laufen: VACUUM scheitert dort.
 * true, wenn die Pflege durchgelaufen ist. */
export async function maintainTable(runFrom: (sql: string) => Promise<unknown>, tabelle: string): Promise<boolean> {
  if (!NAME_ALLOWED.test(tabelle)) {
    console.error(`[pflege] "${tabelle}" ist kein einfacher Tabellenname — nichts getan.`);
    return false;
  }
  try {
    await runFrom(`VACUUM (ANALYZE) ${tabelle}`);
    return true;
  } catch (e) {
    console.warn(
      `[pflege] VACUUM (ANALYZE) ${tabelle} nicht moeglich (${(e as Error)?.message || e}) — ` +
        `die Suche auf dieser Tabelle ist bis zum naechsten automatischen Aufraeumen langsamer.`,
    );
    return false;
  }
}
