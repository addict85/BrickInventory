package ch.brickinventoryapp

import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.data.api.ApiJson
import ch.brickinventoryapp.data.model.BrickColor
import ch.brickinventoryapp.data.model.KEINE_FARBE
import ch.brickinventoryapp.data.model.Part
import ch.brickinventoryapp.data.model.PartValuationItem
import ch.brickinventoryapp.data.repository.TeileRepository
import ch.brickinventoryapp.ui.ManualItemDetailUiState
import ch.brickinventoryapp.ui.Screen
import ch.brickinventoryapp.ui.farbName
import ch.brickinventoryapp.ui.ohneKeineFarbe
import ch.brickinventoryapp.ui.viewmodel.TeileViewModel
import kotlinx.coroutines.Dispatchers
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
 * „Keine Farbe“ ist 9999 wie auf dem Server (utils/validate.ts, KEINE_FARBE);
 * 0 ist Schwarz. Die App schickt für ein Teil ohne Farbe 9999, zeigt 9999 als
 * „keine Farbe“ und nimmt ein fehlendes color_id nicht als Schwarz.
 *
 * Gegenproben (30.10.2026, gemessen mit kt-b2/bau.sh):
 *   A  in TeileViewModel.addPart die Vorgabe `colorId = 0` → rot „ein Teil
 *      ohne Farbe geht als 9999 hinaus“ ("color_id":0)
 *   B  in TeileRepository.setPartColor den Namen auch bei KEINE_FARBE
 *      mitgeschickt → rot „keine Farbe als neue Farbe schickt keinen Namen mit“
 *   C  in farbName() die Prüfung auf KEINE_FARBE entfernt → rot „9999 heisst
 *      keine Farbe, 0 bleibt Schwarz“ ([No Color/Any Color] statt keine)
 *   D  in ohneKeineFarbe() `!= KEINE_FARBE` durch `!= 0` ersetzt → rot ebenda
 *   E  Part.colorId wieder mit Vorgabe 0 → rot „ein fehlendes color_id ist
 *      keine Farbe, nicht Schwarz“
 */
class KeineFarbeTest {

    private val pfade = PfadServer(
        "/api/v1/parts" to """{"success":true,"action":"added","part_number":"3001"}""",
        "/api/v1/parts/3001/5/color" to """{"success":true}""",
    )
    private val t = TestDienste(pfade.server)

    @Before
    fun auf() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @After
    fun zu() {
        t.aufraeumen()
        Dispatchers.resetMain()
        pfade.server.shutdown()
    }

    private fun vm() = t.merke(TeileViewModel(t.dienste, TeileRepository(t.api, t.cache), SavedStateHandle()))

    private fun koerperZu(methodeUndPfad: String): String {
        val i = pfade.anfragen.indexOfFirst { it == methodeUndPfad }
        assertTrue("keine Anfrage $methodeUndPfad in ${pfade.anfragen}", i >= 0)
        return pfade.koerper[i]
    }

    @Test
    fun `ein Teil ohne Farbe geht als 9999 hinaus`() {
        vm().addPart("3001")
        TestApi.warteBis("Teil erfasst") { pfade.anfragenAn("POST /api/v1/parts").isNotEmpty() }
        val k = koerperZu("POST /api/v1/parts")
        assertTrue(k, k.contains("\"color_id\":9999"))
        // Auch ein mitgegebener Name gehört nicht zu „keine Farbe“.
        vm().addPart("3002", KEINE_FARBE, "[No Color/Any Color]", "05131D")
        TestApi.warteBis("zweites Teil") { pfade.anfragenAn("POST /api/v1/parts").size == 2 }
        val k2 = pfade.koerper[pfade.anfragen.indexOfLast { it == "POST /api/v1/parts" }]
        assertFalse(k2, k2.contains("No Color") || k2.contains("05131D"))
    }

    @Test
    fun `keine Farbe als neue Farbe schickt keinen Namen mit`() {
        var neu: Int? = null
        vm().setzeTeilFarbe("3001", 5, KEINE_FARBE, "Keine Farbe", null) { neu = it }
        TestApi.warteBis("geändert") { neu != null }
        val k = koerperZu("PUT /api/v1/parts/3001/5/color")
        assertTrue(k, k.contains("\"color_id\":9999"))
        assertFalse(k, k.contains("Keine Farbe"))
        assertEquals(KEINE_FARBE, neu)
    }

    @Test
    fun `9999 heisst keine Farbe, 0 bleibt Schwarz`() {
        val liste = listOf(BrickColor(KEINE_FARBE, "[No Color/Any Color]"), BrickColor(0, "Black", "05131D"),
                           BrickColor(4, "Red", "C91A09"))
        assertEquals(listOf(0, 4), ohneKeineFarbe(liste).map { it.id })
        assertEquals("keine", farbName(liste, KEINE_FARBE, "[No Color/Any Color]", "keine"))
        assertEquals("Black", farbName(liste, 0, null, "keine"))
        assertEquals("Dark Tan", farbName(emptyList(), 69, "Dark Tan", "keine"))
        assertEquals(null, farbName(emptyList(), 69, " ", "keine"))
    }

    @Test
    fun `ein fehlendes color_id ist keine Farbe, nicht Schwarz`() {
        assertEquals(KEINE_FARBE, ApiJson.decodeFromString(Part.serializer(), """{"part_number":"3001"}""").colorId)
        assertEquals(KEINE_FARBE, ApiJson.decodeFromString(PartValuationItem.serializer(), """{"part_number":"3001"}""").colorId)
        assertEquals(0, ApiJson.decodeFromString(Part.serializer(), """{"part_number":"3001","color_id":0}""").colorId)
        assertEquals(KEINE_FARBE, ManualItemDetailUiState().colorId)
        assertTrue(Screen.ManualItemDetail.createRoute("fig", "sw0001", title = "Luke").contains("/9999/"))
    }
}
