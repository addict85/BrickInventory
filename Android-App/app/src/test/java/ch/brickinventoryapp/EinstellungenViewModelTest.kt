package ch.brickinventoryapp

import android.net.Uri
import ch.brickinventoryapp.data.repository.AdminRepository
import ch.brickinventoryapp.data.repository.HaushaltRepository
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.data.repository.TeileRepository
import ch.brickinventoryapp.ui.Aenderung
import ch.brickinventoryapp.ui.viewmodel.DateiLeser
import ch.brickinventoryapp.ui.viewmodel.EinstellungenViewModel
import ch.brickinventoryapp.ui.viewmodel.HaushaltViewModel
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

/**
 * Einstellungen und Haushalt, ausgeführt gegen einen Testserver.
 *
 * Gegenproben (am 28.10.2026 gemessen, kotlinc gegen EinstellungenViewModel.kt
 * und HaushaltViewModel.kt):
 *   A  in aendereAlarmSchwelle() die Prüfung auf > 0 entfernt → rot „eine
 *      Schwelle von null geht nicht hinaus“
 *   B  in beiAenderung() die Übersicht nicht nachgeladen → rot „ein geänderter
 *      Alarm wird gemeldet und die Übersicht lädt nach“
 *   C  in lagerortSchleuse() das Melden beim Umbenennen entfernt → rot „ein
 *      umbenannter Lagerort lädt die eigenen Orte und die Galerie“
 *   D  in saveSettings() nur Sets melden → rot „eine andere Währung …“
 *   E  in kontenGeaendert() die Haushaltskonten nicht neu geladen → rot „eine
 *      eingelöste Einladung lädt Status und Haushaltskonten“
 *   F  im Repository das Passwort nicht mitgeschickt → rot „eine eingelöste
 *      Einladung …“ (Rumpf ohne password)
 *   G  in redeemHouseholdInvite() `passwortFalsch` nicht gesetzt → rot „ein
 *      falsches Passwort beim Einlösen markiert das Feld“
 *   H  in einloeseFehler() den Zweig für die Sperre entfernt → rot „nach zu
 *      vielen Fehlversuchen …“ (statt des eigenen Satzes kam „fehler“)
 */
@OptIn(ExperimentalCoroutinesApi::class)
class EinstellungenViewModelTest {

    private lateinit var pfade: PfadServer
    private lateinit var t: TestDienste

    private val keinLeser = object : DateiLeser { override suspend fun lies(uri: Uri): Pair<String?, ByteArray>? = null }

    private fun vm() = t.merke(EinstellungenViewModel(t.dienste, AdminRepository(t.api, t.cache),
        SetsRepository(t.api, t.cache), TeileRepository(t.api, t.cache), keinLeser))

    @Before
    fun auf() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        pfade = PfadServer(
            "/api/v1/alerts" to """{"success":true,"alerts":[{"set_number":"75192-1","condition":"N","schwelle":500.0}]}""",
            "/api/v1/sets/75192-1/alert" to """{"success":true}""",
            "/api/v1/storage/locations/3" to """{"success":true,"ort":{"id":3,"name":"Keller"}}""",
            "/api/v1/storage/locations" to """{"success":true,"orte":[{"id":3,"name":"Keller"}]}""",
            "/api/v1/settings" to """{"success":true}""",
            "/api/v1/settings/household/redeem" to """{"success":true,"error":"Verknüpft mit marco"}""",
            "/api/v1/settings/household" to """{"success":true,"is_sub":true}""",
            "/api/v1/sets/household-members" to """{"success":true,"members":[{"id":1,"username":"marco","is_self":true},{"id":2,"username":"kind"}]}""",
        )
        t = TestDienste(pfade.server)
    }

    @After
    fun zu() {
        t.aufraeumen()
        Dispatchers.resetMain()
        pfade.server.shutdown()
    }

    @Test
    fun `eine Schwelle von null geht nicht hinaus`() {
        val vm = vm()
        vm.aendereAlarmSchwelle("75192-1", "N", "unter", 0.0)
        Thread.sleep(200)
        assertEquals("t${R.string.alerts_bad_value}", t.meldungen.meldung.value)
        assertTrue(pfade.anfragenAn("/alert").isEmpty())
    }

    @Test
    fun `ein geaenderter Alarm wird gemeldet und die Uebersicht laedt nach`() {
        val vm = vm()
        vm.ladeAlarmUebersicht()
        TestApi.warteBis("Übersicht") { vm.alarmUebersicht.value.geladen }
        val liste = t.gemeldet(1) {
            vm.aendereAlarmSchwelle("75192-1", "N", "unter", 450.0)
            TestApi.warteBis("neu geladen") { pfade.anfragenAn("GET /api/v1/alerts").size == 2 }
        }
        assertEquals(listOf(Aenderung.Alarme), liste)
        assertTrue(pfade.anfragenAn("PUT /api/v1/sets/75192-1/alert").isNotEmpty())
    }

    @Test
    fun `ein umbenannter Lagerort laedt die eigenen Orte und die Galerie`() {
        val vm = vm()
        val liste = t.gemeldet(1) {
            vm.benenneLagerortUm(3, "Keller")
            TestApi.warteBis("Orte neu") { vm.lagerState.value.eigene.isNotEmpty() }
        }
        assertEquals(listOf(Aenderung.Sets), liste)
        assertEquals("Keller", vm.lagerState.value.eigene.single().name)
    }

    @Test
    fun `ein Lagerort-Fehler ohne Satz bleibt still`() {
        pfade.codes["/api/v1/storage/locations/3"] = 401
        val vm = vm()
        vm.loescheLagerort(3)
        TestApi.warteBis("Antwort") { pfade.anfragenAn("DELETE /api/v1/storage/locations/3").isNotEmpty() }
        Thread.sleep(200)
        assertNull(t.meldungen.meldung.value)
    }

    @Test
    fun `eine andere Waehrung gilt sofort und alle Bestandsansichten laden neu`() {
        val vm = vm()
        val liste = t.gemeldet(3) { vm.saveSettings("CHF", "U") }
        assertEquals(listOf(Aenderung.Sets, Aenderung.Teile, Aenderung.Figuren), liste)
        assertEquals("CHF", t.sitzung.state.value.currency)
        assertEquals("U", t.sitzung.state.value.priceCondition)
    }

    @Test
    fun `eine eingeloeste Einladung laedt Status und Haushaltskonten`() {
        val vm = t.merke(HaushaltViewModel(t.dienste, HaushaltRepository(t.api, t.cache)))
        vm.redeemHouseholdInvite(" ABC123 ", "geheim1234")
        TestApi.warteBis("Konten da") { t.blickfeld.konten.value.householdMembers.size == 2 }
        TestApi.warteBis("Status da") { vm.householdState.value.status?.isSub == true }
        assertTrue(pfade.anfragenAn("POST /api/v1/settings/household/redeem").single().isNotEmpty())
        val rumpf = pfade.koerper[pfade.anfragen.indexOfFirst { "household/redeem" in it }]
        assertEquals("""{"code":"ABC123","password":"geheim1234"}""", rumpf)
        assertEquals(1, vm.householdState.value.eingeloest)
    }

    @Test
    fun `ein falsches Passwort beim Einloesen markiert das Feld`() {
        pfade.antworten["/api/v1/settings/household/redeem"] =
            """{"success":false,"code":"aktuelles_passwort_falsch","error":"Aktuelles Passwort falsch"}"""
        pfade.codes["/api/v1/settings/household/redeem"] = 400
        val vm = t.merke(HaushaltViewModel(t.dienste, HaushaltRepository(t.api, t.cache)))
        vm.redeemHouseholdInvite("ABC123", "falsch")
        TestApi.warteBis("Antwort") { !vm.householdState.value.isLoading && vm.householdState.value.message != null }
        assertTrue(vm.householdState.value.passwortFalsch)
        assertEquals("t${R.string.household_redeem_password_wrong}", vm.householdState.value.message)
        assertEquals(0, vm.householdState.value.eingeloest)
    }

    @Test
    fun `nach zu vielen Fehlversuchen kommt der Satz des Servers, ohne ihn ein eigener`() {
        pfade.antworten["/api/v1/settings/household/redeem"] =
            """{"success":false,"code":"zu_viele_fehlversuche","error":"Bitte in 5 Min. erneut"}"""
        pfade.codes["/api/v1/settings/household/redeem"] = 429
        val vm = t.merke(HaushaltViewModel(t.dienste, HaushaltRepository(t.api, t.cache)))
        vm.redeemHouseholdInvite("ABC123", "falsch")
        TestApi.warteBis("Antwort") { vm.householdState.value.message != null }
        assertEquals("Bitte in 5 Min. erneut", vm.householdState.value.message)
        assertFalse(vm.householdState.value.passwortFalsch)

        pfade.antworten["/api/v1/settings/household/redeem"] = """{"success":false}"""
        vm.redeemHouseholdInvite("ABC123", "falsch")
        TestApi.warteBis("zweite Antwort") { vm.householdState.value.message == "t${R.string.household_redeem_locked}" }
    }
}
