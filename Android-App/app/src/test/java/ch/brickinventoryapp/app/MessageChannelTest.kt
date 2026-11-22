package ch.brickinventoryapp.app

import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.data.MessageChannel
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
import ch.brickinventoryapp.testing.PathServer
import ch.brickinventoryapp.testing.Sources
import ch.brickinventoryapp.testing.testSetsRepository
import ch.brickinventoryapp.testing.testPartsRepository
import ch.brickinventoryapp.testing.TestServices
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
 * against a PathServer without network); 1 and 2 are structure across all files.
 *
 * Counter-checks (measured 29.10.2026: c, d, e; the others earlier, via the
 * stand-in script in the tools folder):
 *   a) in CatalogViewModel again `private val _snackbar = MutableStateFlow<String?>(null)`
 *      inserted → sub-step 1 red.
 *   b) the forwarding block in CatalogGraph.kt inserted again
 *      → sub-step 2 red.
 *   c) in MessageChannel.show() a second, own MutableStateFlow
 *      written → sub-step 3 red, plus “two areas …”.
 *   d) `@Singleton` removed from MessageChannel.kt → sub-step 3 red. That is
 *      the quietest of the four cases: without the annotation every ViewModel
 *      would get its own instance, and then there would again be as many channels as
 *      ViewModels — only one would see it nowhere in the source.
 *   e) in AppMessages show() into an own MutableStateFlow →
 *      sub-step 4 red and “two areas report into the same channel“.
 * The queue itself is checked by MessageQueueTest (core-data).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class MessageChannelTest {

    /** All Kotlin files of the app without comments. */
    private fun allWithoutComments(): List<Pair<String, String>> =
        Sources.all().map { it.name to Sources.withoutComments(it.readText()) }

    @Test
    fun `only the message channel holds a snackbar flow`() {
        // A `MutableStateFlow<String?>` under a name that sounds like a message
        // is a second channel — no matter what it is called.
        val hits = allWithoutComments().filter { (name, s) ->
            name != "MessageChannel.kt" &&
                Regex("""val\s+_?\w*(snack|message)\w*\s*(:[^=]+)?=\s*MutableStateFlow<String\?>""",
                      RegexOption.IGNORE_CASE).containsMatchIn(s)
        }.map { it.first }

        assert(hits.isEmpty()) {
            "Diese Dateien legen einen eigenen Snackbar-Fluss an: ${hits.joinToString()}.\n" +
                "Eingesammelt wird nur der aus data/MessageChannel.kt — alles andere " +
                "endet nirgends, solange niemand es von Hand weiterleitet."
        }
    }

    @Test
    fun `nobody forwards messages from ViewModel to ViewModel`() {
        // The block that should no longer exist. Searched is the EFFECT
        // (a foreign flow is collected and handed to showSnackbar),
        // not the wording of back then.
        val hits = allWithoutComments().filter { (name, s) ->
            name != "AppNavigation.kt" &&
                Regex("""\w+\.snackbar\.collectAsState""").containsMatchIn(s)
        }.map { it.first }

        assert(hits.isEmpty()) {
            "Diese Dateien sammeln einen Snackbar-Fluss ein, obwohl das " +
                "AppNavigation.kt tut: ${hits.joinToString()}.\n" +
                "Eine zweite Sammelstelle heisst: Ob eine Meldung ankommt, haengt " +
                "davon ab, welcher Bildschirm gerade offen ist."
        }
    }

    @Test
    fun `the channel is writable and readable from outside`() {
        // Without that no ViewModel can use it — and the first one that
        // tries builds its own again.
        val channel = MessageChannel()
        channel.show("gespeichert")
        assertEquals("AppNavigation.kt sammelt die Nur-Lese-Sicht ein", "gespeichert", channel.text)
        channel.acknowledge()
        assertEquals(null, channel.text)
        assertTrue("Ohne @Singleton bekäme jedes ViewModel eine eigene Instanz — dann gibt es " +
            "wieder so viele Kanäle wie ViewModels, nur unsichtbar",
            channel::class.java.isAnnotationPresent(Singleton::class.java))
    }

    @Test
    fun `all ViewModels use the same channel`() {
        // A ViewModel that produces messages but does not know the channel
        // has either its own (sub-step 1 catches that) or no
        // way out at all. Both are an error.
        val writer = allWithoutComments().filter { (name, s) ->
            name.endsWith("ViewModel.kt") && Regex("""\bzeigeMeldung\(|\bmessages\.show\(""").containsMatchIn(s)
        }
        assert(writer.isNotEmpty()) { "Kein ViewModel schreibt Meldungen — Muster veraltet?" }
        // The area ViewModels get it as Meldungen (Bereichshelfer.kt).
        val helper = allWithoutComments().single { it.first == "Bereichshelfer.kt" }.second
        assert(helper.contains("override fun show(text: String?) = channel.show(text)")) {
            "Meldungen reicht nicht mehr in den Kanal der App weiter"
        }
        val withoutChannel = writer.filter { (_, s) ->
            !s.contains("MessageChannel") && !s.contains("messages: Messages")
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
        val paths = PathServer()
        paths.codes["/api/v1/sets/75192-1"] = 500
        paths.codes["/api/v1/parts/3001/5/color"] = 500
        val t = TestServices(paths.onTick(), io = Dispatchers.Main)
        try {
            val gallery = t.track(GalleryViewModel(t.session, t.filter(), t.hints, t.changes, t.scrollMemory, testSetsRepository(t.api),
                t.accountView, testFinancesRepository(t.api), SavedStateHandle()))
            gallery.deleteSet("75192-1")
            assertTrue("Meldung der Galerie", t.messages.text != null)
            t.messages.acknowledge()
            val parts = t.track(PartsViewModel(t.session, t.filter(), t.hints, t.changes, t.scrollMemory, testPartsRepository(t.api), t.accountView, SavedStateHandle()))
            parts.setPartColor("3001", 5, 11)
            assertTrue("Meldung der Teile", t.messages.text != null)
        } finally {
            t.cleanUp()
            Dispatchers.resetMain()
            paths.server.shutdown()
        }
    }
}
