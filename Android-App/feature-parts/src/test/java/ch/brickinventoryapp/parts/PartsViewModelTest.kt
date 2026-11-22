package ch.brickinventoryapp.parts

import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.data.testing.PathServer
import ch.brickinventoryapp.data.testing.text
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.model.data.SparePartChoice
import ch.brickinventoryapp.model.domain.CategoryChoice
import ch.brickinventoryapp.model.domain.ColorPicker
import ch.brickinventoryapp.model.ui.ListView
import ch.brickinventoryapp.model.ui.Load
import ch.brickinventoryapp.model.ui.loading
import ch.brickinventoryapp.parts.ui.PartsFilter
import ch.brickinventoryapp.parts.ui.viewmodel.MinifigsViewModel
import ch.brickinventoryapp.parts.ui.viewmodel.PartsViewModel
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.state.testing.TestServices
import ch.brickinventoryapp.state.testing.newProcess
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestCoroutineScheduler
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Parts and figures ViewModel, run against the rules of a PathServer without network
 * (onTick): fetches and the store run on the test clock, no test waits in real time.
 * A process death is a new ViewModel with the same SavedStateHandle in new services.
 *
 * Counter-checks:
 *   A  in PartsViewModel `filterChanged` no longer written to the SavedStateHandle
 *      → red “filter and view survive …”
 *   teile-kontofilter-gemerkt  (counter-checks/) the account filter kept in the SavedStateHandle and
 *      restored after a process death → red “… not the account filter”
 *   figuren-suche-vergessen    (counter-checks/) MinifigsViewModel does not read the search back
 *      → red “search and view of the figures survive …”
 *   teile-laden-beim-zeigen    (counter-checks/) loadPerServer in PartsViewModel without loadPartsColors
 *      → red “whoever shows the tab gets …”
 *   B  in LocalApplication.manualParts the branch EditPart removed → red “a
 *      changed part is in the store …”
 *   C  in applyChangeTo() back to `error ?: text(err_unknown)` → red “an error
 *      the session layer already reports stays silent”
 *   D  in setPartLocation() the debounce removed → red “the storage location is
 *      saved debounced …”
 *   E  getManualParts without a storage location, or getManualMinifigs without a search text →
 *      each red “search text and storage location also reach the manually entered …”
 *   F  getMinifigStats without the view → red “the figures' account filter …”
 *   G  in BrickApiService for getManualParts or getManualMinifigs
 *      `@Query("search")` changed to `@Query("search")` → each red “search text and
 *      storage location also reach the manually entered …” (timeout
 *      "manual parts" or "manual figures")
 *   H  in Parts.loadMetrics the failure branch left empty → red “a failed key-figure fetch keeps
 *      the list and offers a retry” (extrasFetch stays Data)
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PartsViewModelTest {

    private val clock = TestCoroutineScheduler()
    private val tick = UnconfinedTestDispatcher(clock)
    private lateinit var paths: PathServer
    private lateinit var t: TestServices

    private fun vm(wanted: SavedStateHandle = SavedStateHandle(), t: TestServices = this.t) =
        t.track(PartsViewModel(t.session, t.filter(), t.hints, t.changes, t.scrollMemory, t.parts(), t.accountView, wanted))

    private fun minifigsVm(wanted: SavedStateHandle = SavedStateHandle(), t: TestServices = this.t) =
        t.track(MinifigsViewModel(t.session, t.filter(), t.hints, t.changes, t.figures(), t.accountView, wanted))

    @Before
    fun setUp() {
        Dispatchers.setMain(tick)
        paths = PathServer(
            "/api/v2/parts" to """{"success":true,"total":1,"parts":[{"part_number":"3001","color_id":5,"color_name":"Red"}]}""",
            "/api/v2/parts/manual" to """{"success":true,"parts":[]}""",
            "/api/v2/minifigs" to """{"success":true,"figs":[{"fig_number":"sw0001"}]}""",
            "/api/v2/parts/stats" to """{"success":true}""",
            "/api/v2/parts/3001/5" to """{"success":true}""",
            "/api/v2/parts/3001/5/storage" to """{"success":true,"storage":"Kiste 3"}""",
            "/api/v2/parts/3001/5/sets" to """{"success":true,"item":{"number":"3001","color_id":5},
                "sets":[{"set_number":"75192-1","quantity":4}]}""",
        )
        t = TestServices(paths.onTick(), io = tick)
    }

    @After
    fun tearDown() {
        t.cleanUp()
        Dispatchers.resetMain()
        paths.server.shutdown()
    }

    @Test
    fun `a failed key-figure fetch keeps the list and offers a retry`() {
        paths.codes["/api/v2/parts/stats"] = 500
        val vm = vm()
        vm.loadParts()
        assertTrue("List loaded", vm.partsState.value.parts.isNotEmpty())
        assertTrue("Error in the state", vm.partsState.value.extrasFetch is Load.Failure)

        paths.codes.remove("/api/v2/parts/stats")
        paths.responses["/api/v2/parts/stats"] = """{"success":true,"stats":{"unique_parts":1,"unique_colors":1,"total_parts":4}}"""
        val asked = paths.requestsTo("GET /api/v2/parts/stats").size
        vm.retryExtras()
        assertEquals("the metrics asked again", asked + 1, paths.requestsTo("GET /api/v2/parts/stats").size)
        assertTrue("Metrics there", vm.partsState.value.partsStats != null)
    }

    @Test
    fun `filter and view survive a process death and travel along, the account filter does not`() {
        val wanted = SavedStateHandle()
        val first = vm(wanted)
        first.setScope(ScopeFilter.View.PARTS, "own")
        first.setPartsColorFilter(ColorPicker.Color("5"))
        first.setPartsCategoryFilter(CategoryChoice.Category("11"))
        first.setPartsSpare(SparePartChoice.ONLY)
        first.setPartsView(ListView.TABLE)
        first.setPartsOrder(PartsFilter.Order.QUANTITY)
        first.setPartsQuery("stein")
        assertTrue("before with account", "accounts=own" in paths.requestsTo("GET /api/v2/parts?").last())

        paths.newProcess(io = tick) { paths, t ->
            val newValue = vm(wanted, t)
            assertEquals(PartsFilter("stein", SparePartChoice.ONLY, ListView.TABLE, PartsFilter.Order.QUANTITY, ColorPicker.Color("5"), CategoryChoice.Category("11")),
                newValue.partsState.value.filter)
            assertNull("the account filter only lives in memory", newValue.accountFor(ScopeFilter.View.PARTS))
            newValue.loadParts()
            assertTrue("List loaded", newValue.partsState.value.parts.isNotEmpty())
            val fetch = paths.requestsTo("GET /api/v2/parts?").single()
            assertTrue(fetch, listOf("color=5", "category=11", "spare=1", "with_sets=1", "search=stein").all { it in fetch })
            assertTrue(fetch, "accounts=" !in fetch)
        }
    }

    @Test
    fun `search and view of the figures survive a process death, the account filter does not`() {
        val wanted = SavedStateHandle()
        val first = minifigsVm(wanted)
        first.setScope(ScopeFilter.View.MINIFIGS, "own")
        first.setMinifigsQuery("han")
        first.setMinifigsView(ListView.TABLE)

        paths.newProcess(io = tick) { _, t ->
            val newValue = minifigsVm(wanted, t)
            assertEquals("han" to ListView.TABLE, newValue.minifigsState.value.let { it.minifigsQuery to it.minifigsView })
            assertNull(newValue.accountFor(ScopeFilter.View.MINIFIGS))
        }
    }

    @Test
    fun `whoever shows the tab gets list, colors and filter values, the figures only once`() {
        val vm = vm()
        val fig = minifigsVm()
        val before = CoroutineScope(tick).launch { vm.partsState.collect {} }
        assertTrue("no fetch without a server", paths.requestsTo("GET /api/v2/parts").isEmpty())
        before.cancel()
        t.session.loginChanged(paths.server.url("/").toString(), loggedIn = true)
        assertTrue("no fetch without an observer", paths.requestsTo("GET /api/v2/parts").isEmpty())
        val page = CoroutineScope(tick).launch { vm.partsState.collect {} }
        for (path in listOf("GET /api/v2/parts?", "GET /api/v2/parts/brick-colors", "GET /api/v2/parts/colors", "GET /api/v2/parts/categories"))
            assertTrue(path, paths.requestsTo(path).isNotEmpty())
        page.cancel()

        CoroutineScope(tick).launch { fig.minifigsState.collect {} }.cancel()
        val minifigsFetches = paths.requestsTo("GET /api/v2/minifigs").size
        assertTrue("the figures loaded", minifigsFetches > 0 && fig.minifigsState.value.minifigs.isNotEmpty())
        CoroutineScope(tick).launch { fig.minifigsState.collect {} }.cancel()
        assertEquals("already there: not once more", minifigsFetches, paths.requestsTo("GET /api/v2/minifigs").size)
    }

    @Test
    fun `search text and storage location also reach the manually added pieces`() {
        // Otherwise the text filters the set parts, and the manual tiles
        // above them stay as is.
        val vm = vm()
        vm.setStorageFilter(ScopeFilter.View.PARTS, "Keller")
        vm.setPartsQuery("stein")
        vm.loadParts()
        assertTrue("manual parts", paths.requestsTo("GET /api/v2/parts/manual?").any { "search=stein" in it })
        val parts = paths.requestsTo("GET /api/v2/parts/manual?").last { "search=stein" in it }
        assertTrue(parts, "storage=Keller" in parts)

        // Without an account filter, figure search searches the store; the fetch is unfiltered.
        val fig = minifigsVm()
        fig.setMinifigsQuery("han")
        fig.loadMinifigs()
        val figures = paths.requestsTo("GET /api/v2/minifigs/manual")
        assertTrue("manual figures fetched: $figures", figures.isNotEmpty() && figures.none { "search=" in it })
    }

    @Test
    fun `the account filter of the figures travels with list, key figures and manual figures`() {
        val vm = minifigsVm()
        vm.setScope(ScopeFilter.View.MINIFIGS, "own")
        for (path in listOf("GET /api/v2/minifigs?", "GET /api/v2/minifigs/stats?", "GET /api/v2/minifigs/manual?")) {
            assertTrue(path, paths.requestsTo(path).any { "accounts=own" in it })
        }
    }

    @Test
    fun `the account filter of the parts travels along, that of another view does not`() {
        val vm = vm()
        vm.setScope(ScopeFilter.View.PARTS, "own")
        assertTrue("List loaded", vm.partsState.value.parts.isNotEmpty())
        assertTrue("accounts=own" in paths.requestsTo("GET /api/v2/parts?").last())
        val before = paths.requestsTo("GET /api/v2/parts?").size
        vm.setScope(ScopeFilter.View.GALLERY, "own")
        assertEquals(before, paths.requestsTo("GET /api/v2/parts?").size)
    }

    @Test
    fun `a changed part is in the store without fetching the list again`() {
        paths.responses["/api/v2/parts/manual"] = """{"success":true,"parts":[{"part_number":"3001","color_id":5,"quantity":1}]}"""
        val vm = vm()
        vm.loadParts()
        assertEquals(listOf(1), vm.partsState.value.manualParts?.map { it.quantity })
        val fetches = paths.requestsTo("GET /api/v2/parts/manual").size
        vm.updatePart("3001", 5, quantity = 3, unitPrice = 0.1)
        assertEquals("the new quantity from the store", listOf(3), vm.partsState.value.manualParts?.map { it.quantity })
        assertEquals("without a new fetch", fetches, paths.requestsTo("GET /api/v2/parts/manual").size)
        assertEquals("t${R.string.vm_saved}", t.messages.text)
        assertTrue(paths.requestsTo("PUT /api/v2/parts/3001/5").isNotEmpty())
    }

    @Test
    fun `an error the session layer already reports stays silent`() {
        paths.codes["/api/v2/parts/3001/5"] = 401
        val vm = vm()
        vm.deletePart("3001", 5)
        assertTrue("Response there", paths.requestsTo("DELETE /api/v2/parts/3001/5").isNotEmpty())
        assertNull("A 401 is already reported — no second, empty sentence here", t.messages.text)
    }

    @Test
    fun `the storage location is saved debounced and shown in the open dialog`() {
        val vm = vm()
        vm.openSetItem("3001", 5)
        assertTrue("Dialog loaded", !vm.setItemState.value.fetch.loading)
        assertEquals("75192-1", vm.setItemState.value.sets.single().setNumber)

        vm.setPartLocation("3001", 5, "Ki")
        vm.setPartLocation("3001", 5, "Kiste 3")
        clock.advanceTimeBy(500)
        assertTrue("Nothing goes out before the quiet period", paths.requestsTo("PUT /api/v2/parts/3001/5/storage").isEmpty())
        clock.advanceTimeBy(400)
        assertTrue("saved", vm.setItemState.value.header?.storage == "Kiste 3")
        assertEquals(1, paths.requestsTo("PUT /api/v2/parts/3001/5/storage").size)
    }

    @Test
    fun `after sign-out nothing is left`() {
        val wanted = SavedStateHandle()
        val vm = vm(wanted)
        vm.setPartsColorFilter(ColorPicker.Color("Red"))
        vm.openSetItem("3001", 5)
        assertTrue("loaded", vm.partsState.value.parts.isNotEmpty() && !vm.setItemState.value.fetch.loading)
        t.session.loggedOut()
        assertTrue(vm.partsState.value.parts.isEmpty())
        assertTrue(!vm.setItemState.value.open)
        assertEquals(PartsFilter(), vm(wanted).partsState.value.filter)
    }
}
