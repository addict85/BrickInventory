package ch.brickinventoryapp.collection

import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.collection.ui.viewmodel.SetDetailViewModel
import ch.brickinventoryapp.contract.SetItem
import ch.brickinventoryapp.contract.mapping.asView
import ch.brickinventoryapp.data.testing.PathServer
import ch.brickinventoryapp.data.testing.testFinancesRepository
import ch.brickinventoryapp.data.testing.testHouseholdRepository
import ch.brickinventoryapp.model.domain.AlarmDirection
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.domain.SetTotals
import ch.brickinventoryapp.model.file.FileReader
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.model.ui.ErrorClass
import ch.brickinventoryapp.model.ui.Load
import ch.brickinventoryapp.model.ui.errorKind
import ch.brickinventoryapp.model.ui.errorMessage
import ch.brickinventoryapp.model.ui.loading
import ch.brickinventoryapp.offline.OfflineStore.FollowUp
import ch.brickinventoryapp.offline.Slots
import ch.brickinventoryapp.state.testing.TestServices
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
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
 * The set detail ViewModel, run against a PathServer without network.
 *
 * Counter-checks (measured 28.10.2026, kotlinc against SetDetailViewModel.kt):
 *   A  setNumber not from the SavedStateHandle, but "" → all four red,
 *      first “the set comes from the SavedStateHandle …”
 *   B  in SetsRepositoryImpl.setQuantity `r.quantity ?: quantity` replaced
 *      with `quantity` → red “a changed quantity appears right away, there and in the store” (5 instead of 3)
 *   C  in the init of SetDetailViewModel `firstOrNull { it.setNumber == setNumber }`
 *      replaced with the whole list → red “a changed purchase of a different set loads nothing here”
 *   D  in the price alert input `saved` left empty → red “a saved
 *      price alert is loaded anew”
 *   E  in changeQuantityBy() back to UpdateQuantityRequest(quantity = step)
 *      → red “the slider sends a step …”
 *   F  `init { refresh() }` removed (the screen used to load itself)
 *      → red “the set comes from the SavedStateHandle and everything is loaded on creation”
 *   G  in launch() the cancelling of the running fetch removed
 *      → red “a new fetch cancels the running one of the same section” (2 instead of 1)
 *   H  in loadPrice() and loadHistory() the error discarded again
 *      → red “if price and history fail, the error stands in the state …”
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SetDetailViewModelTest {

    private val clock = TestCoroutineScheduler()
    private lateinit var paths: PathServer
    private lateinit var t: TestServices

    private val noReader = object : FileReader { override suspend fun read(file: FileRef): Pair<String?, ByteArray>? = null }

    private fun vm(setNumber: String = "75192-1") = t.track(SetDetailViewModel(t.session, t.filter(), t.hints, t.sets(), t.setCatalog(), t.alerts(), t.setFiles(),
        testFinancesRepository(t.api), testHouseholdRepository(t.api), noReader,
        SavedStateHandle(mapOf("setNumber" to setNumber))))

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher(clock))
        paths = PathServer(
            "/api/v1/sets/75192-1" to """{"success":true,"quantity":3,"set":{"set_number":"75192-1","name":"Falke","quantity":2}}""",
            "/api/v1/sets/75192-1/price" to """{"success":true,"set_number":"75192-1"}""",
            "/api/v1/sets/75192-1/price-history" to """{"success":true,"set_number":"75192-1"}""",
            "/api/v1/sets/75192-1/acquisitions" to """{"success":true,"acquisitions":[{"id":1,"quantity":2}]}""",
            "/api/v1/alerts" to """{"success":true,"alerts":[]}""",
            "/api/v1/sets/75192-1/alert" to """{"success":true,"alert":{"set_number":"75192-1","condition":"N","direction":"unter","threshold":450.0}}""",
        )
        t = TestServices(paths.onTick(), io = Dispatchers.Main)
    }

    @After
    fun tearDown() {
        t.cleanUp()
        Dispatchers.resetMain()
        paths.server.shutdown()
    }

    /**
     * After the PUT the server has 3; the reload after the message must deliver the same
     * number, otherwise it overwrites the 3 before the test sees it.
     */
    private fun serverHasThreeAfterwards() {
        paths.responses["/api/v1/sets/75192-1"] =
            """{"success":true,"quantity":3,"set":{"set_number":"75192-1","name":"Falke","quantity":3}}"""
    }

    private fun loaded(vm: SetDetailViewModel) = assertTrue("Detail geladen", vm.setDetailState.value.setDetail != null && vm.setDetailState.value.acquisitions.isNotEmpty())

    @Test
    fun `the set comes from the SavedStateHandle and everything is loaded on creation`() {
        val vm = vm()
        assertEquals("75192-1", vm.setNumber)
        loaded(vm)
        // The alerts arrive in the store via the account overview, not per set.
        assertTrue("alle fünf Abrufe", listOf("/75192-1/price-history", "/75192-1/price?", "GET /api/v1/alerts").all { p -> paths.requests.any { p.removeSuffix("?") in it } })
        assertEquals("Falke", vm.setDetailState.value.setDetail?.name)
    }

    @Test
    fun `a changed quantity is shown immediately and in the store`() {
        runBlocking { t.store.adopt(Slots.SETS, listOf(SetItem(setNumber = "75192-1", quantity = 1)).map { it.asView() }) }
        val vm = vm()
        loaded(vm)
        serverHasThreeAfterwards()
        // Wanted 5, the server caps it to 3 (someone else's copies cannot
        // be taken away): its number applies, not the client's own assumption.
        vm.setQuantity("75192-1", 5)
        assertTrue("Menge da", vm.setDetailState.value.setDetail?.quantity == 3)
        val stored = runBlocking { t.sets().observeSets().first().list.single() }
        assertEquals("die Galerie liest dieselbe Zahl aus der Ablage", 3, stored.quantity)
        assertTrue(paths.requestsTo("PUT /api/v1/sets/75192-1").isNotEmpty())
    }

    @Test
    fun `the control sends a step, not a target number`() {
        val vm = vm()
        loaded(vm)
        serverHasThreeAfterwards()
        vm.changeQuantityBy("75192-1", -1)
        assertTrue("PUT gesendet", paths.requestsTo("PUT /api/v1/sets/75192-1").isNotEmpty())
        val i = paths.requests.indexOfFirst { "PUT /api/v1/sets/75192-1" in it }
        val body = paths.bodyBytes[i]
        assertTrue(body, "\"quantity_delta\":-1" in body)
        assertTrue(body, "\"quantity\":" !in body)
        assertTrue("Menge vom Server", vm.setDetailState.value.setDetail?.quantity == 3)
    }

    @Test
    fun `a changed purchase of another set loads nothing here, one of this set does`() {
        runBlocking { t.store.adopt(Slots.SETS, listOf(SetItem(setNumber = "75192-1"), SetItem(setNumber = "10294-1")).map { it.asView() }) }
        val vm = vm()
        loaded(vm)
        val before = paths.requestsTo("GET /api/v1/sets/75192-1/acquisitions").size

        // This is how HouseholdRepository writes the server's summary into the store.
        runBlocking { t.store.applyChange(FollowUp.SetSummary(SetTotals(setNumber = "10294-1", condition = Condition.USED, states = listOf(Condition.USED), used = 1,
            highestPurchasePrice = null, purchasePriceCut = null))) }
        assertEquals(before, paths.requestsTo("GET /api/v1/sets/75192-1/acquisitions").size)

        runBlocking { t.store.applyChange(FollowUp.SetSummary(SetTotals(setNumber = "75192-1", condition = Condition.USED, states = listOf(Condition.USED), used = 1,
            highestPurchasePrice = null, purchasePriceCut = null))) }
        assertTrue("neu geladen", paths.requestsTo("GET /api/v1/sets/75192-1/acquisitions").size > before)
    }

    @Test
    fun `a saved price alert is reloaded`() {
        val vm = vm()
        loaded(vm)
        assertTrue(vm.setDetailState.value.priceAlarms.isEmpty())
        val before = paths.requestsTo("GET /api/v1/alerts").size
        vm.setPriceAlert("75192-1", AlarmDirection.BELOW, "450", Condition.NEW)
        paths.responses["/api/v1/alerts"] = """{"success":true,"alerts":[{"set_number":"75192-1","condition":"N","direction":"unter","threshold":450.0}]}"""
        clock.advanceTimeBy(900)
        assertEquals(1, paths.requestsTo("PUT /api/v1/sets/75192-1/alert").size)
        // The state reads the store only when loading: without a reload it would stay empty.
        assertTrue("neu geladen", paths.requestsTo("GET /api/v1/alerts").size > before)
        assertEquals(listOf(Money.from(450.0)), vm.setDetailState.value.priceAlarms.map { it.threshold })
    }

    private fun priceFetches() = paths.requests.count { Regex("""^GET /api/v1/sets/75192-1/price(\?|$)""").containsMatchIn(it) }

    @Test
    fun `a new fetch cancels the running one of the same section`() {
        paths.missing += "/api/v1/sets/75192-1/price"
        val vm = vm()
        vm.refresh()
        paths.release()
        // The first fetch is cancelled and gets no answer anymore; only the second one arrives.
        assertEquals(1, priceFetches())
        assertTrue("Preis da", vm.setDetailState.value.setPrice != null)
        assertEquals(false, vm.setDetailState.value.priceFetch.loading)
    }

    @Test
    fun `if price and history fail, the error is in the state until a new fetch succeeds`() {
        paths.codes["/api/v1/sets/75192-1/price"] = 500
        paths.codes["/api/v1/sets/75192-1/price-history"] = 500
        val vm = vm()
        loaded(vm)
        assertTrue(vm.setDetailState.value.priceFetch is Load.Failure)
        assertTrue(vm.setDetailState.value.historyFetch is Load.Failure)
        assertEquals(ErrorClass.SERVER, vm.setDetailState.value.priceFetch.errorKind)

        paths.codes.clear()
        vm.refresh()
        assertEquals(null, vm.setDetailState.value.priceFetch.errorMessage)
        assertEquals(null, vm.setDetailState.value.historyFetch.errorMessage)
        assertTrue("Preis da", vm.setDetailState.value.setPrice != null)
    }
}
