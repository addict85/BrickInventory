/**
 * Nach einem Masseneinfuegen: Planerstatistik und GIN-Wartelisten auffrischen.
 * Ausführlich: docs/begruendungen/utils/tabellePflegen.ts.md#abschnitt
 */

/**
 * Nur das, was ein Tabellenname sein darf. Der Name wird in SQL EINGESETZT
 * (VACUUM kennt keine Parameter), also wird er hier geprueft und nicht
 * geglaubt. Heute kommen alle Aufrufer aus dem eigenen Quelltext — der Riegel
 * steht fuer den naechsten, der einen Namen von weiter aussen hereingibt.
 */
const NAME_ERLAUBT = /^[a-z_][a-z0-9_]*$/;

/**
 * @param fuehreAus Fuehrt eine SQL-Anweisung aus. KEINE Transaktion offen —
 *        VACUUM ist in einer Transaktion nicht erlaubt und scheitert dort mit
 *        „VACUUM cannot run inside a transaction block".
 * @param tabelle Name der Tabelle, ohne Schema.
 * @returns true, wenn die Pflege durchgelaufen ist.
 */
export async function pflegeTabelle(
  fuehreAus: (sql: string) => Promise<unknown>,
  tabelle: string,
): Promise<boolean> {
  if (!NAME_ERLAUBT.test(tabelle)) {
    console.error(`[pflege] "${tabelle}" ist kein einfacher Tabellenname — nichts getan.`);
    return false;
  }
  try {
    await fuehreAus(`VACUUM (ANALYZE) ${tabelle}`);
    return true;
  } catch (e: any) {
    console.warn(`[pflege] VACUUM (ANALYZE) ${tabelle} nicht moeglich (${e?.message || e}) — ` +
      `die Suche auf dieser Tabelle ist bis zum naechsten automatischen Aufraeumen langsamer.`);
    return false;
  }
}
