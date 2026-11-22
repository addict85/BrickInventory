package ch.brickinventoryapp.catalog

import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.catalog.ui.CatalogTarget
import ch.brickinventoryapp.catalog.ui.WantedRequest
import ch.brickinventoryapp.catalog.ui.viewmodel.CatalogViewModel
import ch.brickinventoryapp.contract.CatalogSetDetail
import ch.brickinventoryapp.contract.CatalogSetDetailResponse
import ch.brickinventoryapp.contract.CatalogSetItem
import ch.brickinventoryapp.contract.CatalogSetsResponse
import ch.brickinventoryapp.contract.CatalogYearVerteilungResponse
import ch.brickinventoryapp.contract.JahrAnzahl
import ch.brickinventoryapp.contract.MerklisteResponse
import ch.brickinventoryapp.contract.Merkposten
import ch.brickinventoryapp.contract.MerkpostenAntwort
import ch.brickinventoryapp.contract.PreisalarmRequest
import ch.brickinventoryapp.contract.PreisalarmResponse
import ch.brickinventoryapp.model.domain.AlarmDirection
import ch.brickinventoryapp.model.domain.CatalogSort
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.YearCountView
import ch.brickinventoryapp.model.ui.ErrorClass
import ch.brickinventoryapp.model.ui.Load
import ch.brickinventoryapp.model.ui.Message
import ch.brickinventoryapp.model.ui.dataOrNull
import ch.brickinventoryapp.model.ui.errorMessage
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.testing.FakeApi
import ch.brickinventoryapp.testing.NumbersTexts
import ch.brickinventoryapp.testing.TestServices
import ch.brickinventoryapp.testing.testCatalogRepository
import ch.brickinventoryapp.testing.text
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * The CatalogViewModel run: API with no network, texts as resource numbers,
 * virtual time. The search debounce is thus checkable without waiting.
 *
 * Counter-checks:
 *   katalog-suche-ohne-entprellen  setCatalogQuery() loads right away → red "die Suche wartet …"
 *   katalog-seite-doppelt          ensureCatalogPage() without the "already loading" check → red "eine Seite …"
 *   katalog-filter-behaelt-rolle   loadCatalogSets() without `scrollMemory.forgetNow` → red "ein Filterwechsel …"
 *   katalog-merkt-ohne-alarm       track() without setPriceAlarm → red "merken legt den Posten an …"
 *   katalog-alarm-falsche-richtung track() always sends "below" → red "merken legt den Posten an …"
 *   katalog-merkposten-unbekannt   wanted() doesn't compare the set number → red "das Detail kennt …"
 *   katalog-verteilung-ohne-filter loadYearDistribution() without `themeId` → red "die Jahresverteilung …"
 *   katalog-detail-fehler-verschluckt loadCatalogDetail() doesn't put the error into the
 *                                  state → red "scheitert das Detail, steht der Grund …"
 *   katalog-laedt-nicht-beim-beobachten  only the metadata loaded on observing → red "wer den Katalog sieht …"
 */
@OptIn(ExperimentalCoroutinesApi::class)
class CatalogViewModelTest {

    private val tick = StandardTestDispatcher()
    private val fake = FakeApi()
    private lateinit var t: TestServices

    @Before fun setUp() {
        Dispatchers.setMain(tick)
        t = TestServices(fake.api, io = tick)
    }

    @After fun ab() {
        Dispatchers.resetMain()
    }

    private fun page(vararg numbers: String) =
        CatalogSetsResponse(success = true, total = 120, sets = numbers.map { CatalogSetItem(setNumber = it, name = "Set $it") })

    private fun withVm(block: suspend TestScope.(CatalogViewModel) -> Unit) = runTest(tick) {
        val vm = CatalogViewModel(testCatalogRepository(fake.api), t.messages, NumbersTexts, t.wantedList(), t.alerts(), t.scrollMemory)
        try {
            block(vm)
        } finally {
            vm.viewModelScope.cancel()
        }
    }

    /** The search text of the list fetches, in order. */
    private fun searched() = synchronized(fake.arguments) {
        fake.arguments.filter { it.first == "getCatalogSets" }.map { it.second.first() }
    }

    @Test
    fun `the search waits until typing rests and then loads once`() = withVm { vm ->
        fake.responses["getCatalogSets"] = page("10294-1")
        vm.setCatalogQuery("t")
        advanceTimeBy(200)
        vm.setCatalogQuery("ti")
        advanceTimeBy(200)
        vm.setCatalogQuery("tit")
        advanceTimeBy(349)
        assertEquals("Während des Tippens kein Abruf", emptyList<Any?>(), searched())
        advanceUntilIdle()
        assertEquals(listOf<Any?>("tit"), searched())
        assertEquals(listOf("10294-1"), vm.state.value.loadedPages[1]?.map { it.setNumber })
        assertEquals(120, vm.state.value.total)
    }

    @Test
    fun `a page is fetched only once, even if it becomes visible several times`() = withVm { vm ->
        fake.responses["getCatalogSets"] = page("1-1")
        vm.ensureCatalogPage(2)
        vm.ensureCatalogPage(2)
        advanceUntilIdle()
        vm.ensureCatalogPage(2)
        advanceUntilIdle()
        assertEquals(1, fake.callsOf("getCatalogSets"))
        assertTrue(vm.state.value.loadedPages.containsKey(2))
        assertTrue(vm.state.value.loadingPages.isEmpty())
    }

    @Test
    fun `a filter change starts at the top and forgets the loaded pages`() = withVm { vm ->
        fake.responses["getCatalogSets"] = page("1-1")
        vm.loadCatalogSets()
        advanceUntilIdle()
        vm.ensureCatalogPage(2)
        advanceUntilIdle()
        // The view writes its position into ScrollMemory, the one source for every tab.
        t.scrollMemory.track(CatalogTarget.Catalog.rollKey, 40, 12)
        assertEquals(setOf(1, 2), vm.state.value.loadedPages.keys)

        fake.responses["getCatalogSets"] = page("2-1")
        vm.setCatalogTheme(158)
        advanceUntilIdle()
        assertEquals(0 to 0, t.scrollMemory.read(CatalogTarget.Catalog.rollKey))
        assertEquals(setOf(1), vm.state.value.loadedPages.keys)
        assertEquals(listOf("2-1"), vm.state.value.loadedPages[1]?.map { it.setNumber })
    }

    @Test
    fun `an error is in the state, a missing detail too`() = withVm { vm ->
        fake.codes["getCatalogSets"] = 500
        vm.loadCatalogSets()
        advanceUntilIdle()
        assertEquals(Message.Resource(R.string.err_server, listOf(500)), vm.state.value.fetch.errorMessage)
        assertNull("Ohne geladene Liste keine zweite Meldung", t.messages.text)

        fake.responses["getCatalogSetDetail"] = CatalogSetDetailResponse(success = false)
        vm.loadCatalogDetail("99999-1")
        advanceUntilIdle()
        assertEquals(Message.Resource(R.string.err_set_not_found), vm.state.value.detail.errorMessage)
        assertNull("Der Bildschirm zeigt den Fehler selbst", t.messages.text)
    }

    @Test
    fun `if the detail fails, the reason is in the state and a second attempt loads it`() = withVm { vm ->
        fake.codes["getCatalogSetDetail"] = 503
        vm.loadCatalogDetail("10305-1")
        advanceUntilIdle()
        assertEquals("Ohne Grund bliebe der Kringel stehen",
            Load.Failure(ErrorClass.SERVER, Message.Resource(R.string.err_server, listOf(503))), vm.state.value.detail)

        fake.codes.remove("getCatalogSetDetail")
        fake.responses["getCatalogSetDetail"] = CatalogSetDetailResponse(success = true,
            set = CatalogSetDetail(setNumber = "10305-1", name = "Lion Knights' Castle"))
        vm.loadCatalogDetail("10305-1")
        advanceUntilIdle()
        assertEquals("Der neue Versuch räumt den alten Fehler ab", "10305-1", vm.state.value.detail.dataOrNull()?.setNumber)
    }

    @Test
    fun `whoever sees the catalog loads it, returning does not load again`() = withVm { vm ->
        fake.responses["getCatalogSets"] = page("10294-1")
        val first = backgroundScope.launch { vm.state.collect {} }
        advanceUntilIdle()
        assertEquals(setOf(1), vm.state.value.loadedPages.keys)
        first.cancel()
        advanceUntilIdle()
        backgroundScope.launch { vm.state.collect {} }
        advanceUntilIdle()
        assertEquals("Die Liste ist da, ein zweiter Abruf wäre nur Last", 1, searched().size)
    }

    /** The years only exist on the server; fetched with the same filters as the list. */
    @Test
    fun `the year distribution comes from the server, with the list's filters`() = withVm { vm ->
        fake.responses["getCatalogSets"] = page("10294-1")
        fake.responses["getCatalogYearDistribution"] = CatalogYearVerteilungResponse(
            success = true, years = listOf(JahrAnzahl(year = 1999, n = 4), JahrAnzahl(year = null, n = 2), JahrAnzahl(year = 2024, n = 7)))
        vm.setCatalogSort(CatalogSort.YEAR_DESCENDING)
        vm.setCatalogTheme(158)
        advanceUntilIdle()
        val fetches = synchronized(fake.arguments) { fake.arguments.filter { it.first == "getCatalogYearDistribution" } }
        assertEquals(listOf<Any?>(null, 158, "year_desc"), fetches.last().second)
        assertEquals("Jahrgänge ohne Jahr fallen weg, wie in der Webapp",
            listOf(YearCountView(1999, 4), YearCountView(2024, 7)), vm.state.value.yearDistribution)
    }

    @Test
    fun `remembering creates the item, sets the alert in the chosen direction and reports`() = withVm { vm ->
        fake.responses["createWantedItem"] = MerkpostenAntwort(success = true, warNeu = true,
            merkposten = Merkposten(setNumber = "10305-1", condition = Condition.USED))
        fake.responses["setPriceAlarm"] = PreisalarmResponse(success = true)
        vm.track(WantedRequest("10305-1", Condition.USED, AlarmDirection.OVER, "120", account = null))
        advanceUntilIdle()
        val alarm = synchronized(fake.arguments) { fake.arguments.single { it.first == "setPriceAlarm" }.second }
        assertEquals("10305-1", alarm[0])
        assertEquals(PreisalarmRequest(direction = AlarmDirection.OVER, threshold = 120.0, condition = Condition.USED), alarm[1])
        assertEquals(Message.Resource(R.string.wanted_added), t.messages.message.value)
    }

    @Test
    fun `remembering without a threshold sets no alert`() = withVm { vm ->
        fake.responses["createWantedItem"] = MerkpostenAntwort(success = true, warNeu = false)
        vm.track(WantedRequest("10305-1", Condition.NEW, AlarmDirection.BELOW, "", account = null))
        advanceUntilIdle()
        assertEquals(0, fake.callsOf("setPriceAlarm"))
        assertEquals(Message.Resource(R.string.wanted_already), t.messages.message.value)
    }

    @Test
    fun `the detail knows the wishlist item from the store, another set does not`() = withVm { vm ->
        fake.responses["getWantedList"] = MerklisteResponse(success = true,
            merkposten = listOf(Merkposten(setNumber = "10305-1", condition = Condition.NEW)))
        fake.responses["getCatalogSetDetail"] = CatalogSetDetailResponse(success = true, set = CatalogSetDetail(setNumber = "10305-1"))
        vm.loadCatalogDetail("10305-1")
        advanceUntilIdle()
        assertEquals("Das Detail holt die Merkliste in die Ablage", 1, fake.callsOf("getWantedList"))
        assertEquals("10305-1", vm.wanted("10305-1").first()?.setNumber)
        assertNull(vm.wanted("75192-1").first())
    }
}
