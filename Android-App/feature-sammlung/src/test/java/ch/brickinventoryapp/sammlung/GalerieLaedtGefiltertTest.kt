package ch.brickinventoryapp.sammlung

import kotlinx.coroutines.ExperimentalCoroutinesApi
import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.sammlung.ui.viewmodel.GalerieViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import ch.brickinventoryapp.testing.FinanzenRepository
import ch.brickinventoryapp.testing.PfadServer
import ch.brickinventoryapp.testing.TestDienste

/**
 * Wer die Galerie über gewählte Konten lädt, führt mit, was die Galerie anzeigt:
 * Die Kontosicht fragt den Server mit Blickfeld, Suche, Thema und Sortierung,
 * und zwar jede Seite — sonst hinge an einer gefilterten ersten Seite eine
 * ungefilterte zweite.
 *
 * Gegenprobe: in GalerieViewModel.kontoAbfrage die Suche auf null gesetzt → rot
 * „jede Seite der Kontosicht trägt Blickfeld und Filter“.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class GalerieLaedtGefiltertTest {

    @Test
    fun `jede Seite der Kontosicht traegt Blickfeld und Filter`() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        val pfade = PfadServer("/api/v1/sets" to """{"success":true,"total":2,"sets":[
            {"set_number":"75192-1","name":"Falke"},{"set_number":"10294-1","name":"Titanic"}]}""",
            "/api/v1/stats" to """{"success":true,"stats":{"total_sets":5,"total_quantity":5,"total_pieces":0,"total_instructions":0,"total_parts":0,"total_minifigs":0}}""")
        val t = TestDienste(pfade.imTakt(), io = Dispatchers.Main)
        try {
            val gemerkt = SavedStateHandle(mapOf("galerie_suche" to "Falke",
                "galerie_thema" to "Star Wars", "galerie_sortierung" to "year_desc"))
            val vm = t.merke(GalerieViewModel(t.sitzung, t.filter(), t.hinweise, t.aenderungen, t.scrollMemory, t.sets(),
                t.kontosicht, FinanzenRepository(t.api), gemerkt))
            vm.setScope(ScopeFilter.View.GALLERY, "own")
            assertEquals(listOf("75192-1", "10294-1"), vm.galleryState.value.sets.map { it.setNumber })
            val abrufe = pfade.anfragenAn("GET /api/v1/sets?")
            assertTrue("kein Abruf", abrufe.isNotEmpty())
            for (a in abrufe) for (teil in listOf("accounts=own", "search=Falke", "theme=Star%20Wars", "sort=year_desc")) {
                assertTrue("$a ohne $teil", teil in a)
            }
        } finally {
            t.aufraeumen()
            Dispatchers.resetMain()
            pfade.server.shutdown()
        }
    }
}
