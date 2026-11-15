package ch.brickinventoryapp.teile

import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.ressourcen.R
import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.teile.ui.viewmodel.TeileViewModel
import ch.brickinventoryapp.teile.ui.viewmodel.FigurenViewModel
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
import ch.brickinventoryapp.model.ui.Listenansicht
import ch.brickinventoryapp.testing.text
import ch.brickinventoryapp.teile.ui.Teilefilter

/**
 * Teile- und Figuren-ViewModel, ausgeführt gegen die Regeln eines PfadServers ohne Netz
 * (imTakt): Abrufe und Ablage laufen in der Testuhr, kein Test wartet in Echtzeit.
 * Ein Prozesstod ist ein neues ViewModel mit demselben SavedStateHandle in neuen Diensten.
 *
 * Gegenproben:
 *   A  in TeileViewModel `filterGeaendert` nicht mehr in den SavedStateHandle geschrieben
 *      → rot „Filter und Ansicht überstehen …“
 *   teile-kontofilter-gemerkt  (gegenproben/) der Kontofilter mit im SavedStateHandle und nach
 *      dem Prozesstod wieder gesetzt → rot „… der Kontofilter nicht“
 *   figuren-suche-vergessen    (gegenproben/) FigurenViewModel liest die Suche nicht zurück
 *      → rot „Suche und Ansicht der Figuren überstehen …“
 *   teile-laden-beim-zeigen    (gegenproben/) ladeJeServer im TeileViewModel ohne loadPartsColors
 *      → rot „wer den Reiter zeigt, bekommt …“
 *   B  in LokaleAnwendung.manuelleTeile den Zweig TeilAendern entfernt → rot „ein
 *      geändertes Teil steht in der Ablage …“
 *   C  in aendere() wieder `fehler ?: text(err_unknown)` → rot „ein Fehler,
 *      den die Sitzungsschicht schon meldet, bleibt still“
 *   D  in setzeTeilLagerort() die Ruhezeit entfernt → rot „der Lagerort wird
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
class TeileViewModelTest {

    private val uhr = TestCoroutineScheduler()
    private val takt = UnconfinedTestDispatcher(uhr)
    private lateinit var pfade: PfadServer
    private lateinit var t: TestDienste

    private fun vm(gemerkt: SavedStateHandle = SavedStateHandle(), t: TestDienste = this.t) =
        t.merke(TeileViewModel(t.sitzung, t.filter(), t.hinweise, t.aenderungen, t.scrollMemory, t.teile(), t.kontosicht, gemerkt))

    private fun figurenVm(gemerkt: SavedStateHandle = SavedStateHandle(), t: TestDienste = this.t) =
        t.merke(FigurenViewModel(t.sitzung, t.filter(), t.hinweise, t.aenderungen, t.figuren(), t.kontosicht, gemerkt))

    @Before
    fun auf() {
        Dispatchers.setMain(takt)
        pfade = PfadServer(
            "/api/v1/parts" to """{"success":true,"total":1,"parts":[{"part_number":"3001","color_id":5,"color_name":"Red"}]}""",
            "/api/v1/parts/manual" to """{"success":true,"parts":[]}""",
            "/api/v1/minifigs" to """{"success":true,"figs":[{"fig_number":"sw0001"}]}""",
            "/api/v1/parts/stats" to """{"success":true}""",
            "/api/v1/parts/3001/5" to """{"success":true}""",
            "/api/v1/parts/3001/5/storage" to """{"success":true,"storage":"Kiste 3"}""",
            "/api/v1/parts/3001/5/sets" to """{"success":true,"item":{"nummer":"3001","color_id":5},
                "sets":[{"set_number":"75192-1","quantity":4}]}""",
        )
        t = TestDienste(pfade.imTakt(), io = takt)
    }

    @After
    fun zu() {
        t.aufraeumen()
        Dispatchers.resetMain()
        pfade.server.shutdown()
    }

    @Test
    fun `Filter und Ansicht ueberstehen einen Prozess-Tod und reisen mit, der Kontofilter nicht`() {
        val gemerkt = SavedStateHandle()
        val erstes = vm(gemerkt)
        erstes.setScope(ScopeFilter.View.PARTS, "own")
        erstes.setPartsColorFilter("5")
        erstes.setPartsCategoryFilter("11")
        erstes.setPartsSpare(Ersatzteilwahl.NUR)
        erstes.setPartsView(Listenansicht.TABELLE)
        erstes.setPartsOrdnung(Teilefilter.Ordnung.MENGE)
        erstes.setPartsQuery("stein")
        assertTrue("vorher mit Konto", "accounts=own" in pfade.anfragenAn("GET /api/v1/parts?").last())

        pfade.neuerProzess(io = takt) { pfade, t ->
            val neu = vm(gemerkt, t)
            assertEquals(Teilefilter("stein", Ersatzteilwahl.NUR, Listenansicht.TABELLE, Teilefilter.Ordnung.MENGE, "5", "11"),
                neu.teileState.value.filter)
            assertNull("der Kontofilter lebt nur im Speicher", neu.kontoFuer(ScopeFilter.View.PARTS))
            neu.loadParts()
            assertTrue("Liste geladen", neu.teileState.value.parts.isNotEmpty())
            val abruf = pfade.anfragenAn("GET /api/v1/parts?").single()
            assertTrue(abruf, listOf("color=5", "category=11", "spare=1", "with_sets=1", "search=stein").all { it in abruf })
            assertTrue(abruf, "accounts=" !in abruf)
        }
    }

    @Test
    fun `Suche und Ansicht der Figuren ueberstehen einen Prozess-Tod, der Kontofilter nicht`() {
        val gemerkt = SavedStateHandle()
        val erstes = figurenVm(gemerkt)
        erstes.setScope(ScopeFilter.View.MINIFIGS, "own")
        erstes.setMinifigsQuery("han")
        erstes.setMinifigsView(Listenansicht.TABELLE)

        pfade.neuerProzess(io = takt) { _, t ->
            val neu = figurenVm(gemerkt, t)
            assertEquals("han" to Listenansicht.TABELLE, neu.figurenZustand.value.let { it.minifigsQuery to it.minifigsView })
            assertNull(neu.kontoFuer(ScopeFilter.View.MINIFIGS))
        }
    }

    @Test
    fun `wer den Reiter zeigt, bekommt Liste, Farben und Filterwerte, die Figuren nur einmal`() {
        val vm = vm()
        val fig = figurenVm()
        val vorher = CoroutineScope(takt).launch { vm.teileState.collect {} }
        assertTrue("ohne Server kein Abruf", pfade.anfragenAn("GET /api/v1/parts").isEmpty())
        vorher.cancel()
        t.sitzung.anmeldungGeaendert(pfade.server.url("/").toString(), angemeldet = true)
        assertTrue("ohne Beobachter kein Abruf", pfade.anfragenAn("GET /api/v1/parts").isEmpty())
        val seite = CoroutineScope(takt).launch { vm.teileState.collect {} }
        for (pfad in listOf("GET /api/v1/parts?", "GET /api/v1/parts/brick-colors", "GET /api/v1/parts/colors", "GET /api/v1/parts/categories"))
            assertTrue(pfad, pfade.anfragenAn(pfad).isNotEmpty())
        seite.cancel()

        CoroutineScope(takt).launch { fig.figurenZustand.collect {} }.cancel()
        val figurenAbrufe = pfade.anfragenAn("GET /api/v1/minifigs").size
        assertTrue("die Figuren geladen", figurenAbrufe > 0 && fig.figurenZustand.value.minifigs.isNotEmpty())
        CoroutineScope(takt).launch { fig.figurenZustand.collect {} }.cancel()
        assertEquals("schon da: nicht noch einmal", figurenAbrufe, pfade.anfragenAn("GET /api/v1/minifigs").size)
    }

    @Test
    fun `Suchtext und Lagerort erreichen auch die manuell erfassten Stuecke`() {
        // Sonst filtert der Text die Set-Teile, und die manuellen Kacheln
        // darüber bleiben stehen.
        val vm = vm()
        vm.setLagerFilter(ScopeFilter.View.PARTS, "Keller")
        vm.setPartsQuery("stein")
        vm.loadParts()
        assertTrue("manuelle Teile", pfade.anfragenAn("GET /api/v1/parts/manual?").any { "search=stein" in it })
        val teile = pfade.anfragenAn("GET /api/v1/parts/manual?").last { "search=stein" in it }
        assertTrue(teile, "storage=Keller" in teile)

        // Ohne Kontofilter sucht die Figurensuche in der Ablage; abgerufen wird ungefiltert.
        val fig = figurenVm()
        fig.setMinifigsQuery("han")
        fig.loadMinifigs()
        val figuren = pfade.anfragenAn("GET /api/v1/minifigs/manual")
        assertTrue("manuelle Figuren abgerufen: $figuren", figuren.isNotEmpty() && figuren.none { "search=" in it })
    }

    @Test
    fun `der Kontofilter der Figuren reist mit Liste, Kennzahlen und manuellen Figuren`() {
        val vm = figurenVm()
        vm.setScope(ScopeFilter.View.MINIFIGS, "own")
        for (pfad in listOf("GET /api/v1/minifigs?", "GET /api/v1/minifigs/stats?", "GET /api/v1/minifigs/manual?")) {
            assertTrue(pfad, pfade.anfragenAn(pfad).any { "accounts=own" in it })
        }
    }

    @Test
    fun `der Kontofilter der Teile reist mit, der einer anderen Ansicht nicht`() {
        val vm = vm()
        vm.setScope(ScopeFilter.View.PARTS, "own")
        assertTrue("Liste geladen", vm.teileState.value.parts.isNotEmpty())
        assertTrue("accounts=own" in pfade.anfragenAn("GET /api/v1/parts?").last())
        val vorher = pfade.anfragenAn("GET /api/v1/parts?").size
        vm.setScope(ScopeFilter.View.GALLERY, "own")
        assertEquals(vorher, pfade.anfragenAn("GET /api/v1/parts?").size)
    }

    @Test
    fun `ein geaendertes Teil steht in der Ablage, ohne die Liste neu zu holen`() {
        pfade.antworten["/api/v1/parts/manual"] = """{"success":true,"parts":[{"part_number":"3001","color_id":5,"quantity":1}]}"""
        val vm = vm()
        vm.loadParts()
        assertEquals(listOf(1), vm.teileState.value.manualParts?.map { it.quantity })
        val abrufe = pfade.anfragenAn("GET /api/v1/parts/manual").size
        vm.updatePart("3001", 5, quantity = 3, unitPrice = 0.1)
        assertEquals("die neue Menge aus der Ablage", listOf(3), vm.teileState.value.manualParts?.map { it.quantity })
        assertEquals("ohne neuen Abruf", abrufe, pfade.anfragenAn("GET /api/v1/parts/manual").size)
        assertEquals("t${R.string.vm_saved}", t.meldungen.text)
        assertTrue(pfade.anfragenAn("PUT /api/v1/parts/3001/5").isNotEmpty())
    }

    @Test
    fun `ein Fehler, den die Sitzungsschicht schon meldet, bleibt still`() {
        pfade.codes["/api/v1/parts/3001/5"] = 401
        val vm = vm()
        vm.deletePart("3001", 5)
        assertTrue("Antwort da", pfade.anfragenAn("DELETE /api/v1/parts/3001/5").isNotEmpty())
        assertNull("Ein 401 ist schon gemeldet — hier kein zweiter, leerer Satz", t.meldungen.text)
    }

    @Test
    fun `der Lagerort wird entprellt gespeichert und im offenen Dialog gezeigt`() {
        val vm = vm()
        vm.oeffneSetItem("3001", 5)
        assertTrue("Dialog geladen", !vm.setItemState.value.abruf.laedt)
        assertEquals("75192-1", vm.setItemState.value.sets.single().setNumber)

        vm.setzeTeilLagerort("3001", 5, "Ki")
        vm.setzeTeilLagerort("3001", 5, "Kiste 3")
        uhr.advanceTimeBy(500)
        assertTrue("Vor der Ruhezeit geht nichts hinaus", pfade.anfragenAn("PUT /api/v1/parts/3001/5/storage").isEmpty())
        uhr.advanceTimeBy(400)
        assertTrue("gespeichert", vm.setItemState.value.kopf?.storage == "Kiste 3")
        assertEquals(1, pfade.anfragenAn("PUT /api/v1/parts/3001/5/storage").size)
    }

    @Test
    fun `nach dem Abmelden ist nichts mehr da`() {
        val gemerkt = SavedStateHandle()
        val vm = vm(gemerkt)
        vm.setPartsColorFilter("Red")
        vm.oeffneSetItem("3001", 5)
        assertTrue("geladen", vm.teileState.value.parts.isNotEmpty() && !vm.setItemState.value.abruf.laedt)
        t.sitzung.abgemeldet()
        assertTrue(vm.teileState.value.parts.isEmpty())
        assertTrue(!vm.setItemState.value.offen)
        assertEquals(Teilefilter(), vm(gemerkt).teileState.value.filter)
    }
}
