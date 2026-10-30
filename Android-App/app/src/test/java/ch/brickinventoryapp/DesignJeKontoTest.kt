package ch.brickinventoryapp

import ch.brickinventoryapp.data.repository.AdminRepository
import ch.brickinventoryapp.ui.DesignWahl
import ch.brickinventoryapp.ui.viewmodel.KontoViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

/**
 * Das Design gilt je Konto: /settings/theme liefert mit Token das wirksame
 * Design samt Vorgabe, POST /settings/user/theme setzt ein eigenes ("" =
 * Vorgabe). Die Wahl gilt sofort in der Sitzung, und das Abmelden lässt das
 * Design stehen, bis die Vorgabe des Servers da ist.
 *
 * Gegenproben (30.10.2026, gemessen mit kt-b2/bau.sh):
 *   A  in KontoViewModel.waehleDesign() `sitzung.setzeDesign(…)` entfernt → rot
 *      „die Wahl gilt sofort in der ganzen App“ (classic statt noppe)
 *   B  in AdminRepository.setzeEigenesDesign den Schlüssel "design" statt
 *      "theme" → rot „die Wahl geht an den Server …“
 *   C  in designWahl() `vorgabe ?: theme` statt `vorgabe?.let` → rot „ein
 *      älterer Server ohne Vorgabe zeigt keine Auswahl“
 *   D  in Sitzung.abgemeldet() appTheme nicht übernommen → rot „Abmelden lässt
 *      das Design stehen …“
 */
class DesignJeKontoTest {

    private val pfade = PfadServer(
        "/api/v1/settings/theme" to """{"success":true,"theme":"brick","vorgabe":"classic","eigenes":"brick"}""",
        "/api/v1/settings/user/theme" to """{"success":true,"theme":"noppe","vorgabe":"classic","eigenes":"noppe"}""",
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

    private fun vm() = t.merke(KontoViewModel(AdminRepository(t.api, t.cache), NummernTexte, t.meldungen, t.sitzung))

    @Test
    fun `das Konto zeigt Vorgabe und eigenes Design`() {
        val vm = vm()
        vm.ladeDesign()
        TestApi.warteBis("Design") { vm.kontoState.value.design != null }
        assertEquals(DesignWahl("brick", "classic", "brick"), vm.kontoState.value.design)
        assertEquals(listOf("GET /api/v1/settings/theme"), pfade.anfragen.toList())
    }

    @Test
    fun `die Wahl geht an den Server und gilt sofort in der ganzen App`() {
        val vm = vm()
        vm.waehleDesign("noppe")
        TestApi.warteBis("gewählt") { vm.kontoState.value.design != null }
        assertEquals(listOf("POST /api/v1/settings/user/theme"), pfade.anfragen.toList())
        assertEquals("""{"theme":"noppe"}""", pfade.koerper.single())
        assertEquals(DesignWahl("noppe", "classic", "noppe"), vm.kontoState.value.design)
        assertEquals("noppe", t.sitzung.state.value.appTheme)

        // Zurück zur Vorgabe: leerer Wert, die Antwort nennt das wirksame Design.
        pfade.antworten["/api/v1/settings/user/theme"] = """{"success":true,"theme":"classic","vorgabe":"classic","eigenes":null}"""
        vm.waehleDesign("")
        TestApi.warteBis("Vorgabe") { vm.kontoState.value.design?.eigenes == null }
        assertEquals("""{"theme":""}""", pfade.koerper.last())
        assertEquals("classic", t.sitzung.state.value.appTheme)
    }

    @Test
    fun `ein aelterer Server ohne Vorgabe zeigt keine Auswahl`() {
        pfade.antworten["/api/v1/settings/theme"] = """{"success":true,"theme":"brick"}"""
        val vm = vm()
        vm.ladeDesign()
        TestApi.warteBis("Antwort") { pfade.anfragen.isNotEmpty() }
        Thread.sleep(100)
        assertNull(vm.kontoState.value.design)
    }

    @Test
    fun `Abmelden laesst das Design stehen, bis die Vorgabe da ist`() {
        t.sitzung.aendere { it.copy(appTheme = "noppe", isLoggedIn = true) }
        t.sitzung.abgemeldet()
        assertEquals("noppe", t.sitzung.state.value.appTheme)
        assertEquals(false, t.sitzung.state.value.isLoggedIn)
    }
}
