package ch.brickinventoryapp.parts

import ch.brickinventoryapp.model.domain.Teilerfassung
import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.contract.mapping.alsAnsicht
import ch.brickinventoryapp.model.json.BrickJson
import ch.brickinventoryapp.contract.BrickColor
import ch.brickinventoryapp.model.domain.KEINE_FARBE
import ch.brickinventoryapp.contract.Part
import ch.brickinventoryapp.contract.PartValuationItem
import ch.brickinventoryapp.testing.testPartsRepository
import ch.brickinventoryapp.state.ui.ManualItemDetailUiState
import ch.brickinventoryapp.model.domain.Postenart
import ch.brickinventoryapp.parts.ui.TeileZiel
import ch.brickinventoryapp.model.ui.farbName
import ch.brickinventoryapp.model.ui.withoutNoColor
import ch.brickinventoryapp.parts.ui.viewmodel.PartsViewModel
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
import ch.brickinventoryapp.testing.PfadServer
import ch.brickinventoryapp.testing.TestDienste

/**
 * "Keine Farbe" is 9999 as on the server (utils/validate.ts, KEINE_FARBE);
 * 0 is black. The app sends 9999 for a part without a color, shows 9999 as
 * "keine Farbe" and does not take a missing color_id as black.
 *
 * Counter-checks:
 *   A  in Teilerfassung the default `farbId = 0` → red “a part
 *      without a color goes out as 9999” ("color_id":0)
 *   B  in PartsRepository.setPartColor the name sent along even for KEINE_FARBE
 *      → red “no color as a new color sends no name”
 *   C  in farbName() the check for KEINE_FARBE removed → red “9999 means
 *      no color, 0 stays black” ([No Color/Any Color] instead of none)
 *   D  in withoutNoColor() `!= KEINE_FARBE` replaced with `!= 0` → red there as well
 *   E  Part.colorId back to a default of 0 → red “a missing color_id is
 *      no color, not black”
 */
@OptIn(ExperimentalCoroutinesApi::class)
class NoColorTest {

    private val paths = PfadServer(
        "/api/v1/parts" to """{"success":true,"action":"added","part_number":"3001"}""",
        "/api/v1/parts/3001/5/color" to """{"success":true}""",
    )
    private val t = TestDienste(paths.imTakt(), io = Dispatchers.Main)

    @Before
    fun auf() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @After
    fun zu() {
        t.aufraeumen()
        Dispatchers.resetMain()
        paths.server.shutdown()
    }

    private fun vm() = t.merke(PartsViewModel(t.sitzung, t.filter(), t.hinweise, t.changes, t.scrollMemory, testPartsRepository(t.api), t.kontosicht, SavedStateHandle()))

    private fun bodyTo(methodAndPath: String): String {
        val i = paths.requests.indexOfFirst { it == methodAndPath }
        assertTrue("keine Anfrage $methodAndPath in ${paths.requests}", i >= 0)
        return paths.koerper[i]
    }

    @Test
    fun `a part without a color goes out as 9999`() {
        vm().addPart(Teilerfassung("3001"))
        assertTrue("Teil erfasst", paths.requestsAn("POST /api/v1/parts").isNotEmpty())
        val k = bodyTo("POST /api/v1/parts")
        assertTrue(k, k.contains("\"color_id\":9999"))
        // A name sent along does not count as "keine Farbe" either.
        vm().addPart(Teilerfassung("3002", KEINE_FARBE, "[No Color/Any Color]", "05131D"))
        assertTrue("zweites Teil", paths.requestsAn("POST /api/v1/parts").size == 2)
        val k2 = paths.koerper[paths.requests.indexOfLast { it == "POST /api/v1/parts" }]
        assertFalse(k2, k2.contains("No Color") || k2.contains("05131D"))
    }

    @Test
    fun `no color as a new color sends no name`() {
        var neu: Int? = null
        vm().setzeTeilFarbe("3001", 5, KEINE_FARBE, "Keine Farbe", null) { neu = it }
        assertTrue("geändert", neu != null)
        val k = bodyTo("PUT /api/v1/parts/3001/5/color")
        assertTrue(k, k.contains("\"color_id\":9999"))
        assertFalse(k, k.contains("Keine Farbe"))
        assertEquals(KEINE_FARBE, neu)
    }

    @Test
    fun `9999 means no color, 0 stays black`() {
        val liste = listOf(BrickColor(id = KEINE_FARBE, name = "[No Color/Any Color]"), BrickColor(id = 0, name = "Black", hex = "05131D"),
                           BrickColor(id = 4, name = "Red", hex = "C91A09")).map { it.alsAnsicht() }
        assertEquals(listOf(0, 4), withoutNoColor(liste).map { it.id })
        assertEquals("keine", farbName(liste, KEINE_FARBE, "[No Color/Any Color]", "keine"))
        assertEquals("Black", farbName(liste, 0, null, "keine"))
        assertEquals("Dark Tan", farbName(emptyList(), 69, "Dark Tan", "keine"))
        assertEquals(null, farbName(emptyList(), 69, " ", "keine"))
    }

    @Test
    fun `a missing color_id is no color, not black`() {
        assertEquals(KEINE_FARBE, BrickJson.decodeFromString(Part.serializer(), """{"part_number":"3001"}""").colorId)
        assertEquals(KEINE_FARBE, BrickJson.decodeFromString(PartValuationItem.serializer(), """{"part_number":"3001"}""").colorId)
        assertEquals(0, BrickJson.decodeFromString(Part.serializer(), """{"part_number":"3001","color_id":0}""").colorId)
        assertEquals(KEINE_FARBE, ManualItemDetailUiState().colorId)
        assertEquals(KEINE_FARBE, TeileZiel.ManualItemDetail(Postenart.FIG, "sw0001", title = "Luke").colorId)
    }
}
