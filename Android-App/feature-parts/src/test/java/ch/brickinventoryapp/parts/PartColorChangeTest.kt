package ch.brickinventoryapp.parts

import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.data.testing.PathServer
import ch.brickinventoryapp.data.testing.testPartsRepository
import ch.brickinventoryapp.parts.ui.viewmodel.PartsViewModel
import ch.brickinventoryapp.state.testing.TestServices
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

/**
 * Changing a manually entered part's color, the ViewModel side: the old color in the path, the new
 * one in the body, the card's owner along — the web app's service. What the change does on the
 * server is checked there (Web-App/test/part-color-change-db.test.js); the page and the
 * navigation run in the app's PartColorFlowTest.
 *
 * Counter-check: in PartsApi the address to "…/colour" → red “the app calls the same service as the web app”.
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
        assertTrue("reopened", opened != null)
        // The store fetches the color itself afterward; only the call is counted.
        assertEquals(listOf("PUT /api/v1/parts/3001/5/color?owner=7"), paths.requestsTo("/color"))
        val bodyBytes = paths.bodyBytes[paths.requests.indexOfFirst { "/color" in it }]
        assertTrue(bodyBytes, bodyBytes.contains("\"color_id\":11"))
        assertEquals("The screen opens with the new color", 11, opened)
    }

    @Test
    fun `the same color again triggers no request`() {
        // Two places, and both with a reason: the field does not send the callback
        // (ColorChoiceFieldTest), the ViewModel also aborts (it is the path every caller takes).
        //
        // The server rejects the case anyway, without changing anything — but
        // "the server will catch it" is no reason to send a request
        // whose answer is a rebuild of the screen.
        vm().setPartColor("3001", 5, 5)
        assertTrue("setzeTeilFarbe does not stop at the same color: ${paths.requests}", paths.requestsTo("/color").isEmpty())
    }
}
