/**
 * Nach einem Masseneinfuegen: Planerstatistik und GIN-Wartelisten auffrischen.
 *
 * ── Zwei verschiedene Probleme, und das war mir zuerst nicht klar ───────────
 *
 * GEMESSEN an 72 000 Zeilen in parts_summary, mit den Trigramm-Indizes aus
 * Migration 0029, Suche nach einem seltenen Begriff:
 *
 *   direkt nach dem Masseneinfuegen        94,1 / 100,2 ms
 *   nach ANALYZE                            4,8 /  10,3 ms
 *   nach VACUUM (Statistik war schon da)     0,2 /   0,8 ms
 *
 * Die beiden Schritte heilen UNTERSCHIEDLICHE Fehler, und keiner ersetzt den
 * anderen:
 *
 *  - ANALYZE richtet die PLANWAHL. Ohne frische Statistik schaetzt der Planer
 *    die Tabelle auf eine Zeile und greift zu einem beliebigen anderen Index —
 *    gemessen `idx_parts_summary_cat`, der dann alle 72 000 Zeilen durchgeht.
 *    Das sind die 94 ms, und es ist der schlimmere der beiden Faelle, weil er
 *    wie ein fehlender Index aussieht, obwohl der Index da ist.
 *  - VACUUM leert die WARTELISTE von GIN (`fastupdate`, Vorgabe an). Neue
 *    Eintraege landen dort als unsortierte Liste; jede Suche muss sie
 *    zusaetzlich durchgehen. Das sind die restlichen 10x.
 *
 * Eine frueher in dieser Reihe notierte Messung („VACUUM ANALYZE -> 0,86 ms")
 * war richtig, aber zu grob: Sie hat nicht getrennt, wer was bewirkt. Damit
 * waere die naheliegende Vereinfachung — nur ANALYZE, das darf in einer
 * Transaktion laufen — als gleichwertig durchgegangen. Ist sie nicht.
 *
 * ── Was es kostet ──────────────────────────────────────────────────────────
 *
 * Ebenfalls gemessen, dieselbe Tabelle: `VACUUM (ANALYZE)` 250 / 238 ms,
 * `ANALYZE` allein 239 / 204 ms. Das VACUUM kostet also praktisch nichts
 * obendrauf — die Zeit geht in die Stichproben von ANALYZE. Deshalb beides.
 *
 * ── Warum die Ausfuehrung hereingegeben wird ────────────────────────────────
 *
 * jobs/csvImportWorker.ts laeuft in einem EIGENEN Prozess mit eigenem Pool und
 * importiert db/database.ts ausdruecklich nicht (siehe dessen Dateikopf).
 * Dieser Helfer kann das Modul also nicht benutzen. Er bekommt stattdessen eine
 * Funktion, die SQL ausfuehrt — damit ist er aus beiden Welten aufrufbar und
 * haengt an keiner.
 *
 * ── Warum es nie wirft ─────────────────────────────────────────────────────
 *
 * VACUUM braucht Rechte am Objekt. Bei einem gehosteten Postgres kann die
 * Rolle der App die nicht haben. Ein Import, der an der NACHSORGE scheitert,
 * waere das falsche Ergebnis: Die Daten sind dann vollstaendig da, nur die
 * Suche ist eine Weile langsamer. Dieselbe Entscheidung wie bei pg_trgm in
 * initSchema() und in Migration 0029 — eine Warnung, kein Abbruch.
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
