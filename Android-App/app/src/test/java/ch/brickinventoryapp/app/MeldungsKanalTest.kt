package ch.brickinventoryapp.app

import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.repository.FinanzenRepository
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.data.repository.TeileRepository
import ch.brickinventoryapp.data.repository.FigurenRepository
import ch.brickinventoryapp.sammlung.ui.viewmodel.GalerieViewModel
import ch.brickinventoryapp.teile.ui.viewmodel.TeileViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import javax.inject.Singleton
import ch.brickinventoryapp.testing.PfadServer
import ch.brickinventoryapp.testing.Quellen
import ch.brickinventoryapp.testing.TestDienste

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
 *
 * Das ist zugleich die Rechnung des ViewModel-Schnitts, sichtbar gemacht: Jedes
 * herausgelöste ViewModel bringt sonst einen weiteren Kanal mit.
 *
 * Teilschritt 3 und 4 laufen ausgeführt (Kanal, Reflexion, zwei ViewModels
 * gegen einen PfadServer ohne Netz); 1 und 2 sind Struktur über alle Dateien.
 *
 * Gegenproben (29.10.2026 gemessen: c, d, e; die übrigen früher, über das
 * Ersatz-Skript im Werkzeugordner):
 *   a) In CatalogViewModel wieder `private val _snackbar = MutableStateFlow<String?>(null)`
 *      eingesetzt → Teilschritt 1 rot.
 *   b) Den Weiterleitungsblock in CatalogGraph.kt wieder eingesetzt
 *      → Teilschritt 2 rot.
 *   c) In MeldungsKanal.zeige() einen zweiten, eigenen MutableStateFlow
 *      beschrieben → Teilschritt 3 rot, dazu „zwei Bereiche …“.
 *   d) `@Singleton` aus MeldungsKanal.kt entfernt → Teilschritt 3 rot. Das ist
 *      der stillste der vier Fälle: Ohne die Annotation bekäme jedes ViewModel
 *      seine eigene Instanz, und dann gäbe es wieder so viele Kanäle wie
 *      ViewModels — nur sähe man es nirgends im Quelltext.
 *   e) In AppMeldungen zeige() in einen eigenen MutableStateFlow →
 *      Teilschritt 4 rot und „zwei Bereiche melden in denselben Kanal“.
 * Die Warteschlange selbst prüft MeldungsWarteschlangeTest (core-data).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class MeldungsKanalTest {

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
        val kanal = MeldungsKanal()
        kanal.zeige("gespeichert")
        assertEquals("AppNavigation.kt sammelt die Nur-Lese-Sicht ein", "gespeichert", kanal.meldung.value)
        kanal.quittiere()
        assertEquals(null, kanal.meldung.value)
        assertTrue("Ohne @Singleton bekäme jedes ViewModel eine eigene Instanz — dann gibt es " +
            "wieder so viele Kanäle wie ViewModels, nur unsichtbar",
            kanal::class.java.isAnnotationPresent(Singleton::class.java))
    }

    @Test
    fun `alle ViewModels benutzen denselben Kanal`() {
        // Ein ViewModel, das Meldungen erzeugt, aber den Kanal nicht kennt,
        // hat entweder einen eigenen (Teilschritt 1 faengt das) oder gar keinen
        // Weg nach draussen. Beides ist ein Fehler.
        val schreiber = alleOhneKommentare().filter { (name, s) ->
            name.endsWith("ViewModel.kt") && Regex("""\bzeigeMeldung\(|\bmeldungen\.zeige\(""").containsMatchIn(s)
        }
        assert(schreiber.isNotEmpty()) { "Kein ViewModel schreibt Meldungen — Muster veraltet?" }
        // Die Bereichs-ViewModels bekommen ihn als Meldungen (Bereichshelfer.kt).
        val helfer = alleOhneKommentare().single { it.first == "Bereichshelfer.kt" }.second
        assert(helfer.contains("override fun zeige(text: String?) = kanal.zeige(text)")) {
            "Meldungen reicht nicht mehr in den Kanal der App weiter"
        }
        val ohneKanal = schreiber.filter { (_, s) ->
            !s.contains("MeldungsKanal") && !s.contains("meldungen: Meldungen")
        }.map { it.first }
        assert(ohneKanal.isEmpty()) {
            "Diese ViewModels melden, holen sich den Kanal aber nicht: " +
                ohneKanal.joinToString()
        }
    }

    /** Zwei Bereiche, ein Kanal: Was sie melden, steht dort, wo AppNavigation.kt liest. */
    @Test
    fun `zwei Bereiche melden in denselben Kanal`() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        val pfade = PfadServer()
        pfade.codes["/api/v1/sets/75192-1"] = 500
        pfade.codes["/api/v1/parts/3001/5/color"] = 500
        val t = TestDienste(pfade.imTakt(), io = Dispatchers.Main)
        try {
            val galerie = t.merke(GalerieViewModel(t.sitzung, t.filter(), t.hinweise, t.bestand, t.scrollMemory, SetsRepository(t.api, t.cache),
                FinanzenRepository(t.api, t.cache), SavedStateHandle()))
            galerie.deleteSet("75192-1")
            assertTrue("Meldung der Galerie", t.meldungen.meldung.value != null)
            t.meldungen.quittiere()
            val teile = t.merke(TeileViewModel(t.sitzung, t.filter(), t.hinweise, t.bestand, t.scrollMemory, TeileRepository(t.api, t.cache), FigurenRepository(t.api, t.cache), SavedStateHandle()))
            teile.setzeTeilFarbe("3001", 5, 11)
            assertTrue("Meldung der Teile", t.meldungen.meldung.value != null)
        } finally {
            t.aufraeumen()
            Dispatchers.resetMain()
            pfade.server.shutdown()
        }
    }
}
