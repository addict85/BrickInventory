package ch.brickinventoryapp.app

import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.collection.ui.viewmodel.GalleryViewModel
import ch.brickinventoryapp.parts.ui.viewmodel.PartsViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import javax.inject.Singleton
import ch.brickinventoryapp.testing.testFinancesRepository
import ch.brickinventoryapp.testing.PfadServer
import ch.brickinventoryapp.testing.Quellen
import ch.brickinventoryapp.testing.testSetsRepository
import ch.brickinventoryapp.testing.testPartsRepository
import ch.brickinventoryapp.testing.TestDienste
import ch.brickinventoryapp.testing.text

/**
 * There is exactly ONE path to the snackbar.
 *
 * ── The error this rule prevents ─────────────────────────────────────────────
 * The snackbar has one place on the screen, it is collected in
 * ONE place (AppNavigation.kt). If a ViewModel creates its own flow,
 * it ends nowhere — unless someone builds a forwarding into EVERY place where
 * this ViewModel is used:
 *
 *     val katMeldung by katalog.snackbar.collectAsStateWithLifecycle()
 *     LaunchedEffect(katMeldung) {
 *         katMeldung?.let { vm.showSnackbar(it); katalog.snackbarGelesen() }
 *     }
 *
 * Exactly that stood TWICE in CatalogGraph.kt. And that is the dangerous part:
 * whoever adds a third destination and forgets the block gets no error.
 *
 * That is at the same time the bill for the ViewModel split, made visible: every
 * extracted ViewModel would otherwise bring another channel along.
 *
 * Sub-steps 3 and 4 run executed (channel, reflection, two ViewModels
 * against a PfadServer without network); 1 and 2 are structure across all files.
 *
 * Counter-checks (measured 29.10.2026: c, d, e; the others earlier, via the
 * stand-in script in the tools folder):
 *   a) in CatalogViewModel again `private val _snackbar = MutableStateFlow<String?>(null)`
 *      inserted → sub-step 1 red.
 *   b) the forwarding block in CatalogGraph.kt inserted again
 *      → sub-step 2 red.
 *   c) in MeldungsKanal.zeige() a second, own MutableStateFlow
 *      written → sub-step 3 red, plus “two areas …”.
 *   d) `@Singleton` removed from MeldungsKanal.kt → sub-step 3 red. That is
 *      the quietest of the four cases: without the annotation every ViewModel
 *      would get its own instance, and then there would again be as many channels as
 *      ViewModels — only one would see it nowhere in the source.
 *   e) in AppMessages zeige() into an own MutableStateFlow →
 *      sub-step 4 red and “two areas report into the same channel“.
 * The queue itself is checked by MessageQueueTest (core-data).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class MessageChannelTest {

    /** All Kotlin files of the app without comments. */
    private fun allWithoutComments(): List<Pair<String, String>> =
        Quellen.alle().map { it.name to Quellen.withoutComments(it.readText()) }

    @Test
    fun `only the message channel holds a snackbar flow`() {
        // A `MutableStateFlow<String?>` under a name that sounds like a message
        // is a second channel — no matter what it is called.
        val treffer = allWithoutComments().filter { (name, s) ->
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
    fun `nobody forwards messages from ViewModel to ViewModel`() {
        // The block that should no longer exist. Searched is the EFFECT
        // (a foreign flow is collected and handed to showSnackbar),
        // not the wording of back then.
        val treffer = allWithoutComments().filter { (name, s) ->
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
    fun `the channel is writable and readable from outside`() {
        // Without that no ViewModel can use it — and the first one that
        // tries builds its own again.
        val kanal = MeldungsKanal()
        kanal.zeige("gespeichert")
        assertEquals("AppNavigation.kt sammelt die Nur-Lese-Sicht ein", "gespeichert", kanal.text)
        kanal.acknowledge()
        assertEquals(null, kanal.text)
        assertTrue("Ohne @Singleton bekäme jedes ViewModel eine eigene Instanz — dann gibt es " +
            "wieder so viele Kanäle wie ViewModels, nur unsichtbar",
            kanal::class.java.isAnnotationPresent(Singleton::class.java))
    }

    @Test
    fun `all ViewModels use the same channel`() {
        // A ViewModel that produces messages but does not know the channel
        // has either its own (sub-step 1 catches that) or no
        // way out at all. Both are an error.
        val schreiber = allWithoutComments().filter { (name, s) ->
            name.endsWith("ViewModel.kt") && Regex("""\bzeigeMeldung\(|\bmeldungen\.zeige\(""").containsMatchIn(s)
        }
        assert(schreiber.isNotEmpty()) { "Kein ViewModel schreibt Meldungen — Muster veraltet?" }
        // The area ViewModels get it as Meldungen (Bereichshelfer.kt).
        val helper = allWithoutComments().single { it.first == "Bereichshelfer.kt" }.second
        assert(helper.contains("override fun zeige(text: String?) = kanal.zeige(text)")) {
            "Meldungen reicht nicht mehr in den Kanal der App weiter"
        }
        val withoutChannel = schreiber.filter { (_, s) ->
            !s.contains("MeldungsKanal") && !s.contains("meldungen: Meldungen")
        }.map { it.first }
        assert(withoutChannel.isEmpty()) {
            "Diese ViewModels melden, holen sich den Kanal aber nicht: " +
                withoutChannel.joinToString()
        }
    }

    /** Two areas, one channel: what they report stands where AppNavigation.kt reads. */
    @Test
    fun `two areas report into the same channel`() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        val paths = PfadServer()
        paths.codes["/api/v1/sets/75192-1"] = 500
        paths.codes["/api/v1/parts/3001/5/color"] = 500
        val t = TestDienste(paths.imTakt(), io = Dispatchers.Main)
        try {
            val galerie = t.merke(GalleryViewModel(t.sitzung, t.filter(), t.hinweise, t.changes, t.scrollMemory, testSetsRepository(t.api),
                t.kontosicht, testFinancesRepository(t.api), SavedStateHandle()))
            galerie.deleteSet("75192-1")
            assertTrue("Meldung der Galerie", t.meldungen.text != null)
            t.meldungen.acknowledge()
            val teile = t.merke(PartsViewModel(t.sitzung, t.filter(), t.hinweise, t.changes, t.scrollMemory, testPartsRepository(t.api), t.kontosicht, SavedStateHandle()))
            teile.setzeTeilFarbe("3001", 5, 11)
            assertTrue("Meldung der Teile", t.meldungen.text != null)
        } finally {
            t.aufraeumen()
            Dispatchers.resetMain()
            paths.server.shutdown()
        }
    }
}
