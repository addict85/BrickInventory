package ch.brickinventoryapp.account

import ch.brickinventoryapp.account.ui.DesignChoice
import ch.brickinventoryapp.account.ui.viewmodel.AccountViewModel
import ch.brickinventoryapp.data.testing.PathServer
import ch.brickinventoryapp.data.testing.testAccountRepository
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.session.loadSettings
import ch.brickinventoryapp.session.testing.SessionFake
import ch.brickinventoryapp.state.testing.TestServices
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * The design applies per account: /settings/theme delivers, with a token, the effective
 * design plus the default, POST /settings/user/theme sets one's own ("" =
 * default). The choice applies right away in the session, and signing out leaves the
 * design standing until the server's default arrives.
 *
 * Counter-checks:
 *   A  `session.setDesign(…)` removed in AccountViewModel.chooseDesign() → red
 *      "die Wahl gilt sofort in der ganzen App" (classic instead of `noppe`)
 *   B  the key "design" instead of "theme" in AccountRepository.setOwnDesign →
 *      red "die Wahl geht an den Server …"
 *   C  `default ?: theme` instead of `default?.let` in designChoice() → red "ein älterer Server ohne Vorgabe zeigt keine Auswahl"
 *   D  appTheme not taken over in Sitzung.loggedOut() → red "Abmelden lässt das Design stehen …"
 *   E  `appTheme = e.appTheme` back in Sitzung.loadSettings() → red "die Einstellungen überschreiben das Design des Kontos nicht" (classic instead of `noppe`)
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DesignPerAccountTest {

    private val paths = PathServer(
        "/api/v2/settings/theme" to """{"success":true,"theme":"brick","preset":"classic","own":"brick"}""",
        "/api/v2/settings/user/theme" to """{"success":true,"theme":"noppe","preset":"classic","own":"noppe"}""",
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

    private fun vm() = t.track(AccountViewModel(testAccountRepository(t.api), t.messages, t.session, SessionFake()))

    @Test
    fun `the account shows default and own design`() {
        val vm = vm()
        vm.loadDesign()
        assertTrue("Design", vm.accountState.value.design != null)
        assertEquals(DesignChoice(Design.BRICK, Design.CLASSIC, Design.BRICK), vm.accountState.value.design)
        assertEquals(listOf("GET /api/v2/settings/theme"), paths.requests.toList())
    }

    @Test
    fun `the choice goes to the server and applies immediately in the whole app`() {
        val vm = vm()
        vm.chooseDesign(Design.STUD)
        assertTrue("chosen", vm.accountState.value.design != null)
        assertEquals(listOf("POST /api/v2/settings/user/theme"), paths.requests.toList())
        assertEquals("""{"theme":"noppe"}""", paths.bodyBytes.single())
        assertEquals(DesignChoice(Design.STUD, Design.CLASSIC, Design.STUD), vm.accountState.value.design)
        assertEquals(Design.STUD, t.session.state.value.appTheme)

        // Back to the default: empty value, the response names the effective design.
        paths.responses["/api/v2/settings/user/theme"] = """{"success":true,"theme":"classic","preset":"classic","own":null}"""
        vm.chooseDesign(null)
        assertTrue("default", vm.accountState.value.design?.own == null)
        assertEquals("""{"theme":""}""", paths.bodyBytes.last())
        assertEquals(Design.CLASSIC, t.session.state.value.appTheme)
    }

    @Test
    fun `an older server without a default shows no selection`() {
        paths.responses["/api/v2/settings/theme"] = """{"success":true,"theme":"brick"}"""
        val vm = vm()
        vm.loadDesign()
        assertTrue("Response", paths.requests.isNotEmpty())
        assertNull(vm.accountState.value.design)
    }

    /** /settings names the admin's default in app_theme (`routes/api/settings.ts`), not the account's. */
    @Test
    fun `the settings do not overwrite the account's design`() {
        paths.responses["/api/v2/settings"] = """{"success":true,"settings":{"currency":"CHF","app_theme":"classic"}}"""
        t.session.setDesign(Design.STUD)
        runBlocking { t.session.loadSettings(testAccountRepository(t.api)) }
        assertEquals(CurrencyCode.CHF, t.session.state.value.currency)
        assertEquals(Design.STUD, t.session.state.value.appTheme)
    }

    @Test
    fun `sign-out leaves the design until the default is there`() {
        t.session.setDesign(Design.STUD)
        t.session.loggedIn(admin = false)
        t.session.loggedOut()
        assertEquals(Design.STUD, t.session.state.value.appTheme)
        assertEquals(false, t.session.state.value.isLoggedIn)
    }
}
