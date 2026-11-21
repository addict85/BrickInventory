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
import ch.brickinventoryapp.testing.PfadServer
import ch.brickinventoryapp.testing.Quellen
import ch.brickinventoryapp.testing.testPartsRepository
import ch.brickinventoryapp.testing.TestDienste

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
 * Cases 1 and 4 run against a PfadServer without network (PartsViewModel, PartsRepository),
 * cases 2 and 3 read the screen and the graph. Measured:
 *   A  in PartsApi the address to "…/colour" → red “the app calls the same
 *      service as the web app”
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PartColorChangeTest {

    private val paths = PfadServer("/api/v1/parts/3001/5/color" to """{"success":true}""")
    private val t = TestDienste(paths.imTakt(), io = Dispatchers.Main)

    @Before
    fun auf() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @After
    fun zu() {
        t.aufraeumen()
        Dispatchers.resetMain()
        paths.server.shutdown()
    }

    private fun vm() = t.merke(PartsViewModel(t.sitzung, t.filter(), t.hinweise, t.changes, t.scrollMemory, testPartsRepository(t.api), t.kontosicht, SavedStateHandle()))
    private val screen by lazy {
        Quellen.withoutComments(Quellen.lies("parts/ui/screens/ManualItemDetailScreen.kt"))
    }
    private val graph by lazy {
        Quellen.withoutComments(Quellen.lies("parts/ui/TeileGraph.kt"))
    }
    private val feld by lazy {
        Quellen.withoutComments(Quellen.lies("parts/ui/screens/FarbWahlFeld.kt"))
    }

    /**
     * The OLD color in the path, the NEW one in the body: the path says which row
     * is meant, the body where it should go. owner is the owner of the CARD —
     * in the household the manual section shows all accounts, without it the
     * server would change the caller's own row instead of the one shown.
     */
    @Test
    fun `the app calls the same service as the web app`() {
        var geoeffnet: Int? = null
        vm().setzeTeilFarbe("3001", 5, 11, owner = 7) { geoeffnet = it }
        assertTrue("neu geöffnet", geoeffnet != null)
        // The store fetches the color itself afterward; only the call is counted.
        assertEquals(listOf("PUT /api/v1/parts/3001/5/color?owner=7"), paths.requestsAn("/color"))
        val koerper = paths.koerper[paths.requests.indexOfFirst { "/color" in it }]
        assertTrue(koerper, koerper.contains("\"color_id\":11"))
        assertEquals("Der Bildschirm öffnet mit der neuen Farbe", 11, geoeffnet)
        assertTrue("Der Bildschirm reicht den Besitzer der Karte nicht weiter",
            Regex("""owner\s*=\s*part\?\.userId""").containsMatchIn(screen))
    }

    @Test
    fun `after the change the screen opens with the new color`() {
        assertTrue(
            "Der Bildschirm wird nach der Aenderung nicht neu geoeffnet: In " +
                "TeileGraph.kt fehlt onFarbeGeaendert. Die Farbe ist Teil der " +
                "Route und der Suche nach der Zeile — der Bildschirm stuende leer da, " +
                "obwohl die Aenderung geklappt hat.",
            graph.contains("onFarbeGeaendert")
        )
        assertTrue(
            "onFarbeGeaendert navigiert nicht auf ManualItemDetail mit der neuen Farbe.",
            Regex(
                """onFarbeGeaendert\s*=\s*\{[^}]*navigate\(ziel\.copy\(colorId\s*=\s*neueFarbe\)\)""",
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
                """onFarbeGeaendert\s*=\s*\{[^}]*popBackStack\(\)[^}]*navigate""",
                RegexOption.DOT_MATCHES_ALL
            ).containsMatchIn(graph)
        )
        assertTrue(
            "Der Screen gibt onFarbeGeaendert nicht an setzeTeilFarbe weiter — dann " +
                "wird nach der Aenderung nichts neu geoeffnet.",
            Regex("""onFertig\s*=\s*onFarbeGeaendert""").containsMatchIn(screen)
        )
    }

    @Test
    fun `the color row does not depend on an existing color name`() {
        // The call to FarbWahlFeld must not stand under a condition
        // that demands the color name. What is checked is the block BEFORE the call:
        // the next condition above it is `if (!isFig) {` — and nothing
        // else.
        val i = screen.indexOf("FarbWahlFeld(")
        assertTrue(
            "FarbWahlFeld wird im Detailbildschirm nicht aufgerufen — dann gibt es " +
                "keine Moeglichkeit, die Farbe zu korrigieren.",
            i > 0
        )
        val davor = screen.substring(0, i)
        val lastCondition = Regex("""if \(([^)\n]*)\)\s*\{[^{}]*$""").find(davor)
            ?.groupValues?.get(1)
            ?: Regex("""if \(([^)\n]*)\)""").findAll(davor).lastOrNull()?.groupValues?.get(1) ?: ""
        assertTrue(
            "Die Farbzeile steht hinter der Bedingung „$lastCondition\". Verlangt sie " +
                "einen Farbnamen, zeigt ausgerechnet das Teil ohne Farbnamen nichts an — " +
                "und genau das ist der Fall, der korrigiert werden muss.",
            !lastCondition.contains("colorName")
        )
        // And the opposite direction, in the field itself: without a color list (no network, no
        // Rebrickable key) today's color must still be shown.
        assertTrue(
            "FarbWahlFeld faellt ohne Farbliste nicht auf den heutigen Namen zurueck — " +
                "dann stuende dort ein leeres Feld.",
            feld.contains("aktuellerName")
        )
        assertTrue(
            "FarbWahlFeld nennt keinen Rueckfall fuer eine Farbe ohne Namen — dann " +
                "waere das Feld bei genau diesen Teilen leer.",
            feld.contains("parts_color_unknown")
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
        vm().setzeTeilFarbe("3001", 5, 5)
        assertTrue("setzeTeilFarbe bricht bei gleicher Farbe nicht ab: ${paths.requests}", paths.requestsAn("/color").isEmpty())
        assertTrue(
            "FarbWahlFeld ruft onWahl auch fuer die bereits gewaehlte Farbe.",
            Regex("""if \(c\.id != aktuell\) onWahl\(c\)""").containsMatchIn(feld)
        )
    }
}
