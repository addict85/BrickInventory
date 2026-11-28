package ch.brickinventoryapp.finances

import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.data.testing.PathServer
import ch.brickinventoryapp.data.testing.testFinancesRepository
import ch.brickinventoryapp.finances.ui.viewmodel.FinanceViewModel
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.state.testing.TestServices
import ch.brickinventoryapp.uistate.loading
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
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
 * The finance ViewModel, run against a PathServer without network.
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
 *   finances-load-without-history  only the valuation loaded when observed → red “whoever
 *      opens finances …”
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FinanceViewModelTest {

    private lateinit var paths: PathServer
    private lateinit var t: TestServices

    private fun vm(wanted: SavedStateHandle = SavedStateHandle()) =
        t.track(FinanceViewModel(t.session, t.filter(), t.hints, t.changes, testFinancesRepository(t.api), wanted))

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        paths = PathServer(
            "/api/v2/finance/valuation" to """{"success":true,"currency":"CHF","sets":[
                {"set_number":"75192-1","name":"Falke"}]}""",
            "/api/v2/finance/portfolio-history" to """{"success":true,"period":"month","points":[]}""",
            // Fully via DTO: if the parsing throws, Retrofit passes the error on via
            // Dispatchers.Default, and the test no longer runs in lockstep.
            "/api/v2/finance/parts-valuation" to """{"success":true,"total_value":"0.00","parts":[]}""",
            "/api/v2/finance/minifigs-valuation" to """{"success":true,"total_value":"0.00","figs":[]}""",
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
    fun `row kinds and period survive a process death`() {
        val wanted = SavedStateHandle()
        val first = vm(wanted)
        first.toggleFinanceCategory("parts")
        first.loadPortfolioHistory("month")
        assertTrue("history loaded", !first.financeState.value.history.loading)

        val newValue = vm(wanted).financeState.value
        assertEquals(setOf("parts"), newValue.categories)
        assertEquals("month", newValue.historyPeriod)
    }

    @Test
    fun `whoever sees the finances loads valuation and history, the valuation once`() {
        val vm = vm()
        assertTrue("without observers nothing is fetched", paths.requestsTo("/finance/").isEmpty())
        val view = CoroutineScope(Dispatchers.Main).launch { vm.financeState.collect {} }
        view.cancel()
        CoroutineScope(Dispatchers.Main).launch { vm.financeState.collect {} }.cancel()
        assertEquals(1, paths.requestsTo("/finance/valuation").size)
        assertTrue("the history comes along", paths.requestsTo("/finance/portfolio-history").isNotEmpty())
    }

    @Test
    fun `a change of the stock in the store reloads the valuation`() {
        paths.responses["/api/v2/sets"] = """{"success":true,"total":1,"sets":[{"set_number":"75192-1","name":"Falke"}]}"""
        val vm = vm()
        // A different area fetches the sets into the store; the valuation follows it.
        runBlocking { t.sets().refreshSets() }
        assertTrue("valuation loaded", vm.financeState.value.valuation != null)
        assertEquals("75192-1", vm.financeState.value.valuation?.sets?.single()?.setNumber)
        assertEquals("the account's currency applies to the whole app", CurrencyCode.CHF, t.session.state.value.currency)
    }

    @Test
    fun `the tab's account filter travels along and reloads valuation and history`() {
        val vm = vm()
        vm.setScope(ScopeFilter.View.FINANCE, "own")
        assertTrue("both fetches", paths.requestsTo("/finance/valuation").isNotEmpty() && paths.requestsTo("/portfolio-history").isNotEmpty())
        assertTrue(paths.requestsTo("/finance/valuation").single().contains("accounts=own"))
        assertTrue(paths.requestsTo("/portfolio-history").single().contains("accounts=own"))

        // The filter of a DIFFERENT view loads nothing here.
        assertTrue("valuation complete", paths.requestsTo("/finance/pnl").isNotEmpty())
        val before = paths.requests.size
        vm.setScope(ScopeFilter.View.GALLERY, "own")
        assertEquals(before, paths.requests.size)
    }

    @Test
    fun `after sign-out nothing is left`() {
        val vm = vm()
        vm.loadValuation()
        vm.toggleFinanceCategory("sets")
        assertTrue("valuation loaded", vm.financeState.value.valuation != null)
        t.session.loggedOut()
        assertNull(vm.financeState.value.valuation)
        assertTrue(vm.financeState.value.categories.isEmpty())
    }
}
