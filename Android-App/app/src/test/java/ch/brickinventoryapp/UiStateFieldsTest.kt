package ch.brickinventoryapp

import org.junit.Test

/**
 * Ersatz für den Compiler: Verweist irgendwo Code auf ein Zustandsfeld, das es
 * nicht (mehr) gibt?
 *
 * ── Woher dieser Test kommt ─────────────────────────────────────────────────
 * Beim Umbau des Katalogs auf das Fensterladen (Nachtrag 86) ist
 * `CatalogUiState.sets` entfallen — ersetzt durch `loadedPages` und `total`.
 * Eine Stelle blieb zurück: `CatalogGraph.kt` prüfte weiter `catalogState.sets`
 * und liess sich nicht mehr übersetzen. Marco hat den Übersetzungsfehler
 * gemeldet, nicht ich.
 *
 * Kotlin lässt sich in der Prüfumgebung nicht übersetzen; die üblichen
 * Behelfe (Klammerbilanz, Textsuche) finden so etwas nicht. Dieser Test tut
 * genau das, was der Compiler hier täte: Er sammelt die Felder JEDER
 * `…UiState`-Datenklasse ein und prüft jeden Zugriff der Form `xyzState.feld`
 * dagegen.
 *
 * ── Warum das mehr ist als eine Textsuche ───────────────────────────────────
 * Der Typ hinter einem Namen wird je Datei bestimmt: In CatalogScreen heisst
 * der Parameter schlicht `state`, ist aber ein `CatalogUiState`. Ein Test, der
 * `state` überall für den App-Zustand hielte, meldete dort vierzig Fehlalarme
 * — und man gewöhnte sich an, ihn zu übergehen.
 */
class UiStateFieldsTest {

    private val wurzel = java.io.File("src/main/java/ch/brickinventoryapp")

    // Kommentare über Quellen.ohneKommentare(): Das frühere Muster hier lief
    // über die GANZE Datei und ist in dieser Reihe schon zweimal in Kotlins
    // verschachtelte Blockkommentare gelaufen (Nachtrag 39b). Siehe Quellen.kt.
    private fun ohneKommentare(s: String) = Quellen.ohneKommentare(s)

    /**
     * Welcher öffentliche Fluss des ViewModels trägt welchen Zustandstyp?
     *
     * Gelesen aus den Feldern `_xyzState = MutableStateFlow(XyzUiState())` in
     * MainViewModel.kt — der öffentliche Name ist derselbe ohne Unterstrich.
     * Bewusst abgeleitet statt hier aufgezählt: Eine Liste im Test wäre eine
     * zweite Wahrheit, die beim nächsten neuen Zustand still veraltet.
     */
    private fun fluesse(): Map<String, String> {
        val quelle = java.io.File(wurzel, "ui/MainViewModel.kt").readText()
        return Regex("""_(\w+)\s*=\s*MutableStateFlow\((\w+UiState)\(""")
            .findAll(quelle)
            .associate { it.groupValues[1] to it.groupValues[2] }
    }

    /** Feldnamen je Zustands-Datenklasse. */
    private fun felderJeKlasse(): Map<String, Set<String>> {
        val quelle = java.io.File(wurzel, "ui/UiState.kt").readText()
        return Regex("""data class (\w+UiState)\((.*?)\n\)""", RegexOption.DOT_MATCHES_ALL)
            .findAll(quelle)
            .associate { m ->
                m.groupValues[1] to Regex("""val\s+(\w+)\s*:""")
                    .findAll(m.groupValues[2]).map { it.groupValues[1] }.toSet()
            }
    }

    @Test
    fun `kein Zugriff auf ein Feld, das es nicht gibt`() {
        val klassen = felderJeKlasse()
        val fluesse = fluesse()
        assert(klassen.size >= 4) { "Zu wenige Zustandsklassen gefunden — Muster veraltet?" }
        assert(fluesse.isNotEmpty()) { "Keine Zustandsflüsse in MainViewModel.kt gefunden — Muster veraltet?" }

        // Namen, die überall dasselbe bedeuten.
        val fest = mapOf(
            "catalogState" to "CatalogUiState",
            "partsState" to "PartsUiState",
            "setDetailState" to "SetDetailUiState",
            "manDetailState" to "ManualItemDetailUiState",
            "detailState" to "SetDetailUiState",
        )
        // Auf Flows und Datenklassen selbst aufgerufene Standardmethoden.
        val egal = setOf("copy", "value", "update", "collect", "first",
                         "collectAsStateWithLifecycle")

        val fehler = mutableListOf<String>()
        // Untergrenze (Nachtrag 118): ein leerer Dateilauf lässt jede
        // Sammelprüfung darunter stillschweigend bestehen.
        check(wurzel.walkTopDown().count { it.extension == "kt" } >= 20) {
            "Zu wenige Kotlin-Dateien unter ${'$'}{wurzel.path} — Pfad veraltet?"
        }
        wurzel.walkTopDown().filter { it.extension == "kt" }.forEach { datei ->
            val s = ohneKommentare(datei.readText())
            // Je Datei: Welcher Name trägt welchen Zustandstyp? Parameter der
            // Form `name: XxxUiState` gewinnen über die feste Zuordnung.
            val lokal = fest.toMutableMap()
            Regex("""\b(\w+)\s*:\s*(?:[\w.]*\.)?(\w+UiState)\b""").findAll(s).forEach {
                lokal[it.groupValues[1]] = it.groupValues[2]
            }
            // Bildschirme, die ihren Zustand SELBST beim ViewModel abholen
            // (Nachtrag 96/115), haben keinen Parameter mehr, an dem der Typ
            // ablesbar wäre — die Angabe steht in der Zeile
            //   val katalog by vm.catalogState.collectAsStateWithLifecycle()
            // Welcher Fluss welchen Zustand trägt, verrät MainViewModel.kt
            // selbst; die Zuordnung wird deshalb dort gelesen und nicht hier
            // gepflegt. Ohne das hielte der Test `state` in CatalogScreen
            // wieder für den App-Zustand und meldete vierzig Fehlalarme —
            // genau das, wogegen der Kommentar oben schon einmal geschrieben
            // wurde.
            Regex("""\bval\s+(\w+)\s+by\s+vm\.(\w+)\.collectAsStateWithLifecycle""")
                .findAll(s).forEach { m ->
                    fluesse[m.groupValues[2]]?.let { lokal[m.groupValues[1]] = it }
                }
            // Seit es Bildschirm-ViewModels gibt, heisst der Fluss in beiden
            // schlicht `state`: `vm.state` ist der App-Zustand, `katalog.state`
            // der Katalogzustand. Der Name sagt es nicht mehr, der EMPFÄNGER
            // sagt es — sonst hielte die Prüfung `state` in CatalogScreen für
            // den App-Zustand und meldete zehn Fehlalarme. Genau die Falle, vor
            // der der Kommentar darüber schon einmal gewarnt hat.
            val vms = Quellen.viewModelNamen(s)
            val jeVm = Quellen.fluesseJeViewModel()
            Regex("""\bval\s+(\w+)\s+by\s+(\w+)\.(\w+)\.collectAsStateWithLifecycle""")
                .findAll(s).forEach { m ->
                    val klasse = vms[m.groupValues[2]] ?: return@forEach
                    jeVm[klasse]?.get(m.groupValues[3])?.let { lokal[m.groupValues[1]] = it }
                }
            lokal.putIfAbsent("state", "AppUiState")

            for ((name, kls) in lokal) {
                val felder = klassen[kls] ?: continue
                Regex("""\b$name\.(\w+)""").findAll(s).forEach { m ->
                    val feld = m.groupValues[1]
                    if (feld !in egal && feld !in felder) {
                        val zeile = s.substring(0, m.range.first).count { c -> c == '\n' } + 1
                        fehler += "${datei.name}:$zeile  $name.$feld gibt es in $kls nicht"
                    }
                }
            }
        }
        assert(fehler.isEmpty()) {
            "Zugriffe auf entfernte Zustandsfelder:\n" + fehler.distinct().joinToString("\n")
        }
    }

    @Test
    fun `kein update-Block schreibt in ein Feld, das es nicht gibt`() {
        // ── Marcos zweiter Übersetzungsfehler ───────────────────────────────
        // `CatalogFeature.kt:226 No parameter with name 'sets' found.`
        //
        // Die erste Fassung dieses Tests fand ihn NICHT: Der Zugriff steckte in
        // `_catalogState.update { st -> st.copy(sets = …) }`, und der Name `st`
        // war nirgends als Zustandstyp deklariert. Ein Muster über die ganze
        // Datei half auch nicht — dasselbe `st` bedeutet in einer anderen
        // Zeile derselben Datei einen anderen Zustand.
        //
        // Deshalb wird jeder update-Block EINZELN betrachtet: Der Lambda-Name
        // gilt nur innerhalb seiner geschweiften Klammern. Geprüft werden
        // beide Formen, die der Compiler bemängelt hätte — der Lesezugriff
        // `st.feld` und das benannte Argument `st.copy(feld = …)`.
        val klassen = felderJeKlasse()
        val flows = mapOf(
            "_catalogState" to "CatalogUiState",
            "_state" to "AppUiState",
            "_partsState" to "PartsUiState",
            "_setDetailState" to "SetDetailUiState",
            "_manDetailState" to "ManualItemDetailUiState",
        )
        val fehler = mutableListOf<String>()
        // Untergrenze (Nachtrag 118): ein leerer Dateilauf lässt jede
        // Sammelprüfung darunter stillschweigend bestehen.
        check(wurzel.walkTopDown().count { it.extension == "kt" } >= 20) {
            "Zu wenige Kotlin-Dateien unter ${'$'}{wurzel.path} — Pfad veraltet?"
        }
        wurzel.walkTopDown().filter { it.extension == "kt" }.forEach { datei ->
            val s = ohneKommentare(datei.readText())
            Regex("""\b(_\w+State)\.update\s*\{\s*(\w+)\s*->""").findAll(s).forEach { m ->
                val felder = klassen[flows[m.groupValues[1]]] ?: return@forEach
                val name = m.groupValues[2]
                // Ende des Blocks über die Klammerbilanz — ein festes Fenster
                // reichte in den nächsten Block hinein.
                var tiefe = 1; var k = m.range.last + 1
                while (k < s.length && tiefe > 0) {
                    if (s[k] == '{') tiefe++ else if (s[k] == '}') tiefe--
                    k++
                }
                val block = s.substring(m.range.last + 1, maxOf(m.range.last + 1, k - 1))

                Regex("""\b$name\.(\w+)""").findAll(block).forEach { a ->
                    val feld = a.groupValues[1]
                    if (feld != "copy" && feld !in felder)
                        fehler += "${datei.name}: $name.$feld gibt es in ${flows[m.groupValues[1]]} nicht"
                }
                Regex("""\b$name\.copy\(""").findAll(block).forEach { c ->
                    var t = 1; var j = c.range.last + 1
                    while (j < block.length && t > 0) {
                        if (block[j] == '(') t++ else if (block[j] == ')') t--
                        j++
                    }
                    val args = block.substring(c.range.last + 1, maxOf(c.range.last + 1, j - 1))
                    // Nur die OBERSTE Ebene: verschachtelte copy() gehören
                    // anderen Typen (etwa einer Set-Kachel in der Liste).
                    var ebene = 0
                    val oben = buildString {
                        for (ch in args) {
                            if (ch == '(' || ch == '[' || ch == '{') ebene++
                            else if (ch == ')' || ch == ']' || ch == '}') ebene--
                            append(if (ebene == 0) ch else ' ')
                        }
                    }
                    Regex("""(?:^|,)\s*(\w+)\s*=""").findAll(oben).forEach { a ->
                        if (a.groupValues[1] !in felder)
                            fehler += "${datei.name}: copy(${a.groupValues[1]} = …) gibt es in ${flows[m.groupValues[1]]} nicht"
                    }
                }
            }
        }
        assert(fehler.isEmpty()) {
            "Schreibzugriffe auf entfernte Zustandsfelder:\n" + fehler.distinct().joinToString("\n")
        }
    }
}
