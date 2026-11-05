package ch.brickinventoryapp

import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.model.CatalogSetDetailResponse
import ch.brickinventoryapp.data.model.CatalogSetItem
import ch.brickinventoryapp.data.model.CatalogSetsResponse
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.viewmodel.CatalogViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancel
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
 * Das CatalogViewModel ausgeführt: Api ohne Netz, Texte als Ressourcennummern,
 * Zeit virtuell. Die Entprellung der Suche ist damit ohne Warten prüfbar.
 *
 * Gegenproben (05.11.2026, gemessen mit kotlinc lokal):
 *   katalog-suche-ohne-entprellen  setCatalogQuery() lädt sofort → rot „die Suche wartet …“
 *   katalog-seite-doppelt          ensureCatalogPage() ohne Prüfung „lädt schon“ → rot „eine Seite …“
 *   katalog-filter-behaelt-rolle   loadCatalogSets() ohne `scrollIndex = 0` → rot „ein Filterwechsel …“
 */
@OptIn(ExperimentalCoroutinesApi::class)
class CatalogViewModelTest {

    private val takt = StandardTestDispatcher()
    private val fake = FakeApi()
    private lateinit var t: TestDienste

    @Before fun auf() {
        Dispatchers.setMain(takt)
        t = TestDienste(fake.api, io = takt)
    }

    @After fun ab() {
        Dispatchers.resetMain()
        t.cacheDir.deleteRecursively()
    }

    private fun seite(vararg nummern: String) =
        CatalogSetsResponse(success = true, total = 120, sets = nummern.map { CatalogSetItem(setNumber = it, name = "Set $it") })

    private fun mitVm(block: suspend TestScope.(CatalogViewModel) -> Unit) = runTest(takt) {
        val vm = CatalogViewModel(fake.repo(t.cache), t.meldungen, NummernTexte)
        try {
            block(vm)
        } finally {
            vm.viewModelScope.cancel()
        }
    }

    /** Der Suchtext der Listenabrufe, in Reihenfolge. */
    private fun gesucht() = synchronized(fake.argumente) {
        fake.argumente.filter { it.first == "getCatalogSets" }.map { it.second.first() }
    }

    @Test
    fun `die Suche wartet, bis das Tippen ruht, und laedt dann einmal`() = mitVm { vm ->
        fake.antworten["getCatalogSets"] = seite("10294-1")
        vm.setCatalogQuery("t")
        advanceTimeBy(200)
        vm.setCatalogQuery("ti")
        advanceTimeBy(200)
        vm.setCatalogQuery("tit")
        advanceTimeBy(349)
        assertEquals("Während des Tippens kein Abruf", emptyList<Any?>(), gesucht())
        advanceUntilIdle()
        assertEquals(listOf<Any?>("tit"), gesucht())
        assertEquals(listOf("10294-1"), vm.state.value.loadedPages[1]?.map { it.setNumber })
        assertEquals(120, vm.state.value.total)
    }

    @Test
    fun `eine Seite wird nur einmal geholt, auch wenn sie mehrfach sichtbar wird`() = mitVm { vm ->
        fake.antworten["getCatalogSets"] = seite("1-1")
        vm.ensureCatalogPage(2)
        vm.ensureCatalogPage(2)
        advanceUntilIdle()
        vm.ensureCatalogPage(2)
        advanceUntilIdle()
        assertEquals(1, fake.aufrufeVon("getCatalogSets"))
        assertTrue(vm.state.value.loadedPages.containsKey(2))
        assertTrue(vm.state.value.loadingPages.isEmpty())
    }

    @Test
    fun `ein Filterwechsel beginnt oben und vergisst die geladenen Seiten`() = mitVm { vm ->
        fake.antworten["getCatalogSets"] = seite("1-1")
        vm.loadCatalogSets()
        advanceUntilIdle()
        vm.ensureCatalogPage(2)
        advanceUntilIdle()
        vm.setCatalogScrollPos(40, 12)
        assertEquals(setOf(1, 2), vm.state.value.loadedPages.keys)

        fake.antworten["getCatalogSets"] = seite("2-1")
        vm.setCatalogTheme(158)
        advanceUntilIdle()
        assertEquals(0, vm.state.value.scrollIndex)
        assertEquals(0, vm.state.value.scrollOffset)
        assertEquals(setOf(1), vm.state.value.loadedPages.keys)
        assertEquals(listOf("2-1"), vm.state.value.loadedPages[1]?.map { it.setNumber })
    }

    @Test
    fun `ein Fehler steht im Zustand, ein fehlendes Detail wird gemeldet`() = mitVm { vm ->
        fake.codes["getCatalogSets"] = 500
        vm.loadCatalogSets()
        advanceUntilIdle()
        assertEquals("fehler", vm.state.value.error)
        assertNull("Ohne geladene Liste keine zweite Meldung", t.meldungen.meldung.value)

        fake.antworten["getCatalogSetDetail"] = CatalogSetDetailResponse(success = false)
        vm.loadCatalogDetail("99999-1")
        advanceUntilIdle()
        assertEquals("t${R.string.err_set_not_found}", t.meldungen.meldung.value)
        assertNull(vm.state.value.detail)
    }
}
