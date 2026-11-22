package ch.brickinventoryapp.state

import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.CoroutineScope
import ch.brickinventoryapp.contract.mapping.asView
import ch.brickinventoryapp.model.ui.loading
import ch.brickinventoryapp.model.domain.ItemKind
import ch.brickinventoryapp.testing.testMinifigsRepository
import ch.brickinventoryapp.testing.testFinancesRepository
import ch.brickinventoryapp.testing.testPartsRepository
import ch.brickinventoryapp.contract.SetItem
import ch.brickinventoryapp.offline.Slots
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import ch.brickinventoryapp.state.ui.viewmodel.PurchasesViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
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
import ch.brickinventoryapp.testing.PathServer
import ch.brickinventoryapp.testing.TestServices
import ch.brickinventoryapp.testing.text

/**
 * The purchases ViewModel (sets, manual parts and figures), run against
 * a PathServer without a network.
 *
 * Counter-checks (measured 28.10.2026, kotlinc against PurchasesViewModel.kt):
 *   A  in setChanged() the summary not taken over (always fetches the whole inventory
 *      instead) → red „ein geänderter Kauf eines Sets schreibt seine Zusammenfassung …“
 *   B  on a rejected date change, doesn't reload → red „eine
 *      abgelehnte Datumsänderung lädt die Liste neu“
 *   C  on an owner change, the response's numbers replaced with 0, or dropped the catching-up
 *      of the store → red „ein Besitzerwechsel meldet die mitgewanderten Teile …“
 *   D  in load() left another entry's history standing → red
 *      „the price history of another entry does not stay“
 *   E  in changeForPiece() `purchasePrice = price` instead of
 *      `unitPrice = price` → red „ein Set schickt purchase_price, Teile und
 *      Figuren unit_price“ (part)
 *   F  in HouseholdRepository.updateAcquisition() changeForPiece instead of changeForSet →
 *      red at the same spot (set)
 *   G  in updateManualAcquisition() the body built by hand,
 *      `UpdateAcquisitionRequest(purchasePrice = unitPrice, …)` → red at
 *      the same spot (part)
 *   H  in loadManualPriceHistory() always getPartPriceHistory
 *      (counter-checks/kaeufe-verlauf-nur-teile.patch) → red „der Preisverlauf kommt für
 *      Teile und Figuren …“ (figure without history; only measurable in CI)
 *   kaeufe-laden-nicht-beim-zeigen  (counter-checks/) purchasesOf without a fetch on the first observer
 *      → red „die Kaeufe eines Eintrags laden, sobald …“
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PurchasesViewModelTest {

    private val clock = TestCoroutineScheduler()
    private lateinit var paths: PathServer
    private lateinit var t: TestServices

    private fun vm() = t.track(PurchasesViewModel(t.session, t.filter(), t.hints, t.changes, t.household(), t.sets(),
        testFinancesRepository(t.api), testPartsRepository(t.api), testMinifigsRepository(t.api)))

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher(clock))
        paths = PathServer(
            "/api/v1/sets/75192-1/acquisitions" to """{"success":true,"acquisitions":[{"id":7,"quantity":1}]}""",
            "/api/v1/sets/75192-1/acquisitions/7" to """{"success":true,"set":{"set_number":"75192-1","used_count":1},
                "parts":12,"minifigs":2}""",
            "/api/v1/parts/3001/5/acquisitions" to """{"success":true,"acquisitions":[{"id":9,"quantity":4}]}""",
            "/api/v1/parts/3001/5/price-history" to """{"success":true,"set_number":"3001"}""",
            "/api/v1/minifigs/sw0001/price-history" to """{"success":true,"set_number":"sw0001"}""",
            "/api/v1/parts/3002/5/acquisitions" to """{"success":true,"acquisitions":[]}""",
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
    fun `a changed purchase of a set writes its summary into the store and reloads the list`() {
        runBlocking { t.store.adopt(Slots.SETS, listOf(SetItem(setNumber = "75192-1", usedCount = 0)).map { it.asView() }) }
        val vm = vm()
        vm.loadAcquisitions("75192-1")
        assertTrue("Liste geladen", vm.manDetailState.value.acquisitions.isNotEmpty())
        val before = paths.requestsTo("GET /api/v1/sets/75192-1/acquisitions").size
        vm.updateAcquisition("75192-1", 7, purchasePrice = 499.0)
        assertTrue("neu geladen", paths.requestsTo("GET /api/v1/sets/75192-1/acquisitions").size > before)
        val tile = runBlocking { t.sets().observeSets().first().list.single() }
        assertEquals("die Kachel der Galerie liest die Zusammenfassung", 1, tile.usedCount)
        assertTrue("ohne den ganzen Bestand neu zu holen", paths.requestsTo("GET /api/v1/sets?").isEmpty())
    }

    @Test
    fun `the purchases of an entry load as soon as its page shows them`() {
        val vm = vm()
        val condition = vm.purchasesOf(ItemKind.PART, "3001", 5)
        assertTrue("ohne Beobachter kein Abruf", paths.requestsTo("GET /api/v1/parts/3001/5/acquisitions").isEmpty())
        val page = CoroutineScope(Dispatchers.Main).launch { condition.collect {} }
        assertEquals(listOf(9), condition.value.acquisitions.map { it.id })
        page.cancel()
        val set = CoroutineScope(Dispatchers.Main).launch { vm.purchasesOf(ItemKind.SET, "75192-1", 0).collect {} }
        assertTrue("ein Set fragt seine Käufe", paths.requestsTo("GET /api/v1/sets/75192-1/acquisitions").isNotEmpty())
        set.cancel()
    }

    @Test
    fun `a rejected date change reloads the list`() {
        paths.codes["/api/v1/parts/3001/5/acquisitions/9"] = 409
        val vm = vm()
        vm.loadManualAcquisitions(ItemKind.PART, "3001", 5)
        assertTrue("Liste geladen", vm.manDetailState.value.acquisitions.isNotEmpty())
        val before = paths.requestsTo("GET /api/v1/parts/3001/5/acquisitions").size
        vm.updateManualAcquisition(ItemKind.PART, "3001", 5, 9, date = "2020-01-01")
        assertTrue("neu geladen", paths.requestsTo("GET /api/v1/parts/3001/5/acquisitions").size > before)
        assertEquals("fehler", t.messages.text)
    }

    @Test
    fun `an owner change reports the parts and figures that moved along`() {
        val vm = vm()
        var outcome: Triple<String?, Int, Int>? = null
        vm.changeAcquisitionOwner(ItemKind.SET, "75192-1", 0, 7, toUserId = 4) { f, parts, figures ->
            outcome = Triple(f, parts, figures)
        }
        assertTrue("Antwort", outcome != null)
        assertEquals(Triple(null, 12, 2), outcome)
        // Moved along: the store fetches the state of all three lists from the server.
        for (path in listOf("GET /api/v1/sets?", "GET /api/v1/parts?", "GET /api/v1/minifigs?")) {
            assertTrue(path, paths.requestsTo(path).isNotEmpty())
        }
        assertTrue(paths.requestsTo("PUT /api/v1/sets/75192-1/acquisitions/7").isNotEmpty())
    }

    /** The body of the first request, whose row contains [request]. */
    private fun body(request: String): String {
        val i = paths.requests.indexOfFirst { request in it }
        assertTrue(request, i >= 0)
        return paths.bodyBytes[i]
    }

    /** BrickJson also serializes null; „set“ means: the field carries a number. */
    private fun set(field: String, json: String) = Regex("\"$field\":[0-9]").containsMatchIn(json)

    @Test
    fun `a set sends purchase_price, parts and figures unit_price`() {
        // The server reads the price field under the name of its column; under
        // the wrong name, it leaves the price silently unchanged.
        val vm = vm()
        vm.updateAcquisition("75192-1", 7, purchasePrice = 499.0)
        val set = body("PUT /api/v1/sets/75192-1/acquisitions/7")
        assertTrue("Set: $set", "\"purchase_price\":499.0" in set && !set("unit_price", set))

        vm.updateManualAcquisition(ItemKind.PART, "3001", 5, 9, unitPrice = 0.25)
        val part = body("PUT /api/v1/parts/3001/5/acquisitions/9")
        assertTrue("Teil: $part", "\"unit_price\":0.25" in part && !set("purchase_price", part))

        vm.updateManualAcquisition(ItemKind.FIG, "sw0001", 0, 3, unitPrice = 12.0)
        val figure = body("PUT /api/v1/minifigs/sw0001/acquisitions/3")
        assertTrue("Figur: $figure", "\"unit_price\":12.0" in figure && !set("purchase_price", figure))
    }

    @Test
    fun `the price history of another entry does not stay`() {
        val vm = vm()
        vm.loadManualAcquisitions(ItemKind.PART, "3001", 5)
        assertTrue("Verlauf geladen", vm.manDetailState.value.priceHistory != null)
        // 3002 has no history on the test server: it stays empty, instead of
        // keeping on showing 3001's.
        vm.loadManualAcquisitions(ItemKind.PART, "3002", 5)
        assertTrue("Liste von 3002", vm.manDetailState.value.itemId == "3002" && !vm.manDetailState.value.purchasesFetch.loading && !vm.manDetailState.value.historyFetch.loading)
        assertNull(vm.manDetailState.value.priceHistory)
    }

    @Test
    fun `the price history for parts and figures comes from the matching path`() {
        val vm = vm()
        vm.loadManualPriceHistory(ItemKind.FIG, "sw0001")
        assertTrue("Figur ohne Verlauf", vm.manDetailState.value.priceHistory != null)
        vm.loadManualPriceHistory(ItemKind.PART, "3001", 5)
        assertTrue("Teil ohne Verlauf", vm.manDetailState.value.priceHistory != null)
        assertEquals(1, paths.requestsTo("/api/v1/minifigs/sw0001/price-history").size)
        assertEquals(1, paths.requestsTo("/api/v1/parts/3001/5/price-history").size)
    }
}
