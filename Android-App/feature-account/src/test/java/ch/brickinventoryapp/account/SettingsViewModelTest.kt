package ch.brickinventoryapp.account

import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.model.domain.Alarmrichtung
import ch.brickinventoryapp.model.domain.Waehrung
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.testing.testHouseholdRepository
import ch.brickinventoryapp.testing.testAccountRepository
import ch.brickinventoryapp.testing.testManagementRepository
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import ch.brickinventoryapp.model.file.FileReader
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.account.ui.viewmodel.SettingsViewModel
import ch.brickinventoryapp.account.ui.viewmodel.HouseholdViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import ch.brickinventoryapp.testing.PfadServer
import ch.brickinventoryapp.testing.TestDienste
import ch.brickinventoryapp.testing.text
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.ui.errorMessage

/**
 * Settings and household, run against a PathServer with no network.
 *
 * Counter-checks (measured on Oct 28, 2026, kotlinc against SettingsViewModel.kt
 * and HouseholdViewModel.kt):
 *   A  the check for > 0 removed from changeAlarmThreshold() → red "eine
 *      Schwelle von null geht nicht hinaus"
 *   B  `alertsNew()` removed from alarmLock() → red "ein geänderter Alarm lädt
 *      die Übersicht nach"
 *   C  the old name left empty in nameLocationUm() → red "ein umbenannter
 *      Lagerort heisst auch an den Sets in der Ablage neu" ("Kiste" stayed)
 *   D  saveSettings() only pulling the sets along → red "eine andere Währung …"
 *   E  the household accounts not reloaded in accountsChanged() → red "eine
 *      eingelöste Einladung lädt Status und Haushaltskonten"
 *   F  the password not sent in the repository → red "eine eingelöste
 *      Einladung …" (body without password)
 *   G  `passwordWrong` not set in redeemHouseholdInvite() → red "ein
 *      falsches Passwort beim Einlösen markiert das Feld"
 *   H  the lockout branch removed from redeemError() → red "nach zu
 *      vielen Fehlversuchen …" ("fehler" came instead of the own sentence)
 *   I  `faktor_code` not in the body in the repository → red "bei
 *      aktivem zweitem Faktor geht dessen Code …"
 *   J  `r.data.aktiv` → `false` in checkSecondFactor() → red
 *      "bei aktivem zweitem Faktor …" (code field timed out)
 *   K  `factorNeeded` not set in the error branch → red "verlangt
 *      der Server den Code …"
 *   L  the success message removed from saveUserDefaultCondition() →
 *      red "the default condition reports the saving" (message timed out)
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SettingsViewModelTest {

    private lateinit var paths: PfadServer
    private lateinit var t: TestDienste

    private val noReader = object : FileReader { override suspend fun lies(datei: FileRef): Pair<String?, ByteArray>? = null }

    private fun vm() = t.merke(SettingsViewModel(t.sitzung, t.filter(), t.hinweise, t.sync, testAccountRepository(t.api),
        testManagementRepository(t.api), t.alerts(), t.teile(),
        noReader))

    @Before
    fun auf() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        paths = PfadServer(
            "/api/v1/alerts" to """{"success":true,"alerts":[{"set_number":"75192-1","condition":"N","threshold":500.0}]}""",
            "/api/v1/sets/75192-1/alert" to """{"success":true}""",
            "/api/v1/storage/locations/3" to """{"success":true,"ort":{"id":3,"name":"Keller"}}""",
            "/api/v1/storage/locations" to """{"success":true,"orte":[{"id":3,"name":"Keller"}]}""",
            "/api/v1/settings" to """{"success":true}""",
            "/api/v1/settings/household/redeem" to """{"success":true,"error":"Verknüpft mit marco"}""",
            "/api/v1/settings/household" to """{"success":true,"is_sub":true}""",
            "/api/v1/sets/household-members" to """{"success":true,"members":[{"id":1,"username":"marco","is_self":true},{"id":2,"username":"kind"}]}""",
        )
        t = TestDienste(paths.imTakt(), io = Dispatchers.Main)
    }

    @After
    fun zu() {
        t.aufraeumen()
        Dispatchers.resetMain()
        paths.server.shutdown()
    }

    @Test
    fun `a threshold of zero does not go out`() {
        val vm = vm()
        vm.changeAlarmThreshold("75192-1", Zustand.NEU, Alarmrichtung.UNTER, Geld.NULL)
        assertEquals("t${R.string.alerts_bad_value}", t.meldungen.text)
        assertTrue(paths.requestsAn("/alert").isEmpty())
    }

    @Test
    fun `a changed alert reloads the overview`() {
        val vm = vm()
        vm.loadAlarmOverview()
        assertTrue("Übersicht", vm.alarmOverview.value.geladen)
        vm.changeAlarmThreshold("75192-1", Zustand.NEU, Alarmrichtung.UNTER, Geld.aus(450.0)!!)
        assertEquals("neu geladen", 2, paths.requestsAn("GET /api/v1/alerts").size)
        assertTrue(paths.requestsAn("PUT /api/v1/sets/75192-1/alert").isNotEmpty())
    }

    @Test
    fun `a renamed storage location also gets the new name on the sets in the store`() {
        paths.antworten["/api/v1/sets"] = """{"success":true,"total":1,"sets":[{"set_number":"75192-1","storage":"Kiste"}]}"""
        paths.antworten["/api/v1/storage/locations"] = """{"success":true,"orte":[{"id":3,"name":"Kiste"}]}"""
        runBlocking { t.sets().aktualisiereSets() }
        val vm = vm()
        vm.loadOwnLocations()
        assertEquals("Kiste", vm.storageState.value.eigene.single().name)
        paths.antworten["/api/v1/storage/locations"] = """{"success":true,"orte":[{"id":3,"name":"Keller"}]}"""
        vm.nameLocationUm(3, "Keller")
        assertEquals("die eigenen Orte neu", "Keller", vm.storageState.value.eigene.single().name)
        val abgelegt = runBlocking { t.sets().observeSets().first().liste.single() }
        assertEquals("ohne den Bestand neu zu holen", 1, paths.requestsAn("GET /api/v1/sets?").size)
        assertEquals("Keller", abgelegt.storage)
    }

    @Test
    fun `a storage location error without a sentence stays silent`() {
        paths.codes["/api/v1/storage/locations/3"] = 401
        val vm = vm()
        vm.deleteLocation(3)
        assertTrue("Antwort", paths.requestsAn("DELETE /api/v1/storage/locations/3").isNotEmpty())
        assertNull(t.meldungen.text)
    }

    @Test
    fun `a different currency applies immediately and the store fetches the stock again`() {
        val vm = vm()
        vm.saveSettings(Waehrung.CHF, Zustand.GEBRAUCHT)
        // Every price changes: the cache refetches sets, parts and figures.
        for (pfad in listOf("GET /api/v1/sets?", "GET /api/v1/parts?", "GET /api/v1/minifigs?")) {
            assertTrue(pfad, paths.requestsAn(pfad).isNotEmpty())
        }
        assertEquals(Waehrung.CHF, t.sitzung.state.value.currency)
        assertEquals(Zustand.GEBRAUCHT, t.sitzung.state.value.priceCondition)
    }

    @Test
    fun `the default condition reports the saving`() {
        paths.antworten["/api/v1/settings/user/default-condition"] = """{"success":true}"""
        val vm = vm()
        vm.saveUserDefaultCondition(Zustand.GEBRAUCHT)
        assertTrue("Meldung", t.meldungen.text != null)
        assertEquals("t${R.string.vm_settings_saved}", t.meldungen.text)
        assertTrue(paths.koerper.any { "\"U\"" in it })
    }

    @Test
    fun `a redeemed invitation loads status and household accounts`() {
        val vm = t.merke(HouseholdViewModel(t.sitzung, t.filter(), t.sync, testHouseholdRepository(t.api), testAccountRepository(t.api)))
        vm.redeemHouseholdInvite(" ABC123 ", "geheim1234")
        assertTrue("Konten da", t.blickfeld.konten.value.householdMembers.size == 2)
        assertTrue("Status da", vm.householdState.value.status?.isSub == true)
        assertTrue(paths.requestsAn("POST /api/v1/settings/household/redeem").single().isNotEmpty())
        val rumpf = paths.koerper[paths.requests.indexOfFirst { "household/redeem" in it }]
        assertEquals("""{"code":"ABC123","password":"geheim1234"}""", rumpf)
        assertEquals(1, vm.householdState.value.eingeloest)
    }

    @Test
    fun `a wrong password when redeeming marks the field`() {
        paths.antworten["/api/v1/settings/household/redeem"] =
            """{"success":false,"code":"aktuelles_passwort_falsch","error":"Aktuelles Passwort falsch"}"""
        paths.codes["/api/v1/settings/household/redeem"] = 400
        val vm = t.merke(HouseholdViewModel(t.sitzung, t.filter(), t.sync, testHouseholdRepository(t.api), testAccountRepository(t.api)))
        vm.redeemHouseholdInvite("ABC123", "falsch")
        assertTrue("Antwort", vm.householdState.value.abruf is Laden.Fehler)
        assertTrue(vm.householdState.value.passwordWrong)
        assertEquals("t${R.string.household_redeem_password_wrong}", vm.householdState.value.abruf.errorMessage.text)
        assertEquals(0, vm.householdState.value.eingeloest)
    }

    @Test
    fun `with an active second factor its code goes along when redeeming`() {
        paths.antworten["/api/v1/auth/zweiter-faktor"] = """{"success":true,"aktiv":true,"codes_uebrig":8}"""
        val vm = t.merke(HouseholdViewModel(t.sitzung, t.filter(), t.sync, testHouseholdRepository(t.api), testAccountRepository(t.api)))
        vm.loadHousehold()
        assertTrue("Codefeld", vm.householdState.value.factorNeeded)
        vm.redeemHouseholdInvite("ABC123", "geheim1234", " 123456 ")
        assertTrue("eingeloest", paths.requests.any { "household/redeem" in it })
        val rumpf = paths.koerper[paths.requests.indexOfFirst { "household/redeem" in it }]
        assertEquals("""{"code":"ABC123","password":"geheim1234","faktor_code":"123456"}""", rumpf)
    }

    @Test
    fun `if the server requires the second factor's code, the field appears`() {
        paths.antworten["/api/v1/settings/household/redeem"] =
            """{"success":false,"code":"zweiter_faktor_falsch","error":"Code falsch"}"""
        paths.codes["/api/v1/settings/household/redeem"] = 400
        val vm = t.merke(HouseholdViewModel(t.sitzung, t.filter(), t.sync, testHouseholdRepository(t.api), testAccountRepository(t.api)))
        assertFalse(vm.householdState.value.factorNeeded)
        vm.redeemHouseholdInvite("ABC123", "geheim1234")
        assertTrue("Antwort", vm.householdState.value.abruf is Laden.Fehler)
        assertTrue(vm.householdState.value.factorNeeded)
        assertTrue(vm.householdState.value.factorWrong)
        assertFalse(vm.householdState.value.passwordWrong)
        assertEquals("t${R.string.household_redeem_code_wrong}", vm.householdState.value.abruf.errorMessage.text)
    }

    @Test
    fun `after too many failed attempts the server's sentence comes, without it an own one`() {
        paths.antworten["/api/v1/settings/household/redeem"] =
            """{"success":false,"code":"zu_viele_fehlversuche","error":"Bitte in 5 Min. erneut"}"""
        paths.codes["/api/v1/settings/household/redeem"] = 429
        val vm = t.merke(HouseholdViewModel(t.sitzung, t.filter(), t.sync, testHouseholdRepository(t.api), testAccountRepository(t.api)))
        vm.redeemHouseholdInvite("ABC123", "falsch")
        assertTrue("Antwort", vm.householdState.value.abruf is Laden.Fehler)
        assertEquals("Bitte in 5 Min. erneut", vm.householdState.value.abruf.errorMessage.text)
        assertFalse(vm.householdState.value.passwordWrong)

        paths.antworten["/api/v1/settings/household/redeem"] = """{"success":false}"""
        vm.redeemHouseholdInvite("ABC123", "falsch")
        assertTrue("zweite Antwort", vm.householdState.value.abruf.errorMessage.text == "t${R.string.household_redeem_locked}")
    }
}
