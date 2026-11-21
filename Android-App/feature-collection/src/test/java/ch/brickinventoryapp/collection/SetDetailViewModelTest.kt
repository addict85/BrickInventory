package ch.brickinventoryapp.collection

import ch.brickinventoryapp.model.domain.Setzusammenfassung
import ch.brickinventoryapp.contract.mapping.alsAnsicht
import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.ui.errorMessage
import ch.brickinventoryapp.model.ui.errorKind
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.offline.Offlineablage.FollowUp
import ch.brickinventoryapp.model.domain.Alarmrichtung
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.model.ui.Fehlerklasse
import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.testing.testFinancesRepository
import ch.brickinventoryapp.testing.testHouseholdRepository
import ch.brickinventoryapp.contract.SetItem
import ch.brickinventoryapp.offline.Slots
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import ch.brickinventoryapp.model.file.FileReader
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.collection.ui.viewmodel.SetDetailViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestCoroutineScheduler
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import ch.brickinventoryapp.testing.PfadServer
import ch.brickinventoryapp.testing.TestDienste

/**
 * The set detail ViewModel, run against a PfadServer without network.
 *
 * Counter-checks (measured 28.10.2026, kotlinc against SetDetailViewModel.kt):
 *   A  setNumber not from the SavedStateHandle, but "" → all four red,
 *      first “the set comes from the SavedStateHandle …”
 *   B  in SetsRepositoryImpl.setQuantity `r.quantity ?: quantity` replaced
 *      with `quantity` → red “a changed quantity appears right away, there and in the store” (5 instead of 3)
 *   C  in the init of SetDetailViewModel `firstOrNull { it.setNumber == setNumber }`
 *      replaced with the whole list → red “a changed purchase of a different set loads nothing here”
 *   D  in the price alert input `gespeichert` left empty → red “a saved
 *      price alert is loaded anew”
 *   E  in changeQuantityUm() back to UpdateQuantityRequest(quantity = schritt)
 *      → red “the slider sends a step …”
 *   F  `init { refresh() }` removed (the screen used to load itself)
 *      → red “the set comes from the SavedStateHandle and everything is loaded on creation”
 *   G  in starte() the cancelling of the running fetch removed
 *      → red “a new fetch cancels the running one of the same section” (2 instead of 1)
 *   H  in loadPrice() and loadHistory() the error discarded again
 *      → red “if price and history fail, the error stands in the state …”
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SetDetailViewModelTest {

    private val clock = TestCoroutineScheduler()
    private lateinit var paths: PfadServer
    private lateinit var t: TestDienste

    private val noReader = object : FileReader { override suspend fun lies(datei: FileRef): Pair<String?, ByteArray>? = null }

    private fun vm(setNumber: String = "75192-1") = t.merke(SetDetailViewModel(t.sitzung, t.filter(), t.hinweise, t.sets(), t.setCatalog(), t.alerts(), t.setFiles(),
        testFinancesRepository(t.api), testHouseholdRepository(t.api), noReader,
        SavedStateHandle(mapOf("setNumber" to setNumber))))

    @Before
    fun auf() {
        Dispatchers.setMain(UnconfinedTestDispatcher(clock))
        paths = PfadServer(
            "/api/v1/sets/75192-1" to """{"success":true,"quantity":3,"set":{"set_number":"75192-1","name":"Falke","quantity":2}}""",
            "/api/v1/sets/75192-1/price" to """{"success":true,"set_number":"75192-1"}""",
            "/api/v1/sets/75192-1/price-history" to """{"success":true,"set_number":"75192-1"}""",
            "/api/v1/sets/75192-1/acquisitions" to """{"success":true,"acquisitions":[{"id":1,"quantity":2}]}""",
            "/api/v1/alerts" to """{"success":true,"alerts":[]}""",
            "/api/v1/sets/75192-1/alert" to """{"success":true,"alert":{"set_number":"75192-1","condition":"N","direction":"unter","threshold":450.0}}""",
        )
        t = TestDienste(paths.imTakt(), io = Dispatchers.Main)
    }

    @After
    fun zu() {
        t.aufraeumen()
        Dispatchers.resetMain()
        paths.server.shutdown()
    }

    /**
     * After the PUT the server has 3; the reload after the message must deliver the same
     * number, otherwise it overwrites the 3 before the test sees it.
     */
    private fun serverHatAfterwardsThree() {
        paths.antworten["/api/v1/sets/75192-1"] =
            """{"success":true,"quantity":3,"set":{"set_number":"75192-1","name":"Falke","quantity":3}}"""
    }

    private fun geladen(vm: SetDetailViewModel) = assertTrue("Detail geladen", vm.setDetailState.value.setDetail != null && vm.setDetailState.value.acquisitions.isNotEmpty())

    @Test
    fun `the set comes from the SavedStateHandle and everything is loaded on creation`() {
        val vm = vm()
        assertEquals("75192-1", vm.setNumber)
        geladen(vm)
        // The alerts arrive in the store via the account overview, not per set.
        assertTrue("alle fünf Abrufe", listOf("/75192-1/price-history", "/75192-1/price?", "GET /api/v1/alerts").all { p -> paths.requests.any { p.removeSuffix("?") in it } })
        assertEquals("Falke", vm.setDetailState.value.setDetail?.name)
    }

    @Test
    fun `a changed quantity is shown immediately and in the store`() {
        runBlocking { t.ablage.adopt(Slots.SETS, listOf(SetItem(setNumber = "75192-1", quantity = 1)).map { it.alsAnsicht() }) }
        val vm = vm()
        geladen(vm)
        serverHatAfterwardsThree()
        // Wanted 5, the server caps it to 3 (someone else's copies cannot
        // be taken away): its number applies, not the client's own assumption.
        vm.setQuantity("75192-1", 5)
        assertTrue("Menge da", vm.setDetailState.value.setDetail?.quantity == 3)
        val abgelegt = runBlocking { t.sets().observeSets().first().liste.single() }
        assertEquals("die Galerie liest dieselbe Zahl aus der Ablage", 3, abgelegt.quantity)
        assertTrue(paths.requestsAn("PUT /api/v1/sets/75192-1").isNotEmpty())
    }

    @Test
    fun `the control sends a step, not a target number`() {
        val vm = vm()
        geladen(vm)
        serverHatAfterwardsThree()
        vm.changeQuantityUm("75192-1", -1)
        assertTrue("PUT gesendet", paths.requestsAn("PUT /api/v1/sets/75192-1").isNotEmpty())
        val i = paths.requests.indexOfFirst { "PUT /api/v1/sets/75192-1" in it }
        val rumpf = paths.koerper[i]
        assertTrue(rumpf, "\"quantity_delta\":-1" in rumpf)
        assertTrue(rumpf, "\"quantity\":" !in rumpf)
        assertTrue("Menge vom Server", vm.setDetailState.value.setDetail?.quantity == 3)
    }

    @Test
    fun `a changed purchase of another set loads nothing here, one of this set does`() {
        runBlocking { t.ablage.adopt(Slots.SETS, listOf(SetItem(setNumber = "75192-1"), SetItem(setNumber = "10294-1")).map { it.alsAnsicht() }) }
        val vm = vm()
        geladen(vm)
        val vorher = paths.requestsAn("GET /api/v1/sets/75192-1/acquisitions").size

        // This is how HouseholdRepository writes the server's summary into the store.
        runBlocking { t.ablage.applyAn(FollowUp.SetSummary(Setzusammenfassung(setNumber = "10294-1", zustand = Zustand.GEBRAUCHT, states = listOf(Zustand.GEBRAUCHT), gebraucht = 1,
            highestPurchasePrice = null, purchasePriceCut = null))) }
        assertEquals(vorher, paths.requestsAn("GET /api/v1/sets/75192-1/acquisitions").size)

        runBlocking { t.ablage.applyAn(FollowUp.SetSummary(Setzusammenfassung(setNumber = "75192-1", zustand = Zustand.GEBRAUCHT, states = listOf(Zustand.GEBRAUCHT), gebraucht = 1,
            highestPurchasePrice = null, purchasePriceCut = null))) }
        assertTrue("neu geladen", paths.requestsAn("GET /api/v1/sets/75192-1/acquisitions").size > vorher)
    }

    @Test
    fun `a saved price alert is reloaded`() {
        val vm = vm()
        geladen(vm)
        assertTrue(vm.setDetailState.value.preisalarme.isEmpty())
        val vorher = paths.requestsAn("GET /api/v1/alerts").size
        vm.setPriceAlert("75192-1", Alarmrichtung.UNTER, "450", Zustand.NEU)
        paths.antworten["/api/v1/alerts"] = """{"success":true,"alerts":[{"set_number":"75192-1","condition":"N","direction":"unter","threshold":450.0}]}"""
        clock.advanceTimeBy(900)
        assertEquals(1, paths.requestsAn("PUT /api/v1/sets/75192-1/alert").size)
        // The state reads the store only when loading: without a reload it would stay empty.
        assertTrue("neu geladen", paths.requestsAn("GET /api/v1/alerts").size > vorher)
        assertEquals(listOf(Geld.aus(450.0)), vm.setDetailState.value.preisalarme.map { it.schwelle })
    }

    private fun priceFetches() = paths.requests.count { Regex("""^GET /api/v1/sets/75192-1/price(\?|$)""").containsMatchIn(it) }

    @Test
    fun `a new fetch cancels the running one of the same section`() {
        paths.ausbleibend += "/api/v1/sets/75192-1/price"
        val vm = vm()
        vm.refresh()
        paths.freigeben()
        // The first fetch is cancelled and gets no answer anymore; only the second one arrives.
        assertEquals(1, priceFetches())
        assertTrue("Preis da", vm.setDetailState.value.setPrice != null)
        assertEquals(false, vm.setDetailState.value.priceFetch.laedt)
    }

    @Test
    fun `if price and history fail, the error is in the state until a new fetch succeeds`() {
        paths.codes["/api/v1/sets/75192-1/price"] = 500
        paths.codes["/api/v1/sets/75192-1/price-history"] = 500
        val vm = vm()
        geladen(vm)
        assertTrue(vm.setDetailState.value.priceFetch is Laden.Fehler)
        assertTrue(vm.setDetailState.value.historyFetch is Laden.Fehler)
        assertEquals(Fehlerklasse.SERVER, vm.setDetailState.value.priceFetch.errorKind)

        paths.codes.clear()
        vm.refresh()
        assertEquals(null, vm.setDetailState.value.priceFetch.errorMessage)
        assertEquals(null, vm.setDetailState.value.historyFetch.errorMessage)
        assertTrue("Preis da", vm.setDetailState.value.setPrice != null)
    }
}
