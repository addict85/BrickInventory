package ch.brickinventoryapp.parts

import ch.brickinventoryapp.parts.ui.Teilefilter
import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.model.domain.TeilAnsicht
import ch.brickinventoryapp.parts.ui.sortiert
import ch.brickinventoryapp.parts.ui.viewmodel.PartsViewModel
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
 * The order of the parts like parts-ordnung in the web app: by color, name or quantity, with
 * the same keys as the server. Reordering loads nothing anew and survives a
 * process death like the other filters.
 *
 * Counter-checks (measured with kotlinc against TeileOrdnung.kt and stubs of TeilAnsicht and
 * PartsUiState; the ViewModel part needs Android and is measured in the CI):
 *   teile-menge-aufsteigend   QUANTITY without Descending → red “every order …”
 *   teile-name-ohne-farbe     NAME without the second key, color → red “every order …”
 *   teile-ordnung-vergessen   setPartsOrder does not write to the SavedStateHandle → red “the order …”
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PartsOrderTest {

    private fun teil(nummer: String, name: String?, farbe: String?, menge: Int, farbId: Int = 0) =
        TeilAnsicht(partNumber = nummer, partName = name, colorId = farbId, colorName = farbe, totalQuantity = menge)

    // White has a lower color id than Tan: without color as a key, the order flips.
    private val weiss = teil("3001", "Brick 2 x 4", "White", 10, 15)
    private val tan = teil("3001", "Brick 2 x 4", "Tan", 5, 19)
    private val platte = teil("3020", "Plate 2 x 4", "Blue", 50, 1)
    private val withoutName = teil("9999", null, "Black", 1, 0)

    @Test
    fun `every order sorts like the server`() {
        val alle = listOf(weiss, platte, withoutName, tan)
        assertEquals("Farbe, dann Name", listOf(withoutName, platte, tan, weiss),
            sortiert(alle, Teilefilter.Order.FARBE))
        assertEquals("Name, dann Farbe; ohne Namen zuletzt", listOf(tan, weiss, platte, withoutName),
            sortiert(alle, Teilefilter.Order.NAME))
        assertEquals("Menge absteigend", listOf(platte, weiss, tan, withoutName),
            sortiert(alle, Teilefilter.Order.QUANTITY))
    }

    // ── At the ViewModel: reordering, without reloading, and remembered ──

    private val clock = TestCoroutineScheduler()
    private val takt = UnconfinedTestDispatcher(clock)
    private lateinit var paths: PfadServer
    private lateinit var t: TestDienste

    private fun vm(gemerkt: SavedStateHandle = SavedStateHandle(), t: TestDienste = this.t) =
        t.merke(PartsViewModel(t.sitzung, t.filter(), t.hinweise, t.changes, t.scrollMemory, t.teile(), t.kontosicht, gemerkt))

    @Before
    fun auf() {
        Dispatchers.setMain(takt)
        paths = PfadServer(
            "/api/v1/parts" to """{"success":true,"total":3,"parts":[
                {"part_number":"3001","part_name":"Brick 2 x 4","color_id":15,"color_name":"White","total_quantity":10},
                {"part_number":"3001","part_name":"Brick 2 x 4","color_id":19,"color_name":"Tan","total_quantity":5},
                {"part_number":"3020","part_name":"Plate 2 x 4","color_id":1,"color_name":"Blue","total_quantity":50}]}""",
            "/api/v1/parts/manual" to """{"success":true,"parts":[]}""",
            "/api/v1/parts/stats" to """{"success":true}""",
        )
        t = TestDienste(paths.imTakt(), io = takt)
    }

    @After
    fun zu() {
        t.aufraeumen()
        Dispatchers.resetMain()
        paths.server.shutdown()
    }

    private fun PartsViewModel.series() = teileState.value.parts.map { "${it.partNumber}/${it.colorName}" }

    @Test
    fun `the order re-sorts the loaded list and survives a process death`() {
        val gemerkt = SavedStateHandle()
        val vm = vm(gemerkt)
        vm.loadParts()
        assertEquals(listOf("3020/Blue", "3001/Tan", "3001/White"), vm.series())
        val fetches = paths.requestsAn("GET /api/v1/parts?").size

        vm.setPartsOrder(Teilefilter.Order.QUANTITY)
        assertEquals(listOf("3020/Blue", "3001/White", "3001/Tan"), vm.series())
        assertEquals("Umsortieren lädt nicht nach", fetches, paths.requestsAn("GET /api/v1/parts?").size)

        paths.newProcess(io = takt) { _, t ->
            val neu = vm(gemerkt, t)
            assertEquals(Teilefilter.Order.QUANTITY, neu.teileState.value.filter.order)
            neu.loadParts()
            assertEquals(listOf("3020/Blue", "3001/White", "3001/Tan"), neu.series())
        }
    }
}
