package ch.brickinventoryapp

import org.junit.Test

/**
 * Es gibt genau EINEN Weg zur Snackbar.
 *
 * ── Der Fehler, den diese Regel verhindert ──────────────────────────────────
 * Die Snackbar hat einen Platz auf dem Bildschirm, eingesammelt wird sie an
 * EINER Stelle (AppNavigation.kt). Legt ein ViewModel sich einen eigenen Fluss
 * an, endet der nirgends — es sei denn, jemand baut an JEDEM Ort, an dem
 * dieses ViewModel benutzt wird, eine Weiterleitung ein:
 *
 *     val katMeldung by katalog.snackbar.collectAsStateWithLifecycle()
 *     LaunchedEffect(katMeldung) {
 *         katMeldung?.let { vm.showSnackbar(it); katalog.snackbarGelesen() }
 *     }
 *
 * Genau das stand ZWEIMAL in CatalogGraph.kt. Und das ist der gefährliche Teil:
 * Wer ein drittes Ziel hinzufügt und den Block vergisst, bekommt keinen Fehler.
 * Nichts schlägt fehl, es passiert nur nichts — die Fehlermeldungen dieses
 * Bildschirms verschwinden lautlos. Ein Test, der das erst bemerkt, wenn er
 * nach dem Block sucht, kommt zu spät; deshalb prüft er hier die URSACHE: dass
 * es überhaupt nur einen Fluss gibt.
 *
 * Das ist zugleich die Rechnung des ViewModel-Schnitts, sichtbar gemacht: Jedes
 * herausgelöste ViewModel bringt sonst einen weiteren Kanal mit.
 *
 * Gegenproben (durchgeführt, über das Ersatz-Skript im Werkzeugordner):
 *   a) In CatalogViewModel wieder `private val _snackbar = MutableStateFlow<String?>(null)`
 *      eingesetzt → Teilschritt 1 rot.
 *   b) Den Weiterleitungsblock in CatalogGraph.kt wieder eingesetzt
 *      → Teilschritt 2 rot.
 *   c) In MeldungsKanal.kt den Fluss auf `private` gesetzt → Teilschritt 3 rot
 *      („der schreibbare Fluss fehlt oder ist nicht mehr oeffentlich").
 *   d) `@Singleton` aus MeldungsKanal.kt entfernt → Teilschritt 3 rot. Das ist
 *      der stillste der vier Fälle: Ohne die Annotation bekäme jedes ViewModel
 *      seine eigene Instanz, und dann gäbe es wieder so viele Kanäle wie
 *      ViewModels — nur sähe man es nirgends im Quelltext.
 */
class MeldungsKanalTest {

    private fun quelle(rel: String) =
        java.io.File("src/main/java/ch/brickinventoryapp/$rel").readText()

    /** Alle Kotlin-Dateien der App ohne Kommentare. */
    private fun alleOhneKommentare(): List<Pair<String, String>> =
        Quellen.alle().map { it.name to Quellen.ohneKommentare(it.readText()) }

    @Test
    fun `nur der Meldungskanal haelt einen Snackbar-Fluss`() {
        // Ein `MutableStateFlow<String?>` unter einem Namen, der nach Meldung
        // klingt, ist ein zweiter Kanal — egal wie er heisst.
        val treffer = alleOhneKommentare().filter { (name, s) ->
            name != "MeldungsKanal.kt" &&
                Regex("""val\s+_?\w*(snack|meldung)\w*\s*(:[^=]+)?=\s*MutableStateFlow<String\?>""",
                      RegexOption.IGNORE_CASE).containsMatchIn(s)
        }.map { it.first }

        assert(treffer.isEmpty()) {
            "Diese Dateien legen einen eigenen Snackbar-Fluss an: ${treffer.joinToString()}.\n" +
                "Eingesammelt wird nur der aus data/MeldungsKanal.kt — alles andere " +
                "endet nirgends, solange niemand es von Hand weiterleitet."
        }
    }

    @Test
    fun `niemand leitet Meldungen von ViewModel zu ViewModel weiter`() {
        // Der Block, den es nicht mehr geben soll. Gesucht wird die WIRKUNG
        // (ein fremder Fluss wird eingesammelt und an showSnackbar gereicht),
        // nicht der Wortlaut von damals.
        val treffer = alleOhneKommentare().filter { (name, s) ->
            name != "AppNavigation.kt" &&
                Regex("""\w+\.snackbar\.collectAsState""").containsMatchIn(s)
        }.map { it.first }

        assert(treffer.isEmpty()) {
            "Diese Dateien sammeln einen Snackbar-Fluss ein, obwohl das " +
                "AppNavigation.kt tut: ${treffer.joinToString()}.\n" +
                "Eine zweite Sammelstelle heisst: Ob eine Meldung ankommt, haengt " +
                "davon ab, welcher Bildschirm gerade offen ist."
        }
    }

    @Test
    fun `der Kanal ist von aussen beschreibbar und lesbar`() {
        // Ohne das kann kein ViewModel ihn benutzen — und der erste, der es
        // versucht, baut sich wieder einen eigenen.
        val s = Quellen.ohneKommentare(quelle("data/MeldungsKanal.kt"))
        assert(Regex("""\n\s*val fluss = MutableStateFlow<String\?>\(null\)""").containsMatchIn(s)) {
            "Der schreibbare Fluss fehlt oder ist nicht mehr oeffentlich — " +
                "die ViewModels halten ihn unter dem Namen `_snackbar`."
        }
        assert(s.contains("val meldung: StateFlow<String?>")) {
            "Die Nur-Lese-Sicht fehlt — AppNavigation.kt sammelt sie ein."
        }
        assert(s.contains("@Singleton")) {
            "Ohne @Singleton bekaeme jedes ViewModel eine eigene Instanz — " +
                "dann gibt es wieder so viele Kanaele wie ViewModels, nur unsichtbar."
        }
    }

    @Test
    fun `alle ViewModels benutzen denselben Kanal`() {
        // Ein ViewModel, das Meldungen erzeugt, aber den Kanal nicht kennt,
        // hat entweder einen eigenen (Teilschritt 1 faengt das) oder gar keinen
        // Weg nach draussen. Beides ist ein Fehler.
        val schreiber = alleOhneKommentare().filter { (name, s) ->
            name.endsWith("ViewModel.kt") && Regex("""_snackbar\s*\.value\s*=""").containsMatchIn(s)
        }
        assert(schreiber.isNotEmpty()) { "Kein ViewModel schreibt Meldungen — Muster veraltet?" }
        val ohneKanal = schreiber.filter { (_, s) -> !s.contains("MeldungsKanal") }.map { it.first }
        assert(ohneKanal.isEmpty()) {
            "Diese ViewModels melden, holen sich den Kanal aber nicht: " +
                ohneKanal.joinToString()
        }
    }
}
