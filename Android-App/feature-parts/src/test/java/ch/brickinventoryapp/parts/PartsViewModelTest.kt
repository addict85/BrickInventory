package ch.brickinventoryapp.parts

import ch.brickinventoryapp.model.domain.Kategoriewahl
import ch.brickinventoryapp.model.domain.ColorPicker
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.resources.R
import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.parts.ui.viewmodel.PartsViewModel
import ch.brickinventoryapp.parts.ui.viewmodel.MinifigsViewModel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
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
import ch.brickinventoryapp.testing.PfadServer
import ch.brickinventoryapp.testing.TestDienste
import ch.brickinventoryapp.model.data.Ersatzteilwahl
import ch.brickinventoryapp.model.ui.ListView
import ch.brickinventoryapp.testing.text
import ch.brickinventoryapp.parts.ui.Teilefilter

/**
 * Teile- und Figuren-ViewModel, ausgeführt gegen die Regeln eines PfadServers ohne Netz
 * (imTakt): Abrufe und Ablage laufen in der Testuhr, kein Test wartet in Echtzeit.
 * Ein Prozesstod ist ein neues ViewModel mit demselben SavedStateHandle in neuen Diensten.
 *
 * Gegenproben:
 *   A  in PartsViewModel `filterChanged` nicht mehr in den SavedStateHandle geschrieben
 *      → rot „Filter und Ansicht überstehen …“
 *   teile-kontofilter-gemerkt  (gegenproben/) der Kontofilter mit im SavedStateHandle und nach
 *      dem Prozesstod wieder gesetzt → rot „… der Kontofilter nicht“
 *   figuren-suche-vergessen    (gegenproben/) MinifigsViewModel liest die Suche nicht zurück
 *      → rot „Suche und Ansicht der Figuren überstehen …“
 *   teile-laden-beim-zeigen    (gegenproben/) loadPerServer im PartsViewModel ohne loadPartsColors
 *      → rot „wer den Reiter zeigt, bekommt …“
 *   B  in LocalApplication.manuelleTeile den Zweig TeilAendern entfernt → rot „ein
 *      geändertes Teil steht in der Ablage …“
 *   C  in aendere() wieder `fehler ?: text(err_unknown)` → rot „ein Fehler,
 *      den die Sitzungsschicht schon meldet, bleibt still“
 *   D  in setPartLocation() die Ruhezeit entfernt → rot „der Lagerort wird
 *      entprellt gespeichert …“
 *   E  getManualParts ohne Lagerort, oder getManualMinifigs ohne Suchtext →
 *      je rot „Suchtext und Lagerort erreichen auch die manuell erfassten …“
 *   F  getMinifigStats ohne Blickfeld → rot „der Kontofilter der Figuren …“
 *   G  in BrickApiService bei getManualParts bzw. getManualMinifigs
 *      `@Query("search")` zu `@Query("suche")` → je rot „Suchtext und
 *      Lagerort erreichen auch die manuell erfassten …“ (Zeitüberschreitung
 *      „manuelle Teile“ bzw. „manuelle Figuren“)
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PartsViewModelTest {

    private val clock = TestCoroutineScheduler()
    private val takt = UnconfinedTestDispatcher(clock)
    private lateinit var paths: PfadServer
    private lateinit var t: TestDienste

    private fun vm(gemerkt: SavedStateHandle = SavedStateHandle(), t: TestDienste = this.t) =
        t.merke(PartsViewModel(t.sitzung, t.filter(), t.hinweise, t.changes, t.scrollMemory, t.teile(), t.kontosicht, gemerkt))

    private fun minifigsVm(gemerkt: SavedStateHandle = SavedStateHandle(), t: TestDienste = this.t) =
        t.merke(MinifigsViewModel(t.sitzung, t.filter(), t.hinweise, t.changes, t.figuren(), t.kontosicht, gemerkt))

    @Before
    fun auf() {
        Dispatchers.setMain(takt)
        paths = PfadServer(
            "/api/v1/parts" to """{"success":true,"total":1,"parts":[{"part_number":"3001","color_id":5,"color_name":"Red"}]}""",
            "/api/v1/parts/manual" to """{"success":true,"parts":[]}""",
            "/api/v1/minifigs" to """{"success":true,"figs":[{"fig_number":"sw0001"}]}""",
            "/api/v1/parts/stats" to """{"success":true}""",
            "/api/v1/parts/3001/5" to """{"success":true}""",
            "/api/v1/parts/3001/5/storage" to """{"success":true,"storage":"Kiste 3"}""",
            "/api/v1/parts/3001/5/sets" to """{"success":true,"item":{"nummer":"3001","color_id":5},
                "sets":[{"set_number":"75192-1","quantity":4}]}""",
        )
        t = TestDienste(paths.imTakt(), io = takt)
    }

    @After
    fun zu() {
        t.aufraeumen()
        Dispatchers.resetMain()
        paths.server.shutdown()
    }

    @Test
    fun `Filter und Ansicht ueberstehen einen Prozess-Tod und reisen mit, der Kontofilter nicht`() {
        val gemerkt = SavedStateHandle()
        val erstes = vm(gemerkt)
        erstes.setScope(ScopeFilter.View.PARTS, "own")
        erstes.setPartsColorFilter(ColorPicker.Farbe("5"))
        erstes.setPartsCategoryFilter(Kategoriewahl.Kategorie("11"))
        erstes.setPartsSpare(Ersatzteilwahl.NUR)
        erstes.setPartsView(ListView.TABLE)
        erstes.setPartsOrder(Teilefilter.Order.QUANTITY)
        erstes.setPartsQuery("stein")
        assertTrue("vorher mit Konto", "accounts=own" in paths.requestsAn("GET /api/v1/parts?").last())

        paths.newProcess(io = takt) { paths, t ->
            val neu = vm(gemerkt, t)
            assertEquals(Teilefilter("stein", Ersatzteilwahl.NUR, ListView.TABLE, Teilefilter.Order.QUANTITY, ColorPicker.Farbe("5"), Kategoriewahl.Kategorie("11")),
                neu.teileState.value.filter)
            assertNull("der Kontofilter lebt nur im Speicher", neu.accountFor(ScopeFilter.View.PARTS))
            neu.loadParts()
            assertTrue("Liste geladen", neu.teileState.value.parts.isNotEmpty())
            val abruf = paths.requestsAn("GET /api/v1/parts?").single()
            assertTrue(abruf, listOf("color=5", "category=11", "spare=1", "with_sets=1", "search=stein").all { it in abruf })
            assertTrue(abruf, "accounts=" !in abruf)
        }
    }

    @Test
    fun `Suche und Ansicht der Figuren ueberstehen einen Prozess-Tod, der Kontofilter nicht`() {
        val gemerkt = SavedStateHandle()
        val erstes = minifigsVm(gemerkt)
        erstes.setScope(ScopeFilter.View.MINIFIGS, "own")
        erstes.setMinifigsQuery("han")
        erstes.setMinifigsView(ListView.TABLE)

        paths.newProcess(io = takt) { _, t ->
            val neu = minifigsVm(gemerkt, t)
            assertEquals("han" to ListView.TABLE, neu.minifigsState.value.let { it.minifigsQuery to it.minifigsView })
            assertNull(neu.accountFor(ScopeFilter.View.MINIFIGS))
        }
    }

    @Test
    fun `wer den Reiter zeigt, bekommt Liste, Farben und Filterwerte, die Figuren nur einmal`() {
        val vm = vm()
        val fig = minifigsVm()
        val vorher = CoroutineScope(takt).launch { vm.teileState.collect {} }
        assertTrue("ohne Server kein Abruf", paths.requestsAn("GET /api/v1/parts").isEmpty())
        vorher.cancel()
        t.sitzung.anmeldungGeaendert(paths.server.url("/").toString(), angemeldet = true)
        assertTrue("ohne Beobachter kein Abruf", paths.requestsAn("GET /api/v1/parts").isEmpty())
        val seite = CoroutineScope(takt).launch { vm.teileState.collect {} }
        for (pfad in listOf("GET /api/v1/parts?", "GET /api/v1/parts/brick-colors", "GET /api/v1/parts/colors", "GET /api/v1/parts/categories"))
            assertTrue(pfad, paths.requestsAn(pfad).isNotEmpty())
        seite.cancel()

        CoroutineScope(takt).launch { fig.minifigsState.collect {} }.cancel()
        val minifigsFetches = paths.requestsAn("GET /api/v1/minifigs").size
        assertTrue("die Figuren geladen", minifigsFetches > 0 && fig.minifigsState.value.minifigs.isNotEmpty())
        CoroutineScope(takt).launch { fig.minifigsState.collect {} }.cancel()
        assertEquals("schon da: nicht noch einmal", minifigsFetches, paths.requestsAn("GET /api/v1/minifigs").size)
    }

    @Test
    fun `Suchtext und Lagerort erreichen auch die manuell erfassten Stuecke`() {
        // Sonst filtert der Text die Set-Teile, und die manuellen Kacheln
        // darüber bleiben stehen.
        val vm = vm()
        vm.setStorageFilter(ScopeFilter.View.PARTS, "Keller")
        vm.setPartsQuery("stein")
        vm.loadParts()
        assertTrue("manuelle Teile", paths.requestsAn("GET /api/v1/parts/manual?").any { "search=stein" in it })
        val teile = paths.requestsAn("GET /api/v1/parts/manual?").last { "search=stein" in it }
        assertTrue(teile, "storage=Keller" in teile)

        // Ohne Kontofilter sucht die Figurensuche in der Ablage; abgerufen wird ungefiltert.
        val fig = minifigsVm()
        fig.setMinifigsQuery("han")
        fig.loadMinifigs()
        val figuren = paths.requestsAn("GET /api/v1/minifigs/manual")
        assertTrue("manuelle Figuren abgerufen: $figuren", figuren.isNotEmpty() && figuren.none { "search=" in it })
    }

    @Test
    fun `der Kontofilter der Figuren reist mit Liste, Kennzahlen und manuellen Figuren`() {
        val vm = minifigsVm()
        vm.setScope(ScopeFilter.View.MINIFIGS, "own")
        for (pfad in listOf("GET /api/v1/minifigs?", "GET /api/v1/minifigs/stats?", "GET /api/v1/minifigs/manual?")) {
            assertTrue(pfad, paths.requestsAn(pfad).any { "accounts=own" in it })
        }
    }

    @Test
    fun `der Kontofilter der Teile reist mit, der einer anderen Ansicht nicht`() {
        val vm = vm()
        vm.setScope(ScopeFilter.View.PARTS, "own")
        assertTrue("Liste geladen", vm.teileState.value.parts.isNotEmpty())
        assertTrue("accounts=own" in paths.requestsAn("GET /api/v1/parts?").last())
        val vorher = paths.requestsAn("GET /api/v1/parts?").size
        vm.setScope(ScopeFilter.View.GALLERY, "own")
        assertEquals(vorher, paths.requestsAn("GET /api/v1/parts?").size)
    }

    @Test
    fun `ein geaendertes Teil steht in der Ablage, ohne die Liste neu zu holen`() {
        paths.antworten["/api/v1/parts/manual"] = """{"success":true,"parts":[{"part_number":"3001","color_id":5,"quantity":1}]}"""
        val vm = vm()
        vm.loadParts()
        assertEquals(listOf(1), vm.teileState.value.manualParts?.map { it.quantity })
        val fetches = paths.requestsAn("GET /api/v1/parts/manual").size
        vm.updatePart("3001", 5, quantity = 3, unitPrice = 0.1)
        assertEquals("die neue Menge aus der Ablage", listOf(3), vm.teileState.value.manualParts?.map { it.quantity })
        assertEquals("ohne neuen Abruf", fetches, paths.requestsAn("GET /api/v1/parts/manual").size)
        assertEquals("t${R.string.vm_saved}", t.meldungen.text)
        assertTrue(paths.requestsAn("PUT /api/v1/parts/3001/5").isNotEmpty())
    }

    @Test
    fun `ein Fehler, den die Sitzungsschicht schon meldet, bleibt still`() {
        paths.codes["/api/v1/parts/3001/5"] = 401
        val vm = vm()
        vm.deletePart("3001", 5)
        assertTrue("Antwort da", paths.requestsAn("DELETE /api/v1/parts/3001/5").isNotEmpty())
        assertNull("Ein 401 ist schon gemeldet — hier kein zweiter, leerer Satz", t.meldungen.text)
    }

    @Test
    fun `der Lagerort wird entprellt gespeichert und im offenen Dialog gezeigt`() {
        val vm = vm()
        vm.openSetItem("3001", 5)
        assertTrue("Dialog geladen", !vm.setItemState.value.abruf.laedt)
        assertEquals("75192-1", vm.setItemState.value.sets.single().setNumber)

        vm.setPartLocation("3001", 5, "Ki")
        vm.setPartLocation("3001", 5, "Kiste 3")
        clock.advanceTimeBy(500)
        assertTrue("Vor der Ruhezeit geht nichts hinaus", paths.requestsAn("PUT /api/v1/parts/3001/5/storage").isEmpty())
        clock.advanceTimeBy(400)
        assertTrue("gespeichert", vm.setItemState.value.kopf?.storage == "Kiste 3")
        assertEquals(1, paths.requestsAn("PUT /api/v1/parts/3001/5/storage").size)
    }

    @Test
    fun `nach dem Abmelden ist nichts mehr da`() {
        val gemerkt = SavedStateHandle()
        val vm = vm(gemerkt)
        vm.setPartsColorFilter(ColorPicker.Farbe("Red"))
        vm.openSetItem("3001", 5)
        assertTrue("geladen", vm.teileState.value.parts.isNotEmpty() && !vm.setItemState.value.abruf.laedt)
        t.sitzung.abgemeldet()
        assertTrue(vm.teileState.value.parts.isEmpty())
        assertTrue(!vm.setItemState.value.offen)
        assertEquals(Teilefilter(), vm(gemerkt).teileState.value.filter)
    }
}
