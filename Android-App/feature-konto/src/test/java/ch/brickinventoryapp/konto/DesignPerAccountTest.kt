package ch.brickinventoryapp.konto

import ch.brickinventoryapp.model.fach.Waehrung
import ch.brickinventoryapp.model.ui.theme.Design
import kotlinx.coroutines.ExperimentalCoroutinesApi
import ch.brickinventoryapp.konto.ui.DesignChoice
import ch.brickinventoryapp.testing.testAccountRepository
import ch.brickinventoryapp.sitzung.ladeEinstellungen
import ch.brickinventoryapp.konto.ui.viewmodel.AccountViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Assert.assertTrue
import org.junit.Test
import ch.brickinventoryapp.testing.PfadServer
import ch.brickinventoryapp.testing.SessionFake
import ch.brickinventoryapp.testing.TestDienste

/**
 * Das Design gilt je Konto: /settings/theme liefert mit Token das wirksame
 * Design samt Vorgabe, POST /settings/user/theme setzt ein eigenes ("" =
 * Vorgabe). Die Wahl gilt sofort in der Sitzung, und das Abmelden lässt das
 * Design stehen, bis die Vorgabe des Servers da ist.
 *
 * Gegenproben:
 *   A  in AccountViewModel.chooseDesign() `sitzung.setzeDesign(…)` entfernt → rot
 *      „die Wahl gilt sofort in der ganzen App“ (classic statt noppe)
 *   B  in AccountRepository.setOwnDesign den Schlüssel "design" statt
 *      "theme" → rot „die Wahl geht an den Server …“
 *   C  in designChoice() `vorgabe ?: theme` statt `vorgabe?.let` → rot „ein
 *      älterer Server ohne Vorgabe zeigt keine Auswahl“
 *   D  in Sitzung.abgemeldet() appTheme nicht übernommen → rot „Abmelden lässt
 *      das Design stehen …“
 *   E  in Sitzung.ladeEinstellungen() wieder `appTheme = e.appTheme` → rot „die
 *      Einstellungen überschreiben das Design des Kontos nicht“ (classic statt noppe)
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DesignPerAccountTest {

    private val paths = PfadServer(
        "/api/v1/settings/theme" to """{"success":true,"theme":"brick","vorgabe":"classic","eigenes":"brick"}""",
        "/api/v1/settings/user/theme" to """{"success":true,"theme":"noppe","vorgabe":"classic","eigenes":"noppe"}""",
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

    private fun vm() = t.merke(AccountViewModel(testAccountRepository(t.api), t.meldungen, t.sitzung, SessionFake()))

    @Test
    fun `das Konto zeigt Vorgabe und eigenes Design`() {
        val vm = vm()
        vm.loadDesign()
        assertTrue("Design", vm.kontoState.value.design != null)
        assertEquals(DesignChoice(Design.BRICK, Design.CLASSIC, Design.BRICK), vm.kontoState.value.design)
        assertEquals(listOf("GET /api/v1/settings/theme"), paths.requests.toList())
    }

    @Test
    fun `die Wahl geht an den Server und gilt sofort in der ganzen App`() {
        val vm = vm()
        vm.chooseDesign(Design.NOPPE)
        assertTrue("gewählt", vm.kontoState.value.design != null)
        assertEquals(listOf("POST /api/v1/settings/user/theme"), paths.requests.toList())
        assertEquals("""{"theme":"noppe"}""", paths.koerper.single())
        assertEquals(DesignChoice(Design.NOPPE, Design.CLASSIC, Design.NOPPE), vm.kontoState.value.design)
        assertEquals(Design.NOPPE, t.sitzung.state.value.appTheme)

        // Zurück zur Vorgabe: leerer Wert, die Antwort nennt das wirksame Design.
        paths.antworten["/api/v1/settings/user/theme"] = """{"success":true,"theme":"classic","vorgabe":"classic","eigenes":null}"""
        vm.chooseDesign(null)
        assertTrue("Vorgabe", vm.kontoState.value.design?.eigenes == null)
        assertEquals("""{"theme":""}""", paths.koerper.last())
        assertEquals(Design.CLASSIC, t.sitzung.state.value.appTheme)
    }

    @Test
    fun `ein aelterer Server ohne Vorgabe zeigt keine Auswahl`() {
        paths.antworten["/api/v1/settings/theme"] = """{"success":true,"theme":"brick"}"""
        val vm = vm()
        vm.loadDesign()
        assertTrue("Antwort", paths.requests.isNotEmpty())
        assertNull(vm.kontoState.value.design)
    }

    /** /settings nennt in app_theme die Vorgabe des Verwalters (routes/api_v1/settings.ts), nicht das Konto. */
    @Test
    fun `die Einstellungen ueberschreiben das Design des Kontos nicht`() {
        paths.antworten["/api/v1/settings"] = """{"success":true,"settings":{"currency":"CHF","app_theme":"classic"}}"""
        t.sitzung.setzeDesign(Design.NOPPE)
        runBlocking { t.sitzung.ladeEinstellungen(testAccountRepository(t.api)) }
        assertEquals(Waehrung.CHF, t.sitzung.state.value.currency)
        assertEquals(Design.NOPPE, t.sitzung.state.value.appTheme)
    }

    @Test
    fun `Abmelden laesst das Design stehen, bis die Vorgabe da ist`() {
        t.sitzung.setzeDesign(Design.NOPPE)
        t.sitzung.angemeldet(admin = false)
        t.sitzung.abgemeldet()
        assertEquals(Design.NOPPE, t.sitzung.state.value.appTheme)
        assertEquals(false, t.sitzung.state.value.isLoggedIn)
    }
}
