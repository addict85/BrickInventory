package ch.brickinventoryapp.app

import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.collection.ui.viewmodel.SetDetailViewModel
import ch.brickinventoryapp.collection.ui.viewmodel.WantedListViewModel
import ch.brickinventoryapp.data.testing.PathServer
import ch.brickinventoryapp.data.testing.testCatalogRepository
import ch.brickinventoryapp.data.testing.testFinancesRepository
import ch.brickinventoryapp.data.testing.testHouseholdRepository
import ch.brickinventoryapp.data.testing.testMinifigsRepository
import ch.brickinventoryapp.data.testing.testPartsRepository
import ch.brickinventoryapp.data.testing.testVouchersRepository
import ch.brickinventoryapp.finances.ui.viewmodel.FinanceViewModel
import ch.brickinventoryapp.finances.ui.viewmodel.VoucherViewModel
import ch.brickinventoryapp.model.file.FileReader
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.model.ui.ErrorClass
import ch.brickinventoryapp.model.ui.Load
import ch.brickinventoryapp.model.ui.Message
import ch.brickinventoryapp.model.ui.errorKind
import ch.brickinventoryapp.model.ui.errorMessage
import ch.brickinventoryapp.model.ui.loading
import ch.brickinventoryapp.parts.ui.viewmodel.MinifigsViewModel
import ch.brickinventoryapp.parts.ui.viewmodel.PartsViewModel
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.state.testing.NumbersTexts
import ch.brickinventoryapp.state.testing.TestServices
import ch.brickinventoryapp.ui.LoadingIndicator
import ch.brickinventoryapp.ui.loadingIndicator
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

/**
 * Loading, error, empty and no hit are different states — and every
 * screen with loaded content learns of the error. Previously wishlist,
 * finances, parts, figures and vouchers showed „leer“ after an error, the
 * set detail a spinner without end. Executed against a PathServer without network that
 * first responds 404 and delivers content after „Erneut versuchen“.
 *
 * Counter-checks:
 *   A  ladeanzeige(): `error != null` after `filtered` → red “an error comes
 *      before Empty and No hit …”
 *   B  WantedListViewModel: `error = message(r)` removed → red “the wishlist …”
 *   C  FinanceViewModel: `valuationFehler = null` removed on reload → red
 *      “the valuation …” (the old error would stay after the success)
 *   D  parts: `partsFehler = beschreibeFehler(r)` removed → red “parts and figures …”
 *   E  SetDetailViewModel: `setDetailFehler = message(r)` removed → red “the set detail …”
 *   F  VoucherViewModel: `error = texts.message(r)` removed → red “the vouchers …”
 * Counter-checks: in FinanceViewModel `valuationFehlerKlasse = …`
 *   removed → red “the valuation …”; in Parts.kt `minifigsFehlerKlasse = …`
 *   removed → red “parts and figures …”.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ErrorStateTest {

    private lateinit var paths: PathServer
    private lateinit var t: TestServices

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        paths = PathServer()
        t = TestServices(paths.onTick(), io = Dispatchers.Main)
    }

    @After
    fun tearDown() {
        t.cleanUp()
        Dispatchers.resetMain()
        paths.server.shutdown()
    }

    @Test
    fun `an error comes before Empty and No hit, loaded content before everything`() {
        assertEquals(LoadingIndicator.ERROR, loadingIndicator(hasContent = false, loading = false, error = "weg", filtered = true))
        assertEquals(LoadingIndicator.LOADS, loadingIndicator(hasContent = false, loading = true, error = "weg", filtered = false))
        assertEquals(LoadingIndicator.LIST, loadingIndicator(hasContent = true, loading = false, error = "weg", filtered = false))
        assertEquals(LoadingIndicator.NO_HITS, loadingIndicator(hasContent = false, loading = false, error = null, filtered = true))
        assertEquals(LoadingIndicator.EMPTY, loadingIndicator(hasContent = false, loading = false, error = null, filtered = false))
    }

    @Test
    fun `the wishlist reports the error and forgets it on reload`() {
        val vm = t.track(WantedListViewModel(t.session, t.filter(), t.hints, t.wantedList(), t.alerts(), t.accountView,
            testCatalogRepository(t.api), testFinancesRepository(t.api), SavedStateHandle()))
        vm.loadWanted()
        assertTrue("Error", vm.wantedState.value.fetch.errorMessage != null)
        // No finished sentence in the state: the resource for the kind plus HTTP status.
        assertEquals(Message.Resource(R.string.err_server, listOf(404)), vm.wantedState.value.fetch.errorMessage)
        assertEquals("404 without a body is a server error", ErrorClass.SERVER, vm.wantedState.value.fetch.errorKind)

        paths.responses["/api/v1/wanted"] = """{"success":true,"merkposten":[{"set_number":"10294-1","condition":"N","user_id":1}]}"""
        vm.loadWanted()
        assertTrue("content", vm.wantedState.value.wantedItem.isNotEmpty())
        assertNull(vm.wantedState.value.fetch.errorMessage)
    }

    @Test
    fun `the valuation reports the error and forgets it on reload`() {
        val vm = t.track(FinanceViewModel(t.session, t.filter(), t.hints, t.changes, testFinancesRepository(t.api), SavedStateHandle()))
        vm.loadValuation()
        assertTrue("Error", vm.financeState.value.valuationLoad is Load.Failure)
        assertEquals(ErrorClass.SERVER, vm.financeState.value.valuationLoad.errorKind)

        paths.responses["/api/v1/finance/valuation"] = """{"success":true,"currency":"CHF"}"""
        vm.loadValuation()
        assertTrue("rating", vm.financeState.value.valuation != null)
        assertNull(vm.financeState.value.valuationLoad.errorMessage)
    }

    @Test
    fun `parts and figures report the error each on their own`() {
        val vm = t.track(PartsViewModel(t.session, t.filter(), t.hints, t.changes, t.scrollMemory, testPartsRepository(t.api), t.accountView, SavedStateHandle()))
        vm.loadParts()
        assertTrue("Teilefehler", vm.partsState.value.partsFetch is Load.Failure)
        val fig = t.track(MinifigsViewModel(t.session, t.filter(), t.hints, t.changes, testMinifigsRepository(t.api), t.accountView, SavedStateHandle()))
        fig.loadMinifigs()
        assertTrue("Figurenfehler", fig.minifigsState.value.minifigsFetch is Load.Failure)
        assertTrue(vm.partsState.value.partsFetch.errorMessage != null)
        assertEquals(ErrorClass.SERVER, vm.partsState.value.partsFetch.errorKind)
        assertEquals(ErrorClass.SERVER, fig.minifigsState.value.minifigsFetch.errorKind)
    }

    @Test
    fun `the set detail reports the error instead of loading forever`() {
        val reader = object : FileReader { override suspend fun read(file: FileRef): Pair<String?, ByteArray>? = null }
        val vm = t.track(SetDetailViewModel(t.session, t.filter(), t.hints, t.sets(), t.setCatalog(), t.alerts(), t.setFiles(),
            testFinancesRepository(t.api), testHouseholdRepository(t.api), reader,
            SavedStateHandle(mapOf("setNumber" to "75192-1"))))
        assertTrue("Error", vm.setDetailState.value.detailFetch is Load.Failure)
        assertEquals(false, vm.setDetailState.value.detailFetch.loading)
        assertEquals(ErrorClass.SERVER, vm.setDetailState.value.detailFetch.errorKind)
    }

    @Test
    fun `the vouchers report the error`() {
        val vm = VoucherViewModel(
            repo = testVouchersRepository(t.api),
            texts = NumbersTexts,
            reader = object : FileReader { override suspend fun read(file: FileRef): Pair<String?, ByteArray>? = null },
            messages = t.messages,
        )
        vm.loadVouchers()
        assertTrue("Error", vm.state.value.fetch is Load.Failure)
        assertEquals(ErrorClass.SERVER, vm.state.value.fetch.errorKind)
    }
}
