package ch.brickinventoryapp.account

import ch.brickinventoryapp.model.domain.Waehrung
import ch.brickinventoryapp.model.ui.theme.Design
import kotlinx.coroutines.ExperimentalCoroutinesApi
import ch.brickinventoryapp.account.ui.DesignChoice
import ch.brickinventoryapp.testing.testAccountRepository
import ch.brickinventoryapp.session.ladeEinstellungen
import ch.brickinventoryapp.account.ui.viewmodel.AccountViewModel
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
 * The design applies per account: /settings/theme delivers, with a token, the effective
 * design plus the default, POST /settings/user/theme sets one's own ("" =
 * default). The choice applies right away in the session, and signing out leaves the
 * design standing until the server's default arrives.
 *
 * Counter-checks:
 *   A  `sitzung.setzeDesign(…)` removed in AccountViewModel.chooseDesign() → red
 *      "die Wahl gilt sofort in der ganzen App" (classic instead of noppe)
 *   B  the key "design" instead of "theme" in AccountRepository.setOwnDesign →
 *      red "die Wahl geht an den Server …"
 *   C  `vorgabe ?: theme` instead of `vorgabe?.let` in designChoice() → red "ein
 *      älterer Server ohne Vorgabe zeigt keine Auswahl"
 *   D  appTheme not taken over in Sitzung.abgemeldet() → red "Abmelden lässt
 *      das Design stehen …"
 *   E  `appTheme = e.appTheme` back in Sitzung.ladeEinstellungen() → red "die
 *      Einstellungen überschreiben das Design des Kontos nicht" (classic instead of noppe)
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
    fun `the account shows default and own design`() {
        val vm = vm()
        vm.loadDesign()
        assertTrue("Design", vm.kontoState.value.design != null)
        assertEquals(DesignChoice(Design.BRICK, Design.CLASSIC, Design.BRICK), vm.kontoState.value.design)
        assertEquals(listOf("GET /api/v1/settings/theme"), paths.requests.toList())
    }

    @Test
    fun `the choice goes to the server and applies immediately in the whole app`() {
        val vm = vm()
        vm.chooseDesign(Design.NOPPE)
        assertTrue("gewählt", vm.kontoState.value.design != null)
        assertEquals(listOf("POST /api/v1/settings/user/theme"), paths.requests.toList())
        assertEquals("""{"theme":"noppe"}""", paths.koerper.single())
        assertEquals(DesignChoice(Design.NOPPE, Design.CLASSIC, Design.NOPPE), vm.kontoState.value.design)
        assertEquals(Design.NOPPE, t.sitzung.state.value.appTheme)

        // Back to the default: empty value, the response names the effective design.
        paths.antworten["/api/v1/settings/user/theme"] = """{"success":true,"theme":"classic","vorgabe":"classic","eigenes":null}"""
        vm.chooseDesign(null)
        assertTrue("Vorgabe", vm.kontoState.value.design?.eigenes == null)
        assertEquals("""{"theme":""}""", paths.koerper.last())
        assertEquals(Design.CLASSIC, t.sitzung.state.value.appTheme)
    }

    @Test
    fun `an older server without a default shows no selection`() {
        paths.antworten["/api/v1/settings/theme"] = """{"success":true,"theme":"brick"}"""
        val vm = vm()
        vm.loadDesign()
        assertTrue("Antwort", paths.requests.isNotEmpty())
        assertNull(vm.kontoState.value.design)
    }

    /** /settings names the admin's default in app_theme (routes/api_v1/settings.ts), not the account's. */
    @Test
    fun `the settings do not overwrite the account's design`() {
        paths.antworten["/api/v1/settings"] = """{"success":true,"settings":{"currency":"CHF","app_theme":"classic"}}"""
        t.sitzung.setzeDesign(Design.NOPPE)
        runBlocking { t.sitzung.ladeEinstellungen(testAccountRepository(t.api)) }
        assertEquals(Waehrung.CHF, t.sitzung.state.value.currency)
        assertEquals(Design.NOPPE, t.sitzung.state.value.appTheme)
    }

    @Test
    fun `sign-out leaves the design until the default is there`() {
        t.sitzung.setzeDesign(Design.NOPPE)
        t.sitzung.angemeldet(admin = false)
        t.sitzung.abgemeldet()
        assertEquals(Design.NOPPE, t.sitzung.state.value.appTheme)
        assertEquals(false, t.sitzung.state.value.isLoggedIn)
    }
}
