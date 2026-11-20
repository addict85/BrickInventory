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
 * Einstellungen und Haushalt, ausgeführt gegen einen PfadServer ohne Netz.
 *
 * Gegenproben (am 28.10.2026 gemessen, kotlinc gegen SettingsViewModel.kt
 * und HouseholdViewModel.kt):
 *   A  in changeAlarmThreshold() die Prüfung auf > 0 entfernt → rot „eine
 *      Schwelle von null geht nicht hinaus“
 *   B  in alarmLock() `alertsNew()` entfernt → rot „ein geänderter Alarm lädt
 *      die Übersicht nach“
 *   C  in nameLocationUm() den alten Namen leer gelassen → rot „ein umbenannter
 *      Lagerort heisst auch an den Sets in der Ablage neu“ („Kiste“ blieb stehen)
 *   D  in saveSettings() nur die Sets nachziehen → rot „eine andere Währung …“
 *   E  in accountsChanged() die Haushaltskonten nicht neu geladen → rot „eine
 *      eingelöste Einladung lädt Status und Haushaltskonten“
 *   F  im Repository das Passwort nicht mitgeschickt → rot „eine eingelöste
 *      Einladung …“ (Rumpf ohne password)
 *   G  in redeemHouseholdInvite() `passwordWrong` nicht gesetzt → rot „ein
 *      falsches Passwort beim Einlösen markiert das Feld“
 *   H  in redeemError() den Zweig für die Sperre entfernt → rot „nach zu
 *      vielen Fehlversuchen …“ (statt des eigenen Satzes kam „fehler“)
 *   I  im Repository `faktor_code` nicht in den Rumpf → rot „bei
 *      aktivem zweitem Faktor geht dessen Code …“
 *   J  in checkSecondFactor() `r.data.aktiv` → `false` → rot
 *      „bei aktivem zweitem Faktor …“ (Zeitüberschreitung Codefeld)
 *   K  im Fehlerzweig `factorNeeded` nicht gesetzt → rot „verlangt
 *      der Server den Code …“
 *   L  in saveUserDefaultCondition() die Erfolgsmeldung entfernt →
 *      rot „der Standard-Zustand meldet das Speichern“ (Zeitüberschreitung Meldung)
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
    fun `eine Schwelle von null geht nicht hinaus`() {
        val vm = vm()
        vm.changeAlarmThreshold("75192-1", Zustand.NEU, Alarmrichtung.UNTER, Geld.NULL)
        assertEquals("t${R.string.alerts_bad_value}", t.meldungen.text)
        assertTrue(paths.requestsAn("/alert").isEmpty())
    }

    @Test
    fun `ein geaenderter Alarm laedt die Uebersicht nach`() {
        val vm = vm()
        vm.loadAlarmOverview()
        assertTrue("Übersicht", vm.alarmOverview.value.geladen)
        vm.changeAlarmThreshold("75192-1", Zustand.NEU, Alarmrichtung.UNTER, Geld.aus(450.0)!!)
        assertEquals("neu geladen", 2, paths.requestsAn("GET /api/v1/alerts").size)
        assertTrue(paths.requestsAn("PUT /api/v1/sets/75192-1/alert").isNotEmpty())
    }

    @Test
    fun `ein umbenannter Lagerort heisst auch an den Sets in der Ablage neu`() {
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
    fun `ein Lagerort-Fehler ohne Satz bleibt still`() {
        paths.codes["/api/v1/storage/locations/3"] = 401
        val vm = vm()
        vm.deleteLocation(3)
        assertTrue("Antwort", paths.requestsAn("DELETE /api/v1/storage/locations/3").isNotEmpty())
        assertNull(t.meldungen.text)
    }

    @Test
    fun `eine andere Waehrung gilt sofort und die Ablage holt den Bestand neu`() {
        val vm = vm()
        vm.saveSettings(Waehrung.CHF, Zustand.GEBRAUCHT)
        // Jeder Preis ändert sich: Die Ablage holt Sets, Teile und Figuren neu.
        for (pfad in listOf("GET /api/v1/sets?", "GET /api/v1/parts?", "GET /api/v1/minifigs?")) {
            assertTrue(pfad, paths.requestsAn(pfad).isNotEmpty())
        }
        assertEquals(Waehrung.CHF, t.sitzung.state.value.currency)
        assertEquals(Zustand.GEBRAUCHT, t.sitzung.state.value.priceCondition)
    }

    @Test
    fun `der Standard-Zustand meldet das Speichern`() {
        paths.antworten["/api/v1/settings/user/default-condition"] = """{"success":true}"""
        val vm = vm()
        vm.saveUserDefaultCondition(Zustand.GEBRAUCHT)
        assertTrue("Meldung", t.meldungen.text != null)
        assertEquals("t${R.string.vm_settings_saved}", t.meldungen.text)
        assertTrue(paths.koerper.any { "\"U\"" in it })
    }

    @Test
    fun `eine eingeloeste Einladung laedt Status und Haushaltskonten`() {
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
    fun `ein falsches Passwort beim Einloesen markiert das Feld`() {
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
    fun `bei aktivem zweitem Faktor geht dessen Code beim Einloesen mit`() {
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
    fun `verlangt der Server den Code des zweiten Faktors, erscheint das Feld`() {
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
    fun `nach zu vielen Fehlversuchen kommt der Satz des Servers, ohne ihn ein eigener`() {
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
