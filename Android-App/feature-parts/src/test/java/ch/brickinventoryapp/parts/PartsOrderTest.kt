package ch.brickinventoryapp.parts

import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.data.testing.PathServer
import ch.brickinventoryapp.model.domain.PartView
import ch.brickinventoryapp.parts.ui.PartsFilter
import ch.brickinventoryapp.parts.ui.sorted
import ch.brickinventoryapp.parts.ui.viewmodel.PartsViewModel
import ch.brickinventoryapp.state.testing.TestServices
import ch.brickinventoryapp.state.testing.newProcess
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
 * Counter-checks (measured with kotlinc against PartsOrder.kt and stubs of PartView and
 * PartsUiState; the ViewModel part needs Android and is measured in the CI):
 *   teile-menge-aufsteigend   QUANTITY without Descending → red “every order …”
 *   teile-name-ohne-farbe     NAME without the second key, color → red “every order …”
 *   teile-ordnung-vergessen   setPartsOrder does not write to the SavedStateHandle → red “the order …”
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PartsOrderTest {

    private fun part(number: String, name: String?, color: String?, quantity: Int, colorId: Int = 0) =
        PartView(partNumber = number, partName = name, colorId = colorId, colorName = color, totalQuantity = quantity)

    // White has a lower color id than Tan: without color as a key, the order flips.
    private val white = part("3001", "Brick 2 x 4", "White", 10, 15)
    private val tan = part("3001", "Brick 2 x 4", "Tan", 5, 19)
    private val plate = part("3020", "Plate 2 x 4", "Blue", 50, 1)
    private val withoutName = part("9999", null, "Black", 1, 0)

    @Test
    fun `every order sorts like the server`() {
        val all = listOf(white, plate, withoutName, tan)
        assertEquals("Color, then name", listOf(withoutName, plate, tan, white),
            sorted(all, PartsFilter.Order.COLOR))
        assertEquals("Name, then color; without a name last", listOf(tan, white, plate, withoutName),
            sorted(all, PartsFilter.Order.NAME))
        assertEquals("Quantity descending", listOf(plate, white, tan, withoutName),
            sorted(all, PartsFilter.Order.QUANTITY))
    }

    // ── At the ViewModel: reordering, without reloading, and remembered ──

    private val clock = TestCoroutineScheduler()
    private val tick = UnconfinedTestDispatcher(clock)
    private lateinit var paths: PathServer
    private lateinit var t: TestServices

    private fun vm(wanted: SavedStateHandle = SavedStateHandle(), t: TestServices = this.t) =
        t.track(PartsViewModel(t.session, t.filter(), t.hints, t.changes, t.scrollMemory, t.parts(), t.accountView, wanted))

    @Before
    fun setUp() {
        Dispatchers.setMain(tick)
        paths = PathServer(
            "/api/v2/parts" to """{"success":true,"total":3,"parts":[
                {"part_number":"3001","part_name":"Brick 2 x 4","color_id":15,"color_name":"White","total_quantity":10},
                {"part_number":"3001","part_name":"Brick 2 x 4","color_id":19,"color_name":"Tan","total_quantity":5},
                {"part_number":"3020","part_name":"Plate 2 x 4","color_id":1,"color_name":"Blue","total_quantity":50}]}""",
            "/api/v2/parts/manual" to """{"success":true,"parts":[]}""",
            "/api/v2/parts/stats" to """{"success":true}""",
        )
        t = TestServices(paths.onTick(), io = tick)
    }

    @After
    fun tearDown() {
        t.cleanUp()
        Dispatchers.resetMain()
        paths.server.shutdown()
    }

    private fun PartsViewModel.series() = partsState.value.parts.map { "${it.partNumber}/${it.colorName}" }

    @Test
    fun `the order re-sorts the loaded list and survives a process death`() {
        val wanted = SavedStateHandle()
        val vm = vm(wanted)
        vm.loadParts()
        assertEquals(listOf("3020/Blue", "3001/Tan", "3001/White"), vm.series())
        val fetches = paths.requestsTo("GET /api/v2/parts?").size

        vm.setPartsOrder(PartsFilter.Order.QUANTITY)
        assertEquals(listOf("3020/Blue", "3001/White", "3001/Tan"), vm.series())
        assertEquals("Re-sorting does not reload", fetches, paths.requestsTo("GET /api/v2/parts?").size)

        paths.newProcess(io = tick) { _, t ->
            val newValue = vm(wanted, t)
            assertEquals(PartsFilter.Order.QUANTITY, newValue.partsState.value.filter.order)
            newValue.loadParts()
            assertEquals(listOf("3020/Blue", "3001/White", "3001/Tan"), newValue.series())
        }
    }
}
