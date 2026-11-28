package ch.brickinventoryapp.collection

import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.collection.ui.viewmodel.WantedListViewModel
import ch.brickinventoryapp.data.testing.PathServer
import ch.brickinventoryapp.data.testing.testCatalogRepository
import ch.brickinventoryapp.data.testing.testFinancesRepository
import ch.brickinventoryapp.model.domain.AlarmDirection
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.domain.WantedRequest
import ch.brickinventoryapp.model.domain.WantedSort
import ch.brickinventoryapp.offline.Editing
import ch.brickinventoryapp.state.testing.TestServices
import ch.brickinventoryapp.state.testing.newProcess
import ch.brickinventoryapp.uistate.loading
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.TestCoroutineScheduler
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * The wishlist ViewModel, run against a PathServer without network. The waiting periods
 * (search pause, debounce of the price alert) run on the test clock.
 *
 * Counter-checks (measured 28.10.2026, kotlinc against WantedListViewModel.kt):
 *   A  in setWantedSearch() the writing to the SavedStateHandle removed
 *      → red “search, condition and sorting survive …”
 *   B  the search pause removed (load immediately) → red “the search waits out the pause
 *      and filters the store with the last text”
 *   C  in LocalApplication.sets the branch WantedItemAdopted removed → red
 *      “a takeover removes the wishlist item from the store and creates the set there”
 *   D  in the price alert the reload of the open item's alerts removed →
 *      red “a price alert on a wishlist item is saved debounced …”
 *   E  in loadWanted the source chosen without the search text → red “the list follows
 *      the store, filtered too” (99999-1 appears under „10294“)
 *   F  wantedState does not look at the source (counter-checks/wanted-list-without-store.patch)
 *      → red “list loaded”: the fetch only writes into the store.
 *   G  deleteWantedItem() deletes immediately on the server again
 *      (counter-checks/wanted-item-delete-immediately.patch) → red “a deleted wishlist item …”
 *      (“no DELETE yet”)
 *   H  deleteWantedItem() reads the name from the raw list instead of the shown one
 *      (counter-checks/wanted-item-name-without-store.patch) → red “a deleted wishlist item …”
 *      (Titanic expected, 10294-1 received; measurable only in the CI)
 *   wanted-list-does-not-load-on-show  (counter-checks/) observeLoadOn of the list removed
 *      → red “list and detail load as soon as someone shows them”
 */
@OptIn(ExperimentalCoroutinesApi::class)
class WantedViewModelTest {

    private val clock = TestCoroutineScheduler()
    private lateinit var paths: PathServer
    private lateinit var t: TestServices

    private fun vm(wanted: SavedStateHandle = SavedStateHandle(), t: TestServices = this.t) = t.track(WantedListViewModel(t.session, t.filter(), t.hints, t.wantedList(), t.alerts(), t.accountView,
        testCatalogRepository(t.api), testFinancesRepository(t.api), wanted))

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher(clock))
        paths = PathServer(
            "/api/v2/wanted" to """{"success":true,"item":[{"set_number":"10294-1","condition":"N","user_id":1}]}""",
            "/api/v2/wanted/10294-1/N/take-over" to """{"success":true,"action":"added","set_number":"10294-1"}""",
            "/api/v2/alerts" to """{"success":true,"alerts":[{"set_number":"10294-1","condition":"N","direction":"below","threshold":500.0}]}""",
            "/api/v2/sets/10294-1/alert" to """{"success":true,"alert":{"set_number":"10294-1","condition":"N","direction":"below","threshold":450.0}}""",
        )
        t = TestServices(paths.onTick(), io = Dispatchers.Main)
    }

    @After
    fun tearDown() {
        t.cleanUp()
        Dispatchers.resetMain()
        paths.server.shutdown()
    }

    @Test
    fun `a deleted wishlist item can be restored, deleting happens only afterwards`() {
        paths.responses["/api/v2/wanted"] = """{"success":true,"item":[
            {"set_number":"10294-1","condition":"N","user_id":1,"name":"Titanic"},
            {"set_number":"10305-1","condition":"N","user_id":1,"name":"Lion Knights' Castle"}]}"""
        paths.responses["/api/v2/wanted/10294-1/N"] = """{"success":true}"""
        val vm = vm()
        vm.loadWanted()
        assertEquals(2, vm.wantedState.value.wantedItem.size)
        vm.deleteWantedItem("10294-1", Condition.NEW, 1)
        assertTrue("out of the list", vm.wantedState.value.wantedItem.none { it.setNumber == "10294-1" })
        assertEquals("Titanic", vm.marked.value?.name)
        assertTrue("no DELETE yet", paths.requestsTo("DELETE /api/v2/wanted/10294-1").isEmpty())
        vm.wantedItemUndo()
        assertTrue("back again", vm.wantedState.value.wantedItem.any { it.setNumber == "10294-1" })
        assertTrue("no DELETE after undo", paths.requestsTo("DELETE /api/v2/wanted/10294-1").isEmpty())
        vm.deleteWantedItem("10294-1", Condition.NEW, 1)
        vm.executeWantedItemDelete()
        assertTrue("DELETE sent", paths.requestsTo("DELETE /api/v2/wanted/10294-1").isNotEmpty())
        assertEquals(null, vm.marked.value)
    }

    @Test
    fun `search, condition and sorting survive a process death and travel along`() {
        val wanted = SavedStateHandle()
        val first = vm(wanted)
        first.setWantedSearch("Titanic")
        first.setWantedState(Condition.USED)
        first.setWantedSorting(WantedSort.PRICE_DESCENDING)

        paths.newProcess(io = Dispatchers.Main) { paths, t ->
            paths.responses["/api/v2/wanted"] = """{"success":true,"item":[
                {"set_number":"10294-1","condition":"U","user_id":1,"name":"Titanic"},
                {"set_number":"10294-1","condition":"N","user_id":1,"name":"Titanic"}]}"""
            val newValue = vm(wanted, t)
            val f = newValue.wantedState.value
            assertEquals(Triple("Titanic", Condition.USED, WantedSort.PRICE_DESCENDING), Triple(f.query, f.stateFilter, f.sorting))
            newValue.loadWanted()
            // The filters apply to the store; the fetch fills it completely.
            assertEquals(listOf(Condition.USED), newValue.wantedState.value.wantedItem.map { it.condition })
            val request = paths.requestsTo("GET /api/v2/wanted").single()
            assertTrue(request, "search=" !in request && "condition=" !in request)
        }
    }

    @Test
    fun `the search waits for the pause and filters the store with the last text`() {
        paths.responses["/api/v2/wanted"] = """{"success":true,"item":[
            {"set_number":"10294-1","condition":"N","user_id":1,"name":"Titanic"},
            {"set_number":"21330-1","condition":"N","user_id":1,"name":"Tilt"}]}"""
        val vm = vm()
        vm.setWantedSearch("Ti")
        vm.setWantedSearch("Tita")
        clock.advanceTimeBy(300)
        assertEquals("nothing may go out before the pause", 0, paths.requestsTo("GET /api/v2/wanted").size)
        clock.advanceTimeBy(100)
        assertEquals(listOf("10294-1"), vm.wantedState.value.wantedItem.map { it.setNumber })
        assertEquals(1, paths.requestsTo("GET /api/v2/wanted").size)
    }

    @Test
    fun `a takeover removes the wishlist item from the store and creates the set there`() {
        val vm = vm()
        vm.loadWanted()
        assertTrue("List loaded", vm.wantedState.value.wantedItem.isNotEmpty())
        vm.adoptWantedItem("10294-1", Condition.NEW, owner = 1, purchasePriceRaw = "499,90")
        assertTrue("out of the watchlist", vm.wantedState.value.wantedItem.isEmpty())
        val gallery = runBlocking { t.sets().observeSets().first().list }
        assertEquals("in the gallery", listOf("10294-1"), gallery.map { it.setNumber })
        val takeover = paths.requestsTo("/take-over").single()
        assertTrue(takeover, takeover.startsWith("POST"))
    }

    @Test
    fun `list and detail load as soon as someone shows them`() {
        val vm = vm()
        assertTrue("no fetch without an observer", paths.requestsTo("GET /api/v2/wanted").isEmpty())
        val list = CoroutineScope(Dispatchers.Main).launch { vm.wantedState.collect {} }
        assertEquals(listOf("10294-1"), vm.wantedState.value.wantedItem.map { it.setNumber })
        list.cancel()
        val detail = vm.wantedItemDetailOf("10294-1")
        val page = CoroutineScope(Dispatchers.Main).launch { detail.collect {} }
        assertEquals("10294-1", detail.value.setNumber)
        assertTrue("alerts of the item fetched", paths.requestsTo("GET /api/v2/alerts").isNotEmpty())
        page.cancel()
    }

    @Test
    fun `a price alert in the wishlist item is saved debounced and reloaded`() {
        val vm = vm()
        vm.loadWantedItemDetail("10294-1")
        assertTrue("detail loaded", !vm.wantedItemDetailState.value.fetch.loading)
        assertEquals(Money.from(500.0), vm.wantedItemDetailState.value.priceAlarms.single().threshold)
        val before = paths.requestsTo("GET /api/v2/alerts").size

        vm.setPriceAlert("10294-1", AlarmDirection.BELOW, "4", Condition.NEW)
        vm.setPriceAlert("10294-1", AlarmDirection.BELOW, "450", Condition.NEW)
        // Saved, the server holds 450; the state reads the store only when loading,
        // without a reload it would stay at 500.
        paths.responses["/api/v2/alerts"] = """{"success":true,"alerts":[{"set_number":"10294-1","condition":"N","direction":"below","threshold":450.0}]}"""
        clock.advanceTimeBy(900)
        assertEquals("only the last input is saved", 1, paths.requestsTo("PUT /api/v2/sets/10294-1/alert").size)
        assertTrue("nachgeladen", paths.requestsTo("GET /api/v2/alerts").size > before)
        assertEquals("saved and reloaded", Money.from(450.0), vm.wantedItemDetailState.value.priceAlarms.single().threshold)
        val stored = runBlocking { t.alerts().observeAlerts("10294-1").first().list }
        assertEquals("in the store", listOf(Money.from(450.0)), stored.map { it.threshold })
    }

    @Test
    fun `the list follows the store, also filtered`() {
        val store = t.store
        val vm = vm()
        vm.loadWanted()
        assertTrue("List loaded", vm.wantedState.value.wantedItem.isNotEmpty())
        val fetches = paths.requestsTo("GET /api/v2/wanted").size

        runBlocking { store.applyChange(Editing.DeleteWantedItem("10294-1", Condition.NEW, 1)) }
        assertTrue("deleted offline", vm.wantedState.value.wantedItem.isEmpty())
        assertEquals("without a new fetch", fetches, paths.requestsTo("GET /api/v2/wanted").size)

        vm.setWantedSearch("10294")
        clock.advanceTimeBy(400)
        assertTrue("search loaded", vm.wantedState.value.wantedItem.isNotEmpty())
        runBlocking { store.applyChange(Editing.CreateWantedItem(WantedRequest("99999-1", Condition.NEW, 1))) }
        runBlocking { store.applyChange(Editing.CreateWantedItem(WantedRequest("10294-1", Condition.USED, 1))) }
        clock.advanceTimeBy(100)
        assertEquals("the search also filters what was created offline", listOf("10294-1|U", "10294-1|N"),
            vm.wantedState.value.wantedItem.map { "${it.setNumber}|${it.condition.identifier}" })
    }
}
