package ch.brickinventoryapp

import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.data.ScopeFilter
import ch.brickinventoryapp.data.model.SetAggregate
import ch.brickinventoryapp.data.repository.FinanzenRepository
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.ui.Aenderung
import ch.brickinventoryapp.ui.viewmodel.GalerieViewModel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestCoroutineScheduler
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Das Galerie-ViewModel, ausgeführt gegen einen Testserver.
 *
 * Gegenproben (am 28.10.2026 gemessen, kotlinc gegen GalerieViewModel.kt):
 *   A  im init die gemerkte Suche nicht übernommen → rot „Suche, Thema und
 *      Sortierung überstehen …“
 *   B  in nachFilter() die Bedingung umgekehrt → rot „Konto- und Lagerfilter
 *      der Galerie reisen mit …“
 *   C  in deleteSet() Teile und Figuren nicht gemeldet → rot „ein gelöschtes
 *      Set verschwindet …“
 *   D  im Zweig SetZusammenfassung `loadSets()` statt der Kachel-Änderung →
 *      rot „ein geänderter Kauf ändert die Kachel, ohne die Liste neu zu holen“
 */
@OptIn(ExperimentalCoroutinesApi::class)
class GalerieViewModelTest {

    private val uhr = TestCoroutineScheduler()
    private lateinit var pfade: PfadServer
    private lateinit var t: TestDienste

    private fun vm(gemerkt: SavedStateHandle = SavedStateHandle()) = t.merke(GalerieViewModel(
        t.dienste, SetsRepository(t.api, t.cache), FinanzenRepository(t.api, t.cache), gemerkt))

    private fun abrufe() = pfade.anfragenAn("GET /api/v1/sets?") + pfade.anfragenAn("GET /api/v1/sets ")

    @Before
    fun auf() {
        Dispatchers.setMain(UnconfinedTestDispatcher(uhr))
        pfade = PfadServer(
            "/api/v1/sets" to """{"success":true,"total":2,"sets":[
                {"set_number":"75192-1","name":"Falke","used_count":0},{"set_number":"10294-1","name":"Titanic"}]}""",
            "/api/v1/stats" to """{"success":true,"stats":{"total_sets":2}}""",
            "/api/v1/sets/10294-1" to """{"success":true}""",
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
    fun `Suche, Thema und Sortierung ueberstehen einen Prozess-Tod und reisen mit`() {
        val gemerkt = SavedStateHandle()
        val erstes = vm(gemerkt)
        erstes.setGalleryTheme("Technic")
        erstes.setGallerySort("year_desc")
        erstes.setGalleryQuery("Falke")

        val neu = vm(gemerkt)
        val g = neu.galleryState.value
        assertEquals(Triple("Falke", "Technic", "year_desc"), Triple(g.galleryQuery, g.galleryTheme, g.gallerySort))
        neu.loadSets()
        TestApi.warteBis("Liste geladen") { neu.galleryState.value.sets.isNotEmpty() }
        val abruf = abrufe().last()
        assertTrue(abruf, "search=Falke" in abruf && "theme=Technic" in abruf && "sort=year_desc" in abruf)
    }

    @Test
    fun `Konto- und Lagerfilter der Galerie reisen mit und laden Liste und Kennzahlen`() {
        val vm = vm()
        vm.setScope(ScopeFilter.View.GALLERY, "own")
        TestApi.warteBis("Liste und Kennzahlen") {
            vm.galleryState.value.sets.isNotEmpty() && vm.galleryState.value.stats != null
        }
        assertTrue("accounts=own" in abrufe().last())
        assertTrue("accounts=own" in pfade.anfragenAn("GET /api/v1/stats").last())

        vm.setLagerFilter(ScopeFilter.View.GALLERY, "Regal")
        TestApi.warteBis("neu geladen") { abrufe().size >= 2 }
        assertTrue(abrufe().last(), "storage=Regal" in abrufe().last())
    }

    @Test
    fun `ein geloeschtes Set verschwindet und alle Bestandsansichten erfahren davon`() {
        val vm = vm()
        vm.loadSets()
        TestApi.warteBis("Liste geladen") { vm.galleryState.value.sets.size == 2 }
        val gemeldet = mutableListOf<Aenderung>()
        val sammler = CoroutineScope(Dispatchers.Main).launch { t.bestand.aenderungen.toList(gemeldet) }
        // Der Testserver liefert die Liste danach unverändert — die Kachel muss
        // trotzdem sofort weg sein, nicht erst nach dem Nachladen.
        pfade.antworten["/api/v1/sets"] = """{"success":true,"total":1,"sets":[{"set_number":"75192-1"}]}"""
        vm.deleteSet("10294-1")
        TestApi.warteBis("gemeldet") { gemeldet.size == 3 }
        sammler.cancel()
        assertEquals(listOf(Aenderung.Sets, Aenderung.Teile, Aenderung.Figuren), gemeldet)
        assertTrue(pfade.anfragenAn("DELETE /api/v1/sets/10294-1").isNotEmpty())
        TestApi.warteBis("Liste ohne das Set") { vm.galleryState.value.sets.none { it.setNumber == "10294-1" } }
    }

    @Test
    fun `ein geaenderter Kauf aendert die Kachel, ohne die Liste neu zu holen`() {
        val vm = vm()
        vm.loadSets()
        TestApi.warteBis("Liste geladen") { vm.galleryState.value.sets.size == 2 }
        val vorher = abrufe().size

        t.bestand.melde(Aenderung.SetZusammenfassung(SetAggregate(setNumber = "75192-1", usedCount = 1)))
        TestApi.warteBis("Kennzahlen neu") { pfade.anfragenAn("GET /api/v1/stats").isNotEmpty() }
        assertEquals(1, vm.galleryState.value.sets.first { it.setNumber == "75192-1" }.usedCount)
        assertEquals("Die Liste darf nicht neu geholt werden", vorher, abrufe().size)
    }

    @Test
    fun `nach dem Abmelden ist die Galerie leer und ohne Filter`() {
        val gemerkt = SavedStateHandle()
        val vm = vm(gemerkt)
        vm.setGalleryTheme("Technic")
        TestApi.warteBis("Liste geladen") { vm.galleryState.value.sets.isNotEmpty() }
        t.sitzung.abgemeldet()
        assertTrue(vm.galleryState.value.sets.isEmpty())
        assertEquals("", vm.galleryState.value.galleryTheme)
        assertEquals("", vm(gemerkt).galleryState.value.galleryTheme)
    }
}
