package ch.brickinventoryapp.account

import ch.brickinventoryapp.account.ui.viewmodel.HouseholdViewModel
import ch.brickinventoryapp.account.ui.viewmodel.SettingsViewModel
import ch.brickinventoryapp.data.testing.PathServer
import ch.brickinventoryapp.data.testing.testAccountRepository
import ch.brickinventoryapp.data.testing.testHouseholdRepository
import ch.brickinventoryapp.data.testing.testManagementRepository
import ch.brickinventoryapp.data.testing.text
import ch.brickinventoryapp.model.domain.AlarmDirection
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.file.FileReader
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.model.ui.Load
import ch.brickinventoryapp.model.ui.errorMessage
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.state.testing.TestServices
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Settings and household, run against a PathServer with no network.
 *
 * Counter-checks (measured on Oct 28, 2026, kotlinc against SettingsViewModel.kt
 * and HouseholdViewModel.kt):
 *   A  the check for > 0 removed from changeAlarmThreshold() → red "eine Schwelle von null geht nicht hinaus"
 *   B  `alertsNew()` removed from alarmLock() → red "ein geänderter Alarm lädt die Übersicht nach"
 *   C  the old name left empty in renameLocation() → red "ein umbenannter Lagerort heisst auch an den Sets in der Ablage neu" ("Kiste" stayed)
 *   D  saveSettings() only pulling the sets along → red "eine andere Währung …"
 *   E  the household accounts not reloaded in accountsChanged() → red "eine eingelöste Einladung lädt Status und Haushaltskonten"
 *   F  the password not sent in the repository → red "eine eingelöste Einladung …" (body without password)
 *   G  `passwordWrong` not set in redeemHouseholdInvite() → red "ein falsches Passwort beim Einlösen markiert das Feld"
 *   H  the lockout branch removed from redeemError() → red "nach zu vielen Fehlversuchen …" ("fehler" came instead of the own sentence)
 *   I  `faktor_code` not in the body in the repository → red "bei aktivem zweitem Faktor geht dessen Code …"
 *   J  `r.data.active` → `false` in checkSecondFactor() → red
 *      "bei aktivem zweitem Faktor …" (code field timed out)
 *   K  `factorNeeded` not set in the error branch → red "verlangt der Server den Code …"
 *   L  the success message removed from saveUserDefaultCondition() →
 *      red "the default condition reports the saving" (message timed out)
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SettingsViewModelTest {

    private lateinit var paths: PathServer
    private lateinit var t: TestServices

    private val noReader = object : FileReader { override suspend fun read(file: FileRef): Pair<String?, ByteArray>? = null }

    private fun vm() = t.track(SettingsViewModel(t.session, t.filter(), t.hints, t.sync, testAccountRepository(t.api),
        testManagementRepository(t.api), t.alerts(), t.parts(),
        noReader))

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        paths = PathServer(
            "/api/v1/alerts" to """{"success":true,"alerts":[{"set_number":"75192-1","condition":"N","threshold":500.0}]}""",
            "/api/v1/sets/75192-1/alert" to """{"success":true}""",
            "/api/v1/storage/locations/3" to """{"success":true,"ort":{"id":3,"name":"Keller"}}""",
            "/api/v1/storage/locations" to """{"success":true,"orte":[{"id":3,"name":"Keller"}]}""",
            "/api/v1/settings" to """{"success":true}""",
            "/api/v1/settings/household/redeem" to """{"success":true,"error":"Verknüpft mit marco"}""",
            "/api/v1/settings/household" to """{"success":true,"is_sub":true}""",
            "/api/v1/sets/household-members" to """{"success":true,"members":[{"id":1,"username":"marco","is_self":true},{"id":2,"username":"kind"}]}""",
        )
        t = TestServices(paths.onTick(), io = Dispatchers.Main)
    }

    @After
    fun tearDown() {
        t.cleanUp()
        Dispatchers.resetMain()
        paths.server.shutdown()
    }

    @Test
    fun `a threshold of zero does not go out`() {
        val vm = vm()
        vm.changeAlarmThreshold("75192-1", Condition.NEW, AlarmDirection.BELOW, Money.NULL)
        assertEquals("t${R.string.alerts_bad_value}", t.messages.text)
        assertTrue(paths.requestsTo("/alert").isEmpty())
    }

    @Test
    fun `a changed alert reloads the overview`() {
        val vm = vm()
        vm.loadAlarmOverview()
        assertTrue("overview", vm.alarmOverview.value.loaded)
        vm.changeAlarmThreshold("75192-1", Condition.NEW, AlarmDirection.BELOW, Money.from(450.0)!!)
        assertEquals("reloaded", 2, paths.requestsTo("GET /api/v1/alerts").size)
        assertTrue(paths.requestsTo("PUT /api/v1/sets/75192-1/alert").isNotEmpty())
    }

    @Test
    fun `a renamed storage location also gets the new name on the sets in the store`() {
        paths.responses["/api/v1/sets"] = """{"success":true,"total":1,"sets":[{"set_number":"75192-1","storage":"Kiste"}]}"""
        paths.responses["/api/v1/storage/locations"] = """{"success":true,"orte":[{"id":3,"name":"Kiste"}]}"""
        runBlocking { t.sets().refreshSets() }
        val vm = vm()
        vm.loadOwnLocations()
        assertEquals("Kiste", vm.storageState.value.own.single().name)
        paths.responses["/api/v1/storage/locations"] = """{"success":true,"orte":[{"id":3,"name":"Keller"}]}"""
        vm.renameLocation(3, "Keller")
        assertEquals("the own locations anew", "Keller", vm.storageState.value.own.single().name)
        val stored = runBlocking { t.sets().observeSets().first().list.single() }
        assertEquals("without fetching the stock again", 1, paths.requestsTo("GET /api/v1/sets?").size)
        assertEquals("Keller", stored.storage)
    }

    @Test
    fun `a storage location error without a sentence stays silent`() {
        paths.codes["/api/v1/storage/locations/3"] = 401
        val vm = vm()
        vm.deleteLocation(3)
        assertTrue("Response", paths.requestsTo("DELETE /api/v1/storage/locations/3").isNotEmpty())
        assertNull(t.messages.text)
    }

    @Test
    fun `a different currency applies immediately and the store fetches the stock again`() {
        val vm = vm()
        vm.saveSettings(CurrencyCode.CHF, Condition.USED)
        // Every price changes: the cache refetches sets, parts and figures.
        for (path in listOf("GET /api/v1/sets?", "GET /api/v1/parts?", "GET /api/v1/minifigs?")) {
            assertTrue(path, paths.requestsTo(path).isNotEmpty())
        }
        assertEquals(CurrencyCode.CHF, t.session.state.value.currency)
        assertEquals(Condition.USED, t.session.state.value.priceCondition)
    }

    @Test
    fun `the default condition reports the saving`() {
        paths.responses["/api/v1/settings/user/default-condition"] = """{"success":true}"""
        val vm = vm()
        vm.saveUserDefaultCondition(Condition.USED)
        assertTrue("message", t.messages.text != null)
        assertEquals("t${R.string.vm_settings_saved}", t.messages.text)
        assertTrue(paths.bodyBytes.any { "\"U\"" in it })
    }

    @Test
    fun `a redeemed invitation loads status and household accounts`() {
        val vm = t.track(HouseholdViewModel(t.session, t.filter(), t.sync, testHouseholdRepository(t.api), testAccountRepository(t.api)))
        vm.redeemHouseholdInvite(" ABC123 ", "geheim1234")
        assertTrue("accounts there", t.viewport.accounts.value.householdMembers.size == 2)
        assertTrue("status there", vm.householdState.value.status?.isSub == true)
        assertTrue(paths.requestsTo("POST /api/v1/settings/household/redeem").single().isNotEmpty())
        val body = paths.bodyBytes[paths.requests.indexOfFirst { "household/redeem" in it }]
        assertEquals("""{"code":"ABC123","password":"geheim1234"}""", body)
        assertEquals(1, vm.householdState.value.redeemed)
    }

    @Test
    fun `a wrong password when redeeming marks the field`() {
        paths.responses["/api/v1/settings/household/redeem"] =
            """{"success":false,"code":"aktuelles_passwort_falsch","error":"Aktuelles Passwort falsch"}"""
        paths.codes["/api/v1/settings/household/redeem"] = 400
        val vm = t.track(HouseholdViewModel(t.session, t.filter(), t.sync, testHouseholdRepository(t.api), testAccountRepository(t.api)))
        vm.redeemHouseholdInvite("ABC123", "falsch")
        assertTrue("Response", vm.householdState.value.fetch is Load.Failure)
        assertTrue(vm.householdState.value.passwordWrong)
        assertEquals("t${R.string.household_redeem_password_wrong}", vm.householdState.value.fetch.errorMessage.text)
        assertEquals(0, vm.householdState.value.redeemed)
    }

    @Test
    fun `with an active second factor its code goes along when redeeming`() {
        paths.responses["/api/v1/auth/zweiter-faktor"] = """{"success":true,"aktiv":true,"codes_uebrig":8}"""
        val vm = t.track(HouseholdViewModel(t.session, t.filter(), t.sync, testHouseholdRepository(t.api), testAccountRepository(t.api)))
        vm.loadHousehold()
        assertTrue("Codefeld", vm.householdState.value.factorNeeded)
        vm.redeemHouseholdInvite("ABC123", "geheim1234", " 123456 ")
        assertTrue("redeemed", paths.requests.any { "household/redeem" in it })
        val body = paths.bodyBytes[paths.requests.indexOfFirst { "household/redeem" in it }]
        assertEquals("""{"code":"ABC123","password":"geheim1234","faktor_code":"123456"}""", body)
    }

    @Test
    fun `if the server requires the second factor's code, the field appears`() {
        paths.responses["/api/v1/settings/household/redeem"] =
            """{"success":false,"code":"zweiter_faktor_falsch","error":"Code falsch"}"""
        paths.codes["/api/v1/settings/household/redeem"] = 400
        val vm = t.track(HouseholdViewModel(t.session, t.filter(), t.sync, testHouseholdRepository(t.api), testAccountRepository(t.api)))
        assertFalse(vm.householdState.value.factorNeeded)
        vm.redeemHouseholdInvite("ABC123", "geheim1234")
        assertTrue("Response", vm.householdState.value.fetch is Load.Failure)
        assertTrue(vm.householdState.value.factorNeeded)
        assertTrue(vm.householdState.value.factorWrong)
        assertFalse(vm.householdState.value.passwordWrong)
        assertEquals("t${R.string.household_redeem_code_wrong}", vm.householdState.value.fetch.errorMessage.text)
    }

    @Test
    fun `after too many failed attempts the server's sentence comes, without it an own one`() {
        paths.responses["/api/v1/settings/household/redeem"] =
            """{"success":false,"code":"zu_viele_fehlversuche","error":"Bitte in 5 Min. erneut"}"""
        paths.codes["/api/v1/settings/household/redeem"] = 429
        val vm = t.track(HouseholdViewModel(t.session, t.filter(), t.sync, testHouseholdRepository(t.api), testAccountRepository(t.api)))
        vm.redeemHouseholdInvite("ABC123", "falsch")
        assertTrue("Response", vm.householdState.value.fetch is Load.Failure)
        assertEquals("Bitte in 5 Min. erneut", vm.householdState.value.fetch.errorMessage.text)
        assertFalse(vm.householdState.value.passwordWrong)

        paths.responses["/api/v1/settings/household/redeem"] = """{"success":false}"""
        vm.redeemHouseholdInvite("ABC123", "falsch")
        assertTrue("second answer", vm.householdState.value.fetch.errorMessage.text == "t${R.string.household_redeem_locked}")
    }
}
