package ch.brickinventoryapp

import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.data.ScopeFilter
import ch.brickinventoryapp.data.repository.TeileRepository
import ch.brickinventoryapp.ui.Aenderung
import ch.brickinventoryapp.ui.viewmodel.TeileViewModel
import kotlinx.coroutines.Dispatchers
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

/**
 * Das Teile-ViewModel, ausgeführt gegen einen Testserver; die Ruhezeit des
 * Lagerortfelds läuft auf der Testuhr.
 *
 * Gegenproben (am 28.10.2026 gemessen, kotlinc gegen TeileViewModel.kt):
 *   A  in setPartsColorFilter() das Schreiben in den SavedStateHandle entfernt
 *      → rot „Filter und Ansicht überstehen …“
 *   B  in aendere() das Melden ans Bestandssignal entfernt → rot „ein
 *      geändertes Teil wird gemeldet …“
 *   C  in aendere() wieder `fehler ?: text(err_unknown)` → rot „ein Fehler,
 *      den die Sitzungsschicht schon meldet, bleibt still“
 *   D  in setzeTeilLagerort() die Ruhezeit entfernt → rot „der Lagerort wird
 *      entprellt gespeichert …“
 *   E  getManualParts ohne Lagerort, oder getManualMinifigs ohne Suchtext →
 *      je rot „Suchtext und Lagerort erreichen auch die manuell erfassten …“
 *   F  getMinifigStats ohne Blickfeld → rot „der Kontofilter der Figuren …“
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TeileViewModelTest {

    private val uhr = TestCoroutineScheduler()
    private lateinit var pfade: PfadServer
    private lateinit var t: TestDienste

    private fun vm(gemerkt: SavedStateHandle = SavedStateHandle()) =
        t.merke(TeileViewModel(t.dienste, TeileRepository(t.api, t.cache), gemerkt))

    @Before
    fun auf() {
        Dispatchers.setMain(UnconfinedTestDispatcher(uhr))
        pfade = PfadServer(
            "/api/v1/parts" to """{"success":true,"total":1,"parts":[{"part_number":"3001","color_id":5}]}""",
            "/api/v1/parts/manual" to """{"success":true,"parts":[]}""",
            "/api/v1/minifigs" to """{"success":true,"figs":[{"fig_number":"sw0001"}]}""",
            "/api/v1/parts/stats" to """{"success":true}""",
            "/api/v1/parts/3001/5" to """{"success":true}""",
            "/api/v1/parts/3001/5/storage" to """{"success":true,"storage":"Kiste 3"}""",
            "/api/v1/parts/3001/5/sets" to """{"success":true,"item":{"nummer":"3001","color_id":5},
                "sets":[{"set_number":"75192-1","quantity":4}]}""",
        )
        t = TestDienste(pfade.server)
    }

    @After
    fun zu() {
        t.aufraeumen()
        Dispatchers.resetMain()
        pfade.server.shutdown()
    }

    @Test
    fun `Filter und Ansicht ueberstehen einen Prozess-Tod und reisen mit`() {
        val gemerkt = SavedStateHandle()
        val erstes = vm(gemerkt)
        erstes.setPartsColorFilter("5")
        erstes.setPartsCategoryFilter("11")
        erstes.setPartsSpare("1")
        erstes.setPartsView("table")

        val neu = vm(gemerkt)
        val st = neu.partsState.value
        assertEquals(listOf("5", "11", "1", "table"),
            listOf(st.partsColorFilter, st.partsCategoryFilter, st.partsSpare, st.partsView))
        neu.loadParts()
        TestApi.warteBis("Liste geladen") { neu.partsState.value.parts.isNotEmpty() }
        val abruf = pfade.anfragenAn("GET /api/v1/parts?").last()
        assertTrue(abruf, listOf("color=5", "category=11", "spare=1", "with_sets=1").all { it in abruf })
    }

    @Test
    fun `Suchtext und Lagerort erreichen auch die manuell erfassten Stuecke`() {
        // Sonst filtert der Text die Set-Teile, und die manuellen Kacheln
        // darüber bleiben stehen (Marcos Befund an den Teilen).
        val vm = vm()
        vm.setLagerFilter(ScopeFilter.View.PARTS, "Keller")
        vm.setPartsQuery("stein")
        vm.loadParts()
        TestApi.warteBis("manuelle Teile") {
            pfade.anfragenAn("GET /api/v1/parts/manual?").any { "search=stein" in it }
        }
        val teile = pfade.anfragenAn("GET /api/v1/parts/manual?").last { "search=stein" in it }
        assertTrue(teile, "storage=Keller" in teile)

        vm.setMinifigsQuery("han")
        vm.loadMinifigs()
        TestApi.warteBis("manuelle Figuren") {
            pfade.anfragenAn("GET /api/v1/minifigs/manual?").any { "search=han" in it }
        }
    }

    @Test
    fun `der Kontofilter der Figuren reist mit Liste, Kennzahlen und manuellen Figuren`() {
        val vm = vm()
        vm.setScope(ScopeFilter.View.MINIFIGS, "own")
        for (pfad in listOf("GET /api/v1/minifigs?", "GET /api/v1/minifigs/stats?", "GET /api/v1/minifigs/manual?")) {
            TestApi.warteBis(pfad) { pfade.anfragenAn(pfad).any { "accounts=own" in it } }
        }
    }

    @Test
    fun `der Kontofilter der Teile reist mit, der einer anderen Ansicht nicht`() {
        val vm = vm()
        vm.setScope(ScopeFilter.View.PARTS, "own")
        TestApi.warteBis("Liste geladen") { vm.partsState.value.parts.isNotEmpty() }
        assertTrue("accounts=own" in pfade.anfragenAn("GET /api/v1/parts?").last())
        val vorher = pfade.anfragenAn("GET /api/v1/parts?").size
        vm.setScope(ScopeFilter.View.GALLERY, "own")
        Thread.sleep(200)
        assertEquals(vorher, pfade.anfragenAn("GET /api/v1/parts?").size)
    }

    @Test
    fun `ein geaendertes Teil wird gemeldet und die Liste laedt neu`() {
        val vm = vm()
        val liste = t.gemeldet(1) {
            vm.updatePart("3001", 5, quantity = 3, unitPrice = 0.1)
            TestApi.warteBis("Liste nachgeladen") { vm.partsState.value.parts.isNotEmpty() }
        }
        assertEquals(listOf(Aenderung.Teile), liste)
        assertEquals("t${R.string.vm_saved}", t.meldungen.meldung.value)
        assertTrue(pfade.anfragenAn("PUT /api/v1/parts/3001/5").isNotEmpty())
    }

    @Test
    fun `ein Fehler, den die Sitzungsschicht schon meldet, bleibt still`() {
        pfade.codes["/api/v1/parts/3001/5"] = 401
        val vm = vm()
        val liste = t.gemeldet(0) {
            vm.deletePart("3001", 5)
            TestApi.warteBis("Antwort da") { pfade.anfragenAn("DELETE /api/v1/parts/3001/5").isNotEmpty() }
            Thread.sleep(200)
        }
        assertTrue(liste.isEmpty())
        assertNull("Ein 401 ist schon gemeldet — hier kein zweiter, leerer Satz", t.meldungen.meldung.value)
    }

    @Test
    fun `der Lagerort wird entprellt gespeichert und im offenen Dialog gezeigt`() {
        val vm = vm()
        vm.oeffneSetItem("part", "3001", 5)
        TestApi.warteBis("Dialog geladen") { !vm.setItemState.value.laedt }
        assertEquals("75192-1", vm.setItemState.value.sets.single().setNumber)

        vm.setzeTeilLagerort("3001", 5, "Ki")
        vm.setzeTeilLagerort("3001", 5, "Kiste 3")
        uhr.advanceTimeBy(500)
        Thread.sleep(200)   // ein schon abgeschickter Abruf hätte den Server jetzt erreicht
        assertTrue("Vor der Ruhezeit geht nichts hinaus", pfade.anfragenAn("/storage").isEmpty())
        uhr.advanceTimeBy(400)
        TestApi.warteBis("gespeichert") { vm.setItemState.value.kopf?.storage == "Kiste 3" }
        assertEquals(1, pfade.anfragenAn("PUT /api/v1/parts/3001/5/storage").size)
    }

    @Test
    fun `nach dem Abmelden ist nichts mehr da`() {
        val gemerkt = SavedStateHandle()
        val vm = vm(gemerkt)
        vm.setPartsColorFilter("5")
        vm.oeffneSetItem("part", "3001", 5)
        TestApi.warteBis("geladen") { vm.partsState.value.parts.isNotEmpty() && !vm.setItemState.value.laedt }
        t.sitzung.abgemeldet()
        assertTrue(vm.partsState.value.parts.isEmpty())
        assertTrue(!vm.setItemState.value.offen)
        assertEquals("", vm(gemerkt).partsState.value.partsColorFilter)
    }
}
