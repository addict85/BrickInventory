package ch.brickinventoryapp.catalog

import ch.brickinventoryapp.model.domain.Katalogsortierung
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.contract.CatalogSetDetail
import ch.brickinventoryapp.contract.CatalogSetDetailResponse
import ch.brickinventoryapp.contract.CatalogSetItem
import ch.brickinventoryapp.contract.CatalogSetsResponse
import ch.brickinventoryapp.contract.CatalogYearVerteilungResponse
import ch.brickinventoryapp.contract.JahrAnzahl
import ch.brickinventoryapp.model.domain.JahrAnzahlAnsicht
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.catalog.ui.viewmodel.CatalogViewModel
import ch.brickinventoryapp.model.domain.Alarmrichtung
import ch.brickinventoryapp.catalog.ui.KatalogZiel
import ch.brickinventoryapp.catalog.ui.Merkwunsch
import ch.brickinventoryapp.contract.Merkposten
import ch.brickinventoryapp.contract.MerklisteResponse
import ch.brickinventoryapp.contract.MerkpostenAntwort
import ch.brickinventoryapp.contract.PreisalarmRequest
import ch.brickinventoryapp.contract.PreisalarmResponse
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.model.ui.Fehlerklasse
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.ui.dataOrNull
import ch.brickinventoryapp.model.ui.errorMessage
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.first
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
import ch.brickinventoryapp.testing.FakeApi
import ch.brickinventoryapp.testing.testCatalogRepository
import ch.brickinventoryapp.testing.NumbersTexts
import ch.brickinventoryapp.testing.TestDienste
import ch.brickinventoryapp.testing.text

/**
 * Das CatalogViewModel ausgeführt: Api ohne Netz, Texte als Ressourcennummern,
 * Zeit virtuell. Die Entprellung der Suche ist damit ohne Warten prüfbar.
 *
 * Gegenproben:
 *   katalog-suche-ohne-entprellen  setCatalogQuery() lädt sofort → rot „die Suche wartet …“
 *   katalog-seite-doppelt          ensureCatalogPage() ohne Prüfung „lädt schon“ → rot „eine Seite …“
 *   katalog-filter-behaelt-rolle   loadCatalogSets() ohne `rollgedaechtnis.vergiss` → rot „ein Filterwechsel …“
 *   katalog-merkt-ohne-alarm       merke() ohne setPreisalarm → rot „merken legt den Posten an …“
 *   katalog-alarm-falsche-richtung merke() schickt immer „unter“ → rot „merken legt den Posten an …“
 *   katalog-merkposten-unbekannt   gemerkt() vergleicht die Setnummer nicht → rot „das Detail kennt …“
 *   katalog-verteilung-ohne-filter loadYearDistribution() ohne `themeId` → rot „die Jahresverteilung …“
 *   katalog-detail-fehler-verschluckt loadCatalogDetail() legt den Fehler nicht in den
 *                                  Zustand → rot „scheitert das Detail, steht der Grund …“
 *   katalog-laedt-nicht-beim-beobachten  beim Beobachten nur die Metadaten geladen → rot „wer den Katalog sieht …“
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
    }

    private fun seite(vararg numbers: String) =
        CatalogSetsResponse(success = true, total = 120, sets = numbers.map { CatalogSetItem(setNumber = it, name = "Set $it") })

    private fun withVm(block: suspend TestScope.(CatalogViewModel) -> Unit) = runTest(takt) {
        val vm = CatalogViewModel(testCatalogRepository(fake.api), t.meldungen, NumbersTexts, t.merkliste(), t.alerts(), t.scrollMemory)
        try {
            block(vm)
        } finally {
            vm.viewModelScope.cancel()
        }
    }

    /** Der Suchtext der Listenabrufe, in Reihenfolge. */
    private fun gesucht() = synchronized(fake.arguments) {
        fake.arguments.filter { it.first == "getCatalogSets" }.map { it.second.first() }
    }

    @Test
    fun `die Suche wartet, bis das Tippen ruht, und laedt dann einmal`() = withVm { vm ->
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
    fun `eine Seite wird nur einmal geholt, auch wenn sie mehrfach sichtbar wird`() = withVm { vm ->
        fake.antworten["getCatalogSets"] = seite("1-1")
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
    fun `ein Filterwechsel beginnt oben und vergisst die geladenen Seiten`() = withVm { vm ->
        fake.antworten["getCatalogSets"] = seite("1-1")
        vm.loadCatalogSets()
        advanceUntilIdle()
        vm.ensureCatalogPage(2)
        advanceUntilIdle()
        // Die Ansicht schreibt ihre Stelle in den ScrollMemory, die eine Quelle aller Reiter.
        t.scrollMemory.merke(KatalogZiel.Catalog.rollSchluessel, 40, 12)
        assertEquals(setOf(1, 2), vm.state.value.loadedPages.keys)

        fake.antworten["getCatalogSets"] = seite("2-1")
        vm.setCatalogTheme(158)
        advanceUntilIdle()
        assertEquals(0 to 0, t.scrollMemory.lies(KatalogZiel.Catalog.rollSchluessel))
        assertEquals(setOf(1), vm.state.value.loadedPages.keys)
        assertEquals(listOf("2-1"), vm.state.value.loadedPages[1]?.map { it.setNumber })
    }

    @Test
    fun `ein Fehler steht im Zustand, ein fehlendes Detail auch`() = withVm { vm ->
        fake.codes["getCatalogSets"] = 500
        vm.loadCatalogSets()
        advanceUntilIdle()
        assertEquals(Meldung.Resource(R.string.err_server, listOf(500)), vm.state.value.abruf.errorMessage)
        assertNull("Ohne geladene Liste keine zweite Meldung", t.meldungen.text)

        fake.antworten["getCatalogSetDetail"] = CatalogSetDetailResponse(success = false)
        vm.loadCatalogDetail("99999-1")
        advanceUntilIdle()
        assertEquals(Meldung.Resource(R.string.err_set_not_found), vm.state.value.detail.errorMessage)
        assertNull("Der Bildschirm zeigt den Fehler selbst", t.meldungen.text)
    }

    @Test
    fun `scheitert das Detail, steht der Grund im Zustand und ein zweiter Versuch laedt es`() = withVm { vm ->
        fake.codes["getCatalogSetDetail"] = 503
        vm.loadCatalogDetail("10305-1")
        advanceUntilIdle()
        assertEquals("Ohne Grund bliebe der Kringel stehen",
            Laden.Fehler(Fehlerklasse.SERVER, Meldung.Resource(R.string.err_server, listOf(503))), vm.state.value.detail)

        fake.codes.remove("getCatalogSetDetail")
        fake.antworten["getCatalogSetDetail"] = CatalogSetDetailResponse(success = true,
            set = CatalogSetDetail(setNumber = "10305-1", name = "Lion Knights' Castle"))
        vm.loadCatalogDetail("10305-1")
        advanceUntilIdle()
        assertEquals("Der neue Versuch räumt den alten Fehler ab", "10305-1", vm.state.value.detail.dataOrNull()?.setNumber)
    }

    @Test
    fun `wer den Katalog sieht, laedt ihn, ein Zurueckkehren laedt nicht noch einmal`() = withVm { vm ->
        fake.antworten["getCatalogSets"] = seite("10294-1")
        val erster = backgroundScope.launch { vm.state.collect {} }
        advanceUntilIdle()
        assertEquals(setOf(1), vm.state.value.loadedPages.keys)
        erster.cancel()
        advanceUntilIdle()
        backgroundScope.launch { vm.state.collect {} }
        advanceUntilIdle()
        assertEquals("Die Liste ist da, ein zweiter Abruf wäre nur Last", 1, gesucht().size)
    }

    /** Die Jahre liegen nur auf dem Server; geholt mit denselben Filtern wie die Liste. */
    @Test
    fun `die Jahresverteilung kommt vom Server, mit den Filtern der Liste`() = withVm { vm ->
        fake.antworten["getCatalogSets"] = seite("10294-1")
        fake.antworten["getCatalogYearVerteilung"] = CatalogYearVerteilungResponse(
            success = true, years = listOf(JahrAnzahl(year = 1999, n = 4), JahrAnzahl(year = null, n = 2), JahrAnzahl(year = 2024, n = 7)))
        vm.setCatalogSort(Katalogsortierung.JAHR_ABSTEIGEND)
        vm.setCatalogTheme(158)
        advanceUntilIdle()
        val fetches = synchronized(fake.arguments) { fake.arguments.filter { it.first == "getCatalogYearVerteilung" } }
        assertEquals(listOf<Any?>(null, 158, "year_desc"), fetches.last().second)
        assertEquals("Jahrgänge ohne Jahr fallen weg, wie in der Webapp",
            listOf(JahrAnzahlAnsicht(1999, 4), JahrAnzahlAnsicht(2024, 7)), vm.state.value.yearDistribution)
    }

    @Test
    fun `merken legt den Posten an, setzt den Alarm in der gewaehlten Richtung und meldet`() = withVm { vm ->
        fake.antworten["legeMerkpostenAn"] = MerkpostenAntwort(success = true, warNeu = true,
            merkposten = Merkposten(setNumber = "10305-1", condition = Zustand.GEBRAUCHT))
        fake.antworten["setPreisalarm"] = PreisalarmResponse(success = true)
        vm.merke(Merkwunsch("10305-1", Zustand.GEBRAUCHT, Alarmrichtung.UEBER, "120", konto = null))
        advanceUntilIdle()
        val alarm = synchronized(fake.arguments) { fake.arguments.single { it.first == "setPreisalarm" }.second }
        assertEquals("10305-1", alarm[0])
        assertEquals(PreisalarmRequest(direction = Alarmrichtung.UEBER, threshold = 120.0, condition = Zustand.GEBRAUCHT), alarm[1])
        assertEquals(Meldung.Resource(R.string.wanted_added), t.meldungen.meldung.value)
    }

    @Test
    fun `merken ohne Schwelle setzt keinen Alarm`() = withVm { vm ->
        fake.antworten["legeMerkpostenAn"] = MerkpostenAntwort(success = true, warNeu = false)
        vm.merke(Merkwunsch("10305-1", Zustand.NEU, Alarmrichtung.UNTER, "", konto = null))
        advanceUntilIdle()
        assertEquals(0, fake.callsOf("setPreisalarm"))
        assertEquals(Meldung.Resource(R.string.wanted_already), t.meldungen.meldung.value)
    }

    @Test
    fun `das Detail kennt den Merkposten aus der Ablage, ein anderes Set nicht`() = withVm { vm ->
        fake.antworten["getMerkliste"] = MerklisteResponse(success = true,
            merkposten = listOf(Merkposten(setNumber = "10305-1", condition = Zustand.NEU)))
        fake.antworten["getCatalogSetDetail"] = CatalogSetDetailResponse(success = true, set = CatalogSetDetail(setNumber = "10305-1"))
        vm.loadCatalogDetail("10305-1")
        advanceUntilIdle()
        assertEquals("Das Detail holt die Merkliste in die Ablage", 1, fake.callsOf("getMerkliste"))
        assertEquals("10305-1", vm.gemerkt("10305-1").first()?.setNumber)
        assertNull(vm.gemerkt("75192-1").first())
    }
}
