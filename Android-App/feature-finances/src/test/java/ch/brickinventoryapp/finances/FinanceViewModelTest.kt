package ch.brickinventoryapp.finances

import kotlinx.coroutines.launch
import kotlinx.coroutines.CoroutineScope
import ch.brickinventoryapp.model.ui.laedt
import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.model.domain.Waehrung
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.testing.testFinancesRepository
import kotlinx.coroutines.runBlocking
import ch.brickinventoryapp.finances.ui.viewmodel.FinanceViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import ch.brickinventoryapp.testing.PfadServer
import ch.brickinventoryapp.testing.TestDienste

/**
 * The finance ViewModel, run against a PfadServer without network.
 *
 * Counter-checks (measured 28.10.2026, kotlinc against FinanceViewModel.kt):
 *   A  in toggleFinanceCategory() the writing to the SavedStateHandle
 *      removed → red “row kinds and period survive …”
 *   B  in init the collecting of `changes.inventoryChanged()` removed → red “a change
 *      to the store's stock reloads the valuation”
 *   C  in afterFilter() the condition reversed for FINANCE → red “the
 *      tab's account filter travels along …”
 *   D  in zuruecksetzen() the clearing of the state removed → red “after
 *      signing out nothing is left”
 *   finanzen-laden-ohne-verlauf  only the valuation loaded when observed → red “whoever
 *      opens finances …”
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FinanceViewModelTest {

    private lateinit var paths: PfadServer
    private lateinit var t: TestDienste

    private fun vm(gemerkt: SavedStateHandle = SavedStateHandle()) =
        t.merke(FinanceViewModel(t.sitzung, t.filter(), t.hinweise, t.changes, testFinancesRepository(t.api), gemerkt))

    @Before
    fun auf() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        paths = PfadServer(
            "/api/v1/finance/valuation" to """{"success":true,"currency":"CHF","sets":[
                {"set_number":"75192-1","name":"Falke"}]}""",
            "/api/v1/finance/portfolio-history" to """{"success":true,"period":"month","points":[]}""",
            // Fully via DTO: if the parsing throws, Retrofit passes the error on via
            // Dispatchers.Default, and the test no longer runs in lockstep.
            "/api/v1/finance/parts-valuation" to """{"success":true,"total_value":"0.00","parts":[]}""",
            "/api/v1/finance/minifigs-valuation" to """{"success":true,"total_value":"0.00","figs":[]}""",
        )
        t = TestDienste(paths.imTakt(), io = Dispatchers.Main)
    }

    @After
    fun zu() {
        t.aufraeumen()
        Dispatchers.resetMain()
        paths.server.shutdown()
    }

    @Test
    fun `row kinds and period survive a process death`() {
        val gemerkt = SavedStateHandle()
        val erstes = vm(gemerkt)
        erstes.toggleFinanceCategory("parts")
        erstes.loadPortfolioHistory("month")
        assertTrue("Verlauf geladen", !erstes.financeState.value.verlauf.laedt)

        val neu = vm(gemerkt).financeState.value
        assertEquals(setOf("parts"), neu.kategorien)
        assertEquals("month", neu.historyPeriod)
    }

    @Test
    fun `whoever sees the finances loads valuation and history, the valuation once`() {
        val vm = vm()
        assertTrue("Ohne Beobachter wird nichts geholt", paths.requestsAn("/finance/").isEmpty())
        val view = CoroutineScope(Dispatchers.Main).launch { vm.financeState.collect {} }
        view.cancel()
        CoroutineScope(Dispatchers.Main).launch { vm.financeState.collect {} }.cancel()
        assertEquals(1, paths.requestsAn("/finance/valuation").size)
        assertTrue("Der Verlauf kommt mit", paths.requestsAn("/finance/portfolio-history").isNotEmpty())
    }

    @Test
    fun `a change of the stock in the store reloads the valuation`() {
        paths.antworten["/api/v1/sets"] = """{"success":true,"total":1,"sets":[{"set_number":"75192-1","name":"Falke"}]}"""
        val vm = vm()
        // A different area fetches the sets into the store; the valuation follows it.
        runBlocking { t.sets().aktualisiereSets() }
        assertTrue("Bewertung geladen", vm.financeState.value.valuation != null)
        assertEquals("75192-1", vm.financeState.value.valuation?.sets?.single()?.setNumber)
        assertEquals("Die Währung des Kontos gilt für die ganze App", Waehrung.CHF, t.sitzung.state.value.currency)
    }

    @Test
    fun `the tab's account filter travels along and reloads valuation and history`() {
        val vm = vm()
        vm.setScope(ScopeFilter.View.FINANCE, "own")
        assertTrue("beide Abrufe", paths.requestsAn("/finance/valuation").isNotEmpty() && paths.requestsAn("/portfolio-history").isNotEmpty())
        assertTrue(paths.requestsAn("/finance/valuation").single().contains("accounts=own"))
        assertTrue(paths.requestsAn("/portfolio-history").single().contains("accounts=own"))

        // The filter of a DIFFERENT view loads nothing here.
        assertTrue("Bewertung vollständig", paths.requestsAn("/finance/pnl").isNotEmpty())
        val vorher = paths.requests.size
        vm.setScope(ScopeFilter.View.GALLERY, "own")
        assertEquals(vorher, paths.requests.size)
    }

    @Test
    fun `after sign-out nothing is left`() {
        val vm = vm()
        vm.loadValuation()
        vm.toggleFinanceCategory("sets")
        assertTrue("Bewertung geladen", vm.financeState.value.valuation != null)
        t.sitzung.abgemeldet()
        assertNull(vm.financeState.value.valuation)
        assertTrue(vm.financeState.value.kategorien.isEmpty())
    }
}
