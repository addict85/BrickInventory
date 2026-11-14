package ch.brickinventoryapp.teile

import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.model.ui.model.TeilAnsicht
import ch.brickinventoryapp.teile.ui.PartsUiState
import ch.brickinventoryapp.teile.ui.sortiert
import ch.brickinventoryapp.teile.ui.viewmodel.TeileViewModel
import ch.brickinventoryapp.testing.PfadServer
import ch.brickinventoryapp.testing.TestDienste
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestCoroutineScheduler
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

/**
 * Die Reihenfolge der Teile wie parts-ordnung der Webapp: nach Farbe, Name oder Menge, mit
 * denselben Schlüsseln wie der Server. Umsortieren lädt nichts nach und übersteht einen
 * Prozess-Tod wie die übrigen Filter.
 *
 * Gegenproben (gemessen mit kotlinc gegen TeileOrdnung.kt und Attrappen von TeilAnsicht und
 * PartsUiState; der ViewModel-Teil braucht Android und misst in der CI):
 *   teile-menge-aufsteigend   MENGE ohne Descending → rot „jede Reihenfolge …“
 *   teile-name-ohne-farbe     NAME ohne den zweiten Schlüssel Farbe → rot „jede Reihenfolge …“
 *   teile-ordnung-vergessen   setPartsOrdnung schreibt nicht in den SavedStateHandle → rot „die Reihenfolge …“
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TeileOrdnungTest {

    private fun teil(nummer: String, name: String?, farbe: String?, menge: Int, farbId: Int = 0) =
        TeilAnsicht(partNumber = nummer, partName = name, colorId = farbId, colorName = farbe, totalQuantity = menge)

    // Weiss hat die kleinere Farb-Id als Tan: Fehlt die Farbe als Schlüssel, kippt die Reihenfolge.
    private val weiss = teil("3001", "Brick 2 x 4", "White", 10, 15)
    private val tan = teil("3001", "Brick 2 x 4", "Tan", 5, 19)
    private val platte = teil("3020", "Plate 2 x 4", "Blue", 50, 1)
    private val ohneName = teil("9999", null, "Black", 1, 0)

    @Test
    fun `jede Reihenfolge sortiert wie der Server`() {
        val alle = listOf(weiss, platte, ohneName, tan)
        assertEquals("Farbe, dann Name", listOf(ohneName, platte, tan, weiss),
            sortiert(alle, PartsUiState.Ordnung.FARBE))
        assertEquals("Name, dann Farbe; ohne Namen zuletzt", listOf(tan, weiss, platte, ohneName),
            sortiert(alle, PartsUiState.Ordnung.NAME))
        assertEquals("Menge absteigend", listOf(platte, weiss, tan, ohneName),
            sortiert(alle, PartsUiState.Ordnung.MENGE))
    }

    // ── Am ViewModel: umsortieren, ohne nachzuladen, und gemerkt ──

    private val uhr = TestCoroutineScheduler()
    private val takt = UnconfinedTestDispatcher(uhr)
    private lateinit var pfade: PfadServer
    private lateinit var t: TestDienste

    private fun vm(gemerkt: SavedStateHandle = SavedStateHandle(), t: TestDienste = this.t) =
        t.merke(TeileViewModel(t.sitzung, t.filter(), t.hinweise, t.aenderungen, t.scrollMemory, t.teile(), t.figuren(), t.kontosicht, gemerkt))

    @Before
    fun auf() {
        Dispatchers.setMain(takt)
        pfade = PfadServer(
            "/api/v1/parts" to """{"success":true,"total":3,"parts":[
                {"part_number":"3001","part_name":"Brick 2 x 4","color_id":15,"color_name":"White","total_quantity":10},
                {"part_number":"3001","part_name":"Brick 2 x 4","color_id":19,"color_name":"Tan","total_quantity":5},
                {"part_number":"3020","part_name":"Plate 2 x 4","color_id":1,"color_name":"Blue","total_quantity":50}]}""",
            "/api/v1/parts/manual" to """{"success":true,"parts":[]}""",
            "/api/v1/parts/stats" to """{"success":true}""",
        )
        t = TestDienste(pfade.imTakt(), io = takt)
    }

    @After
    fun zu() {
        t.aufraeumen()
        Dispatchers.resetMain()
        pfade.server.shutdown()
    }

    private fun TeileViewModel.reihe() = partsState.value.parts.map { "${it.partNumber}/${it.colorName}" }

    @Test
    fun `die Reihenfolge sortiert die geladene Liste um und uebersteht einen Prozess-Tod`() {
        val gemerkt = SavedStateHandle()
        val vm = vm(gemerkt)
        vm.loadParts()
        assertEquals(listOf("3020/Blue", "3001/Tan", "3001/White"), vm.reihe())
        val abrufe = pfade.anfragenAn("GET /api/v1/parts?").size

        vm.setPartsOrdnung(PartsUiState.Ordnung.MENGE)
        assertEquals(listOf("3020/Blue", "3001/White", "3001/Tan"), vm.reihe())
        assertEquals("Umsortieren lädt nicht nach", abrufe, pfade.anfragenAn("GET /api/v1/parts?").size)

        pfade.neuerProzess(io = takt) { _, t ->
            val neu = vm(gemerkt, t)
            assertEquals(PartsUiState.Ordnung.MENGE, neu.partsState.value.partsOrdnung)
            neu.loadParts()
            assertEquals(listOf("3020/Blue", "3001/White", "3001/Tan"), neu.reihe())
        }
    }
}
