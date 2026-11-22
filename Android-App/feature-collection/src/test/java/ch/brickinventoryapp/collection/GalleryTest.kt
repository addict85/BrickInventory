package ch.brickinventoryapp.collection

import ch.brickinventoryapp.collection.ui.Gallery
import ch.brickinventoryapp.collection.ui.GalleryDisplay
import ch.brickinventoryapp.collection.ui.GalleryUiState
import ch.brickinventoryapp.collection.ui.galleryDisplay
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.model.domain.SetView
import ch.brickinventoryapp.model.local.Local
import ch.brickinventoryapp.model.ui.ErrorClass
import ch.brickinventoryapp.model.ui.Load
import ch.brickinventoryapp.model.ui.Message
import ch.brickinventoryapp.model.ui.errorMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The gallery tested as a flow — without a ViewModel or network. Its source is a
 * flow (on the device the store, or the account view); the fetch only fills the source
 * and here records what it was called for.
 *
 * Counter-checks (kotlinc against Gallery.kt, December version with one load mode):
 *   A  in load() `sequenceJob?.cancel()` removed → red “after a filter change
 *      the gallery shows only the new source” (the old source keeps writing into it)
 *   B  in load() the branch "without network, with a cached state" removed → red “without network
 *      the source stays as is, with its cached state”
 *   C  in load() `galleryFehler = errorMessage(r)` removed → red “a
 *      load error becomes an error display with a reason”
 *   D  `galleryFehler = null` removed on a new attempt → red “a
 *      successful retry clears the error”
 *   E  in galleryDisplay() the branches FEHLER and LEER swapped → red
 *      “a load error …” and “an empty collection …”
 *   F  in load() `if (l.state == null) return@collect` removed → red “a source
 *      never loaded does not empty the gallery”
 */
@OptIn(ExperimentalCoroutinesApi::class)
class GalleryTest {

    private fun set(nr: Int, quantity: Int = 1, theme: String? = null) = SetView(setNumber = "$nr-1", quantity = quantity, theme = theme)

    private fun short(l: List<SetView>) = l.map { "${it.setNumber}x${it.quantity}" }

    /** The source per theme; [updated] records which theme it was filled for. */
    private class Source(
        start: Local<SetView> = Local(
            listOf(SetView(setNumber = "1-1"), SetView(setNumber = "2-1", theme = "Star Wars")),
            1L,
        ),
    ) {
        val store = MutableStateFlow(start)
        val updated = mutableListOf<String>()
    }

    /**
     * In the foreground of the clock, so that advanceUntilIdle also waits out the fetches
     * (backgroundScope does not count there); as a child of the background it ends with the test.
     */
    private fun TestScope.foreground() = CoroutineScope(coroutineContext + Job(backgroundScope.coroutineContext[Job]))

    private fun TestScope.gallery(q: Source, outcome: () -> Outcome<Unit> = { Outcome.Success(Unit) }) = Gallery(
        scope = foreground(),
        source = { st -> q.store.map { l -> l.copy(list = l.list.filter { st.galleryTheme.isBlank() || it.theme == st.galleryTheme }) } },
        refresh = { st -> q.updated += st.galleryTheme; delay(10); outcome() },
        fetchMetrics = { Outcome.Success(null) },
        reportError = {},
        forgetScroll = {},
    )

    @Test
    fun `the gallery follows the source, even if it changes without a fetch`() = runTest {
        val q = Source()
        val g = gallery(q)
        g.load(); advanceUntilIdle()
        assertEquals(listOf("1-1x1", "2-1x1"), short(g.state.value.sets))
        // Offline +2 on set 1 and a new set: the store changes, the gallery follows.
        q.store.value = Local(listOf(set(3), set(1, 3), set(2, theme = "Star Wars")), 2L)
        runCurrent()
        assertEquals(listOf("3-1x1", "1-1x3", "2-1x1"), short(g.state.value.sets))
        assertEquals("ein Abruf je Laden, keiner je Änderung", 1, q.updated.size)
    }

    @Test
    fun `after a filter change the gallery shows only the new source`() = runTest {
        val old = MutableStateFlow(Local(listOf(set(1)), 1L))
        val newValue = MutableStateFlow(Local(listOf(set(2, theme = "Star Wars")), 1L))
        val g = Gallery(scope = foreground(), source = { st -> if (st.galleryTheme.isBlank()) old else newValue },
            refresh = { Outcome.Success(Unit) }, fetchMetrics = { Outcome.Success(null) },
            reportError = {}, forgetScroll = {})
        g.load(); advanceUntilIdle()
        g.setTheme("Star Wars"); advanceUntilIdle()
        assertEquals(listOf("2-1x1"), short(g.state.value.sets))
        old.value = Local(listOf(set(9)), 2L)
        runCurrent()
        assertEquals("die Quelle des alten Filters schreibt nicht mehr hinein", listOf("2-1x1"), short(g.state.value.sets))
    }

    @Test
    fun `the search waits for the pause and asks once with the last text`() = runTest {
        val q = Source()
        val g = gallery(q)
        g.setSearch("ti"); g.setSearch("tit")
        advanceTimeBy(300)
        assertEquals(0, q.updated.size)
        advanceUntilIdle()
        assertEquals(1, q.updated.size)
        assertEquals("tit", g.state.value.galleryQuery)
    }

    @Test
    fun `sign-out cleans up, and a late response does not come back`() = runTest {
        val g = gallery(Source())
        g.load(); runCurrent()
        g.reset()
        advanceUntilIdle()
        assertEquals(GalleryUiState(), g.state.value)
    }

    @Test
    fun `a loading error becomes the error display with a reason`() = runTest {
        val g = gallery(Source(Local(emptyList(), null))) { Outcome.Failure.Server(504, "Zeitüberschreitung") }
        g.load(); advanceUntilIdle()
        val st = g.state.value
        assertEquals(Message.Text("Zeitüberschreitung"), st.fetch.errorMessage)
        assertEquals(GalleryDisplay.ERROR, galleryDisplay(st, filtered = false))
    }

    @Test
    fun `a successful new attempt clears the error`() = runTest {
        var broken = true
        val g = gallery(Source()) { if (broken) Outcome.Failure.Server(503, "Netz") else Outcome.Success(Unit) }
        g.load(); advanceUntilIdle()
        broken = false
        g.load(); advanceUntilIdle()
        assertNull(g.state.value.fetch.errorMessage)
        assertEquals(GalleryDisplay.LIST, galleryDisplay(g.state.value, filtered = false))
    }

    @Test
    fun `without network the source stays, with its state`() = runTest {
        val g = gallery(Source(Local(listOf(set(7)), 5L))) { Outcome.Failure.Network() }
        g.load(); advanceUntilIdle()
        assertEquals(listOf("7-1x1"), short(g.state.value.sets))
        assertNull("ohne Netz bleibt die Ablage stehen", g.state.value.fetch.errorMessage)
        assertEquals(5L, g.state.value.offlineStatus)
    }

    @Test
    fun `a never loaded source does not empty the gallery`() = runTest {
        val q = Source(Local(listOf(set(7)), null))
        val g = gallery(q)
        g.load(); advanceUntilIdle()
        assertEquals(emptyList<String>(), short(g.state.value.sets))
        q.store.value = Local(listOf(set(1)), 9L)
        runCurrent()
        assertEquals(listOf("1-1x1"), short(g.state.value.sets))
    }

    @Test
    fun `an empty collection is not an error`() {
        assertEquals(GalleryDisplay.EMPTY, galleryDisplay(GalleryUiState(), filtered = false))
        assertEquals(GalleryDisplay.NO_HITS, galleryDisplay(GalleryUiState(), filtered = true))
        assertEquals(GalleryDisplay.LOADS, galleryDisplay(GalleryUiState(fetch = Load.Loads), filtered = false))
    }

    @Test
    fun `loaded sets stay even if reloading fails`() {
        val st = GalleryUiState(sets = listOf(set(1)), fetch = Load.Failure(ErrorClass.OFFLINE, Message.Text("Netz")))
        assertEquals(GalleryDisplay.LIST, galleryDisplay(st, filtered = false))
    }
}
