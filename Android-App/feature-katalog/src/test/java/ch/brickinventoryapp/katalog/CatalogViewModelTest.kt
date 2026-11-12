package ch.brickinventoryapp.katalog

import ch.brickinventoryapp.model.fach.Katalogsortierung
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.model.data.model.CatalogSetDetail
import ch.brickinventoryapp.model.data.model.CatalogSetDetailResponse
import ch.brickinventoryapp.model.data.model.CatalogSetItem
import ch.brickinventoryapp.model.data.model.CatalogSetsResponse
import ch.brickinventoryapp.model.data.model.CatalogYearVerteilungResponse
import ch.brickinventoryapp.model.data.model.JahrAnzahl
import ch.brickinventoryapp.model.ui.model.JahrAnzahlAnsicht
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.katalog.ui.viewmodel.CatalogViewModel
import ch.brickinventoryapp.model.fach.Alarmrichtung
import ch.brickinventoryapp.katalog.ui.KatalogZiel
import ch.brickinventoryapp.katalog.ui.Merkwunsch
import ch.brickinventoryapp.model.data.model.Merkposten
import ch.brickinventoryapp.model.data.model.MerklisteResponse
import ch.brickinventoryapp.model.data.model.MerkpostenAntwort
import ch.brickinventoryapp.model.data.model.PreisalarmRequest
import ch.brickinventoryapp.model.data.model.PreisalarmResponse
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.model.ui.Fehlerklasse
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
import ch.brickinventoryapp.testing.KatalogRepository
import ch.brickinventoryapp.testing.NummernTexte
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
 *   katalog-verteilung-ohne-filter ladeJahrVerteilung() ohne `themeId` → rot „die Jahresverteilung …“
 *   katalog-detail-fehler-verschluckt loadCatalogDetail() legt den Fehler nicht in den
 *                                  Zustand → rot „scheitert das Detail, steht der Grund …“
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
        val vm = CatalogViewModel(KatalogRepository(fake.api, t.cache), t.meldungen, NummernTexte, t.merkliste(), t.alarme(), t.scrollMemory)
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
    fun `ein Fehler steht im Zustand, ein fehlendes Detail auch`() = mitVm { vm ->
        fake.codes["getCatalogSets"] = 500
        vm.loadCatalogSets()
        advanceUntilIdle()
        assertEquals("fehler", vm.state.value.error)
        assertNull("Ohne geladene Liste keine zweite Meldung", t.meldungen.text)

        fake.antworten["getCatalogSetDetail"] = CatalogSetDetailResponse(success = false)
        vm.loadCatalogDetail("99999-1")
        advanceUntilIdle()
        assertEquals("t${R.string.err_set_not_found}", vm.state.value.detailFehler)
        assertNull("Der Bildschirm zeigt den Fehler selbst", t.meldungen.text)
        assertNull(vm.state.value.detail)
    }

    @Test
    fun `scheitert das Detail, steht der Grund im Zustand und ein zweiter Versuch laedt es`() = mitVm { vm ->
        fake.codes["getCatalogSetDetail"] = 503
        vm.loadCatalogDetail("10305-1")
        advanceUntilIdle()
        val gescheitert = vm.state.value
        assertEquals(false, gescheitert.detailLoading)
        assertNull(gescheitert.detail)
        assertEquals("Ohne Grund bliebe der Kringel stehen", "fehler", gescheitert.detailFehler)
        assertEquals(Fehlerklasse.SERVER, gescheitert.detailFehlerKlasse)

        fake.codes.remove("getCatalogSetDetail")
        fake.antworten["getCatalogSetDetail"] = CatalogSetDetailResponse(success = true,
            set = CatalogSetDetail(setNumber = "10305-1", name = "Lion Knights' Castle"))
        vm.loadCatalogDetail("10305-1")
        advanceUntilIdle()
        assertEquals("10305-1", vm.state.value.detail?.setNumber)
        assertNull("Der neue Versuch räumt den alten Fehler ab", vm.state.value.detailFehler)
        assertNull(vm.state.value.detailFehlerKlasse)
    }

    /** Die Jahre liegen nur auf dem Server; geholt mit denselben Filtern wie die Liste. */
    @Test
    fun `die Jahresverteilung kommt vom Server, mit den Filtern der Liste`() = mitVm { vm ->
        fake.antworten["getCatalogSets"] = seite("10294-1")
        fake.antworten["getCatalogYearVerteilung"] = CatalogYearVerteilungResponse(
            success = true, years = listOf(JahrAnzahl(1999, 4), JahrAnzahl(null, 2), JahrAnzahl(2024, 7)))
        vm.setCatalogSort(Katalogsortierung.JAHR_ABSTEIGEND)
        vm.setCatalogTheme(158)
        advanceUntilIdle()
        val abrufe = synchronized(fake.argumente) { fake.argumente.filter { it.first == "getCatalogYearVerteilung" } }
        assertEquals(listOf<Any?>(null, 158, "year_desc"), abrufe.last().second)
        assertEquals("Jahrgänge ohne Jahr fallen weg, wie in der Webapp",
            listOf(JahrAnzahlAnsicht(1999, 4), JahrAnzahlAnsicht(2024, 7)), vm.state.value.jahrVerteilung)
    }

    @Test
    fun `merken legt den Posten an, setzt den Alarm in der gewaehlten Richtung und meldet`() = mitVm { vm ->
        fake.antworten["legeMerkpostenAn"] = MerkpostenAntwort(success = true, warNeu = true,
            merkposten = Merkposten(setNumber = "10305-1", condition = Zustand.GEBRAUCHT))
        fake.antworten["setPreisalarm"] = PreisalarmResponse(success = true)
        vm.merke(Merkwunsch("10305-1", Zustand.GEBRAUCHT, Alarmrichtung.UEBER, "120", konto = null))
        advanceUntilIdle()
        val alarm = synchronized(fake.argumente) { fake.argumente.single { it.first == "setPreisalarm" }.second }
        assertEquals("10305-1", alarm[0])
        assertEquals(PreisalarmRequest(Alarmrichtung.UEBER, 120.0, Zustand.GEBRAUCHT), alarm[1])
        assertEquals(Meldung.Ressource(R.string.wanted_added), t.meldungen.meldung.value)
    }

    @Test
    fun `merken ohne Schwelle setzt keinen Alarm`() = mitVm { vm ->
        fake.antworten["legeMerkpostenAn"] = MerkpostenAntwort(success = true, warNeu = false)
        vm.merke(Merkwunsch("10305-1", Zustand.NEU, Alarmrichtung.UNTER, "", konto = null))
        advanceUntilIdle()
        assertEquals(0, fake.aufrufeVon("setPreisalarm"))
        assertEquals(Meldung.Ressource(R.string.wanted_already), t.meldungen.meldung.value)
    }

    @Test
    fun `das Detail kennt den Merkposten aus der Ablage, ein anderes Set nicht`() = mitVm { vm ->
        fake.antworten["getMerkliste"] = MerklisteResponse(success = true,
            merkposten = listOf(Merkposten(setNumber = "10305-1", condition = Zustand.NEU)))
        fake.antworten["getCatalogSetDetail"] = CatalogSetDetailResponse(success = true, set = CatalogSetDetail(setNumber = "10305-1"))
        vm.loadCatalogDetail("10305-1")
        advanceUntilIdle()
        assertEquals("Das Detail holt die Merkliste in die Ablage", 1, fake.aufrufeVon("getMerkliste"))
        assertEquals("10305-1", vm.gemerkt("10305-1").first()?.setNumber)
        assertNull(vm.gemerkt("75192-1").first())
    }
}
