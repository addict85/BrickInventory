package ch.brickinventoryapp.parts

import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.contract.BrickColor
import ch.brickinventoryapp.contract.Part
import ch.brickinventoryapp.contract.PartValuationItem
import ch.brickinventoryapp.contract.mapping.asView
import ch.brickinventoryapp.data.testing.PathServer
import ch.brickinventoryapp.data.testing.testPartsRepository
import ch.brickinventoryapp.model.domain.ItemKind
import ch.brickinventoryapp.model.domain.NO_COLOR
import ch.brickinventoryapp.model.domain.PartEntry
import ch.brickinventoryapp.model.json.BrickJson
import ch.brickinventoryapp.model.ui.colorName
import ch.brickinventoryapp.model.ui.withoutNoColor
import ch.brickinventoryapp.parts.ui.PartsTarget
import ch.brickinventoryapp.parts.ui.viewmodel.PartsViewModel
import ch.brickinventoryapp.state.testing.TestServices
import ch.brickinventoryapp.state.ui.ManualItemDetailUiState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * "Keine Farbe" is 9999 as on the server (`utils/validate.ts`, NO_COLOR);
 * 0 is black. The app sends 9999 for a part without a color, shows 9999 as
 * "keine Farbe" and does not take a missing color_id as black.
 *
 * Counter-checks:
 *   A  in Teilerfassung the default `colorId = 0` → red “a part
 *      without a color goes out as 9999” ("color_id":0)
 *   B  in PartsRepository.setPartColor the name sent along even for NO_COLOR
 *      → red “no color as a new color sends no name”
 *   C  in colorName() the check for NO_COLOR removed → red “9999 means
 *      no color, 0 stays black” ([No Color/Any Color] instead of none)
 *   D  in withoutNoColor() `!= NO_COLOR` replaced with `!= 0` → red there as well
 *   E  Part.colorId back to a default of 0 → red “a missing color_id is
 *      no color, not black”
 */
@OptIn(ExperimentalCoroutinesApi::class)
class NoColorTest {

    private val paths = PathServer(
        "/api/v1/parts" to """{"success":true,"action":"added","part_number":"3001"}""",
        "/api/v1/parts/3001/5/color" to """{"success":true}""",
    )
    private val t = TestServices(paths.onTick(), io = Dispatchers.Main)

    @Before
    fun setUp() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @After
    fun tearDown() {
        t.cleanUp()
        Dispatchers.resetMain()
        paths.server.shutdown()
    }

    private fun vm() = t.track(PartsViewModel(t.session, t.filter(), t.hints, t.changes, t.scrollMemory, testPartsRepository(t.api), t.accountView, SavedStateHandle()))

    private fun bodyTo(methodAndPath: String): String {
        val i = paths.requests.indexOfFirst { it == methodAndPath }
        assertTrue("no request $methodAndPath in ${paths.requests}", i >= 0)
        return paths.bodyBytes[i]
    }

    @Test
    fun `a part without a color goes out as 9999`() {
        vm().addPart(PartEntry("3001"))
        assertTrue("Part entered", paths.requestsTo("POST /api/v1/parts").isNotEmpty())
        val k = bodyTo("POST /api/v1/parts")
        assertTrue(k, k.contains("\"color_id\":9999"))
        // A name sent along does not count as "keine Farbe" either.
        vm().addPart(PartEntry("3002", NO_COLOR, "[No Color/Any Color]", "05131D"))
        assertTrue("second part", paths.requestsTo("POST /api/v1/parts").size == 2)
        val k2 = paths.bodyBytes[paths.requests.indexOfLast { it == "POST /api/v1/parts" }]
        assertFalse(k2, k2.contains("No Color") || k2.contains("05131D"))
    }

    @Test
    fun `no color as a new color sends no name`() {
        var newValue: Int? = null
        vm().setPartColor("3001", 5, NO_COLOR, "Keine Farbe", null) { newValue = it }
        assertTrue("changed", newValue != null)
        val k = bodyTo("PUT /api/v1/parts/3001/5/color")
        assertTrue(k, k.contains("\"color_id\":9999"))
        assertFalse(k, k.contains("Keine Farbe"))
        assertEquals(NO_COLOR, newValue)
    }

    @Test
    fun `9999 means no color, 0 stays black`() {
        val list = listOf(BrickColor(id = NO_COLOR, name = "[No Color/Any Color]"), BrickColor(id = 0, name = "Black", hex = "05131D"),
                           BrickColor(id = 4, name = "Red", hex = "C91A09")).map { it.asView() }
        assertEquals(listOf(0, 4), withoutNoColor(list).map { it.id })
        assertEquals("keine", colorName(list, NO_COLOR, "[No Color/Any Color]", "keine"))
        assertEquals("Black", colorName(list, 0, null, "keine"))
        assertEquals("Dark Tan", colorName(emptyList(), 69, "Dark Tan", "keine"))
        assertEquals(null, colorName(emptyList(), 69, " ", "keine"))
    }

    @Test
    fun `a missing color_id is no color, not black`() {
        assertEquals(NO_COLOR, BrickJson.decodeFromString(Part.serializer(), """{"part_number":"3001"}""").colorId)
        assertEquals(NO_COLOR, BrickJson.decodeFromString(PartValuationItem.serializer(), """{"part_number":"3001"}""").colorId)
        assertEquals(0, BrickJson.decodeFromString(Part.serializer(), """{"part_number":"3001","color_id":0}""").colorId)
        assertEquals(NO_COLOR, ManualItemDetailUiState().colorId)
        assertEquals(NO_COLOR, PartsTarget.ManualItemDetail(ItemKind.FIG, "sw0001", title = "Luke").colorId)
    }
}
