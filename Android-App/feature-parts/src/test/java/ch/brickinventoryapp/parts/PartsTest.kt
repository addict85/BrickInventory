package ch.brickinventoryapp.parts

import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.model.data.SparePartChoice
import ch.brickinventoryapp.model.domain.CategoryChoice
import ch.brickinventoryapp.model.domain.CategoryView
import ch.brickinventoryapp.model.domain.ColorPicker
import ch.brickinventoryapp.model.domain.ColorView
import ch.brickinventoryapp.model.domain.FigureView
import ch.brickinventoryapp.model.domain.FilterColorView
import ch.brickinventoryapp.model.domain.ManualMinifigView
import ch.brickinventoryapp.model.domain.ManualPartView
import ch.brickinventoryapp.model.domain.MinifigsMetricsView
import ch.brickinventoryapp.model.domain.PartView
import ch.brickinventoryapp.model.domain.PartsMetricsView
import ch.brickinventoryapp.model.local.Local
import ch.brickinventoryapp.model.ui.ListView
import ch.brickinventoryapp.model.ui.errorMessage
import ch.brickinventoryapp.model.ui.loading
import ch.brickinventoryapp.parts.ui.Figures
import ch.brickinventoryapp.parts.ui.MinifigsLocal
import ch.brickinventoryapp.parts.ui.Parts
import ch.brickinventoryapp.parts.ui.PartsFilter
import ch.brickinventoryapp.parts.ui.PartsLocal
import ch.brickinventoryapp.parts.ui.PartsSource
import ch.brickinventoryapp.parts.ui.PartsUiState
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
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The parts and figures list checked as a flow. Their sources are flows (on the device
 * the store or the account view, chosen by the ViewModel); the fetch only fills
 * the source and here records which state it was called for.
 *
 * Counter-checks (kotlinc against Parts.kt, version with one load mode):
 *   A  in loadParts() the state read before the debounce → red “the state's
 *      filters reach the source and the fetch” (search missing)
 *   B  forgetScroll() removed in setFilter() → red “a filter change forgets
 *      the scroll position”
 *   C  the figure key figures put into the same job as the list → red “the
 *      figures list does not wait for the key figures”
 *   D  in Listenfolge.cancel() `follow.forEach { it.cancel() }` removed → red “after
 *      a filter change the old source no longer writes into it”
 *   E  in outbox() the branch "without network, with a cached state" removed → red “without network
 *      the figures stay as they are”
 *   F  in follow() the check on the cached state removed → red “a source
 *      never loaded shows nothing and empties nothing”
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PartsTest {

    private class Metrics : PartsSource {
        var minifigFetches = 0
        var minifigDuration = 0L
        override suspend fun partsMetrics(): Outcome<PartsMetricsView?> = Outcome.Failure.Server(503, "aus")
        override suspend fun filterColors() = Outcome.Success(emptyList<FilterColorView>())
        override suspend fun categories() = Outcome.Success(emptyList<CategoryView>())
        override suspend fun allColors() = Outcome.Success(emptyList<ColorView>())
        suspend fun minifigMetrics(): Outcome<MinifigsMetricsView> {
            minifigFetches++
            delay(minifigDuration)
            return Outcome.Failure.Server(500, "Zählung gescheitert")
        }
    }

    private val metrics = Metrics()
    private val parts = MutableStateFlow(Local(listOf(PartView(partNumber = "3001", partName = "Brick", colorName = "Red"),
        PartView(partNumber = "3023", partName = "Plate", colorName = "Blue")), 1L))
    private val manualParts = MutableStateFlow(Local(emptyList<ManualPartView>(), 1L))
    private val figures = MutableStateFlow(Local(listOf(FigureView(figNumber = "sw0001")), 4L))
    private val manualMinifigs = MutableStateFlow(Local(emptyList<ManualMinifigView>(), 4L))
    private val partsFetches = mutableListOf<PartsUiState>()
    private val searchManual = mutableListOf<String>()
    private val minifigFetches = mutableListOf<String>()
    private var minifigsResponse: Outcome<Unit> = Outcome.Success(Unit)
    private var forget = 0

    /**
     * In the foreground of the clock, so that advanceUntilIdle also waits out the fetches
     * (backgroundScope does not count there); as a child of the background it ends with the test.
     */
    private fun TestScope.foreground() = CoroutineScope(coroutineContext + Job(backgroundScope.coroutineContext[Job]))

    // Like the filter columns in Room: the search text matches the number or name, the color the color name.
    private fun TestScope.parts() = Parts(
        scope = foreground(), source = metrics, reportError = {}, forgetScroll = { forget++ },
        lists = PartsLocal(
            parts = { st -> val f = st.filter; parts.map { l -> l.copy(list = l.list.filter {
                (f.search.isBlank() || it.partNumber.contains(f.search) || it.partName.orEmpty().contains(f.search)) &&
                    (f.color == ColorPicker.All || it.colorName == f.color.value) }) } },
            manualParts = { st -> searchManual += st.filter.search; manualParts },
            refresh = { st -> partsFetches += st; Outcome.Success(Unit) },
        ),
    )

    private fun TestScope.figureList() = Figures(
        scope = foreground(), reportError = {},
        lists = MinifigsLocal(
            figures = { figures },
            manualMinifigs = { manualMinifigs },
            refresh = { st -> minifigFetches += st.minifigsQuery; minifigsResponse },
            metrics = { metrics.minifigMetrics() },
        ),
    )

    private fun Parts.filter(change: (PartsFilter) -> PartsFilter) = setFilter(change(state.value.filter))

    @Test
    fun `the filters of the state reach source and fetch`() = runTest {
        val t = parts()
        t.filter { it.copy(color = ColorPicker.Color("Red")) }; t.filter { it.copy(category = CategoryChoice.Category("11")) }
        t.filter { it.copy(spare = SparePartChoice.WITHOUT) }; t.filter { it.copy(view = ListView.TABLE) }
        t.filter { it.copy(search = "30") }
        advanceUntilIdle()
        val st = partsFetches.last().filter
        assertEquals(listOf("30", "Red", "11"), listOf(st.search, st.color.value, st.category.value))
        assertEquals(SparePartChoice.WITHOUT to ListView.TABLE, st.spare to st.view)
        assertEquals(listOf("3001"), t.state.value.parts.map { it.partNumber })
        assertEquals("the manual parts under the same search text", "30", searchManual.last())
    }

    @Test
    fun `a filter change forgets the scroll position`() = runTest {
        val t = parts()
        t.filter { it.copy(color = ColorPicker.Color("5")) }; t.filter { it.copy(category = CategoryChoice.Category("11")) }
        t.filter { it.copy(spare = SparePartChoice.ONLY) }; t.filter { it.copy(search = "stein") }
        assertEquals(4, forget)
        t.filter { it.copy(color = ColorPicker.Color("5")) }
        assertEquals("The same color once more is no change", 4, forget)
        advanceUntilIdle()
    }

    @Test
    fun `the list follows the source, even without a fetch`() = runTest {
        val t = parts()
        t.load(); runCurrent()
        // The default is "by color" (TeileOrdnung): blue before red, not the source's order.
        assertEquals(listOf("3023", "3001"), t.state.value.parts.map { it.partNumber })
        // Entered offline: the store changes, the list follows.
        manualParts.value = Local(listOf(ManualPartView(partNumber = "neu", quantity = 3)), 2L)
        runCurrent()
        assertEquals(listOf("neu" to 3), t.state.value.manualParts!!.map { it.partNumber to it.quantity })
        t.load(page = 2); runCurrent()
        assertEquals("no more paging: the source holds everything", 1, partsFetches.size)
    }

    @Test
    fun `after a filter change the old source no longer writes into it`() = runTest {
        val old = MutableStateFlow(Local(listOf(PartView(partNumber = "alt")), 1L))
        val newValue = MutableStateFlow(Local(listOf(PartView(partNumber = "neu")), 1L))
        val t = Parts(scope = foreground(), source = metrics, reportError = {}, forgetScroll = {},
            lists = PartsLocal(parts = { st -> if (st.filter.color == ColorPicker.All) old else newValue },
                manualParts = { manualParts }, refresh = { Outcome.Success(Unit) }))
        t.load(); runCurrent()
        t.filter { it.copy(color = ColorPicker.Color("Red")) }; runCurrent()
        old.value = Local(listOf(PartView(partNumber = "spaet")), 2L)
        runCurrent()
        assertEquals(listOf("neu"), t.state.value.parts.map { it.partNumber })
    }

    @Test
    fun `the figure list does not wait for the key figures and a failure leaves it`() = runTest {
        metrics.minifigDuration = 5_000
        val t = figureList()
        t.load()
        advanceTimeBy(10); runCurrent()
        assertEquals(listOf("sw0001"), t.uiState.value.minifigs.map { it.figNumber })
        assertFalse(t.uiState.value.minifigsFetch.loading)
        advanceUntilIdle()
        assertEquals(listOf("sw0001"), t.uiState.value.minifigs.map { it.figNumber })
        assertEquals(MinifigsMetricsView(), t.uiState.value.minifigStats)
    }

    @Test
    fun `while typing the figure list asks once and does not recount`() = runTest {
        val t = figureList()
        t.setSearch("lu"); t.setSearch("luk"); t.setSearch("luke")
        advanceUntilIdle()
        assertEquals(listOf("luke"), minifigFetches)
        assertEquals(0, metrics.minifigFetches)
    }

    @Test
    fun `without network the figures stay, with their state`() = runTest {
        minifigsResponse = Outcome.Failure.Network()
        val t = figureList()
        t.load(); runCurrent()
        assertEquals(listOf("sw0001"), t.uiState.value.minifigs.map { it.figNumber })
        assertNull("without network the figures stay", t.uiState.value.minifigsFetch.errorMessage)
        assertEquals(4L, t.uiState.value.minifigsOfflineStatus)
    }

    @Test
    fun `a never loaded source shows nothing and empties nothing`() = runTest {
        figures.value = Local(listOf(FigureView(figNumber = "alt")), null)
        val t = figureList()
        t.load(); runCurrent()
        assertEquals(emptyList<String>(), t.uiState.value.minifigs.map { it.figNumber })
        figures.value = Local(listOf(FigureView(figNumber = "sw0002")), 5L)
        runCurrent()
        assertEquals(listOf("sw0002"), t.uiState.value.minifigs.map { it.figNumber })
    }

    @Test
    fun `sign-out cleans up, and a late response does not come back`() = runTest {
        val t = parts()
        t.filter { it.copy(color = ColorPicker.Color("Red")) }; runCurrent()
        t.reset()
        advanceUntilIdle()
        assertEquals(PartsUiState(), t.state.value)
    }
}
