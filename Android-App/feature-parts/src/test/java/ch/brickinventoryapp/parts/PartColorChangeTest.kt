package ch.brickinventoryapp.parts

import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.parts.ui.viewmodel.PartsViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import ch.brickinventoryapp.testing.PathServer
import ch.brickinventoryapp.testing.Sources
import ch.brickinventoryapp.testing.testPartsRepository
import ch.brickinventoryapp.testing.TestServices

/**
 * Changing a manually entered part's color after the fact — the app side.
 *
 * ── What is checked here and what is NOT ────────────────────────────────────
 *
 * What the change DOES — moving or merging, adding together entries from the
 * same day, rejecting a set part — is checked by the server against a
 * real database: Web-App/test/part-color-change-db.test.js. A second,
 * weaker version of that does not belong here.
 *
 * Here stand the three statements that can only be proven on THIS side:
 *
 *   1. The app calls the same service as the web app: the logic lives once in the
 *      backend, both UIs use it.
 *
 * ── Counter-checks ─────────────────────────────────────────────────────────────
 *
 * Cases 1 and 4 run against a PathServer without network (PartsViewModel, PartsRepository),
 * cases 2 and 3 read the screen and the graph. Measured:
 *   A  in PartsApi the address to "…/colour" → red “the app calls the same
 *      service as the web app”
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PartColorChangeTest {

    private val paths = PathServer("/api/v1/parts/3001/5/color" to """{"success":true}""")
    private val t = TestServices(paths.onTick(), io = Dispatchers.Main)

    @Before
    fun setUp() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @After
    fun tearDown() {
        t.cleanUp()
        Dispatchers.resetMain()
        paths.server.shutdown()
    }

    private fun vm() = t.track(PartsViewModel(t.session, t.filter(), t.hints, t.changes, t.scrollMemory, testPartsRepository(t.api), t.accountView, SavedStateHandle()))
    private val screen by lazy {
        Sources.withoutComments(Sources.read("parts/ui/screens/ManualItemDetailScreen.kt"))
    }
    private val graph by lazy {
        Sources.withoutComments(Sources.read("parts/ui/PartsGraph.kt"))
    }
    private val field by lazy {
        Sources.withoutComments(Sources.read("parts/ui/screens/ColorChoiceField.kt"))
    }

    /**
     * The OLD color in the path, the NEW one in the body: the path says which row
     * is meant, the body where it should go. owner is the owner of the CARD —
     * in the household the manual section shows all accounts, without it the
     * server would change the caller's own row instead of the one shown.
     */
    @Test
    fun `the app calls the same service as the web app`() {
        var opened: Int? = null
        vm().setPartColor("3001", 5, 11, owner = 7) { opened = it }
        assertTrue("neu geöffnet", opened != null)
        // The store fetches the color itself afterward; only the call is counted.
        assertEquals(listOf("PUT /api/v1/parts/3001/5/color?owner=7"), paths.requestsTo("/color"))
        val bodyBytes = paths.bodyBytes[paths.requests.indexOfFirst { "/color" in it }]
        assertTrue(bodyBytes, bodyBytes.contains("\"color_id\":11"))
        assertEquals("Der Bildschirm öffnet mit der neuen Farbe", 11, opened)
        assertTrue("Der Bildschirm reicht den Besitzer der Karte nicht weiter",
            Regex("""owner\s*=\s*part\?\.userId""").containsMatchIn(screen))
    }

    @Test
    fun `after the change the screen opens with the new color`() {
        assertTrue(
            "Der Bildschirm wird nach der Aenderung nicht neu geoeffnet: In " +
                "PartsGraph.kt fehlt onColorChanged. Die Farbe ist Teil der " +
                "Route und der Suche nach der Zeile — der Bildschirm stuende leer da, " +
                "obwohl die Aenderung geklappt hat.",
            graph.contains("onColorChanged")
        )
        assertTrue(
            "onFarbeGeaendert navigiert nicht auf ManualItemDetail mit der neuen Farbe.",
            Regex(
                """onColorChanged\s*=\s*\{[^}]*navigate\(target\.copy\(colorId\s*=\s*newColor\)\)""",
                RegexOption.DOT_MATCHES_ALL
            ).containsMatchIn(graph)
        )
        // Back first, then forward: if the old entry stayed on the way back,
        // a back tap would land on exactly the color that was just being
        // corrected.
        assertTrue(
            "Vor dem neuen Aufruf fehlt das popBackStack() — der alte Eintrag mit " +
                "der falschen Farbe bliebe im Rueckweg stehen.",
            Regex(
                """onColorChanged\s*=\s*\{[^}]*popBackStack\(\)[^}]*navigate""",
                RegexOption.DOT_MATCHES_ALL
            ).containsMatchIn(graph)
        )
        assertTrue(
            "Der Screen gibt onFarbeGeaendert nicht an setzeTeilFarbe weiter — dann " +
                "wird nach der Aenderung nichts neu geoeffnet.",
            Regex("""onDone\s*=\s*onColorChanged""").containsMatchIn(screen)
        )
    }

    @Test
    fun `the color row does not depend on an existing color name`() {
        // The call to ColorChoiceField must not stand under a condition
        // that demands the color name. What is checked is the block BEFORE the call:
        // the next condition above it is `if (!isFig) {` — and nothing
        // else.
        val i = screen.indexOf("ColorChoiceField(")
        assertTrue(
            "ColorChoiceField wird im Detailbildschirm nicht aufgerufen — dann gibt es " +
                "keine Moeglichkeit, die Farbe zu korrigieren.",
            i > 0
        )
        val before = screen.substring(0, i)
        val lastCondition = Regex("""if \(([^)\n]*)\)\s*\{[^{}]*$""").find(before)
            ?.groupValues?.get(1)
            ?: Regex("""if \(([^)\n]*)\)""").findAll(before).lastOrNull()?.groupValues?.get(1) ?: ""
        assertTrue(
            "Die Farbzeile steht hinter der Bedingung „$lastCondition\". Verlangt sie " +
                "einen Farbnamen, zeigt ausgerechnet das Teil ohne Farbnamen nichts an — " +
                "und genau das ist der Fall, der korrigiert werden muss.",
            !lastCondition.contains("colorName")
        )
        // And the opposite direction, in the field itself: without a color list (no network, no
        // Rebrickable key) today's color must still be shown.
        assertTrue(
            "ColorChoiceField faellt ohne Farbliste nicht auf den heutigen Namen zurueck — " +
                "dann stuende dort ein leeres Feld.",
            field.contains("currentName")
        )
        assertTrue(
            "ColorChoiceField nennt keinen Rueckfall fuer eine Farbe ohne Namen — dann " +
                "waere das Feld bei genau diesen Teilen leer.",
            field.contains("parts_color_unknown")
        )
    }

    @Test
    fun `the same color again triggers no request`() {
        // Two places, and both with a reason: the field does not send the callback
        // (saves the request AND reopening), the ViewModel
        // also aborts (it is the path every caller takes).
        //
        // The server rejects the case anyway, without changing anything — but
        // "the server will catch it" is no reason to send a request
        // whose answer is a rebuild of the screen.
        vm().setPartColor("3001", 5, 5)
        assertTrue("setzeTeilFarbe bricht bei gleicher Farbe nicht ab: ${paths.requests}", paths.requestsTo("/color").isEmpty())
        assertTrue(
            "ColorChoiceField ruft onWahl auch fuer die bereits gewaehlte Farbe.",
            Regex("""if \(c\.id != current\) onChoice\(c\)""").containsMatchIn(field)
        )
    }
}
