package ch.brickinventoryapp

import ch.brickinventoryapp.data.Anmeldeablage
import ch.brickinventoryapp.data.repository.AdminRepository
import ch.brickinventoryapp.ui.viewmodel.AnmeldungViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
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
 * Das Anmelde-ViewModel, ausgeführt gegen einen Testserver und eine Ablage im
 * Speicher.
 *
 * Gegenproben (am 28.10.2026 gemessen, kotlinc gegen AnmeldungViewModel.kt):
 *   A  in angemeldet() anmeldungBeginnt() NACH dem Token → rot „eine Anmeldung
 *      leert die Filter, legt den Token ab …“ (die Reihenfolge wird mitgeschrieben)
 *   B  beim zweiten Faktor den Fehler auch ohne Code gezeigt → rot „beim ersten
 *      Mal fragt der zweite Faktor nur nach dem Code“
 *   C  in qrGescheitert() den Satz immer gesetzt → rot „ein zweiter QR-Anlauf
 *      nach gelungener Anmeldung meldet keinen Fehler“
 *   D  zuruecksetzen() leer → rot „nach dem Abmelden ist das Formular leer“
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AnmeldungViewModelTest {

    /** Schreibt mit, was in welcher Reihenfolge abgelegt wird. */
    private class Ablage(var url: String = "http://server") : Anmeldeablage {
        val protokoll = mutableListOf<String>()
        override suspend fun serverUrlJetzt() = url
        override suspend fun saveServerUrl(url: String) { this.url = url; protokoll += "url:$url" }
        override suspend fun saveAuthToken(token: String) { protokoll += "token:$token" }
        override suspend fun saveUsername(name: String) { protokoll += "name:$name" }
        override suspend fun bestaetigeKlartext(host: String) { protokoll += "klartext:$host" }
    }

    private lateinit var pfade: PfadServer
    private lateinit var t: TestDienste
    private lateinit var ablage: Ablage

    /** Die Filterablage meldet ihr Leeren in dasselbe Protokoll. */
    private fun vm(): AnmeldungViewModel {
        val blickAblage = object : ch.brickinventoryapp.ui.FilterAblage by SpeicherAblage() {
            override suspend fun allesVergessen() { ablage.protokoll += "filter-leer" }
        }
        val blickfeld = ch.brickinventoryapp.ui.Blickfeld(blickAblage,
            ch.brickinventoryapp.data.repository.HaushaltRepository(t.api, t.cache),
            ch.brickinventoryapp.data.repository.TeileRepository(t.api, t.cache))
        val dienste = ch.brickinventoryapp.ui.viewmodel.AppDienste(t.sitzung, blickfeld, t.meldungen,
            NummernTexte, t.bestand, t.scrollMemory)
        return t.merke(AnmeldungViewModel(dienste, AdminRepository(t.api, t.cache), ablage))
    }

    @Before
    fun auf() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        pfade = PfadServer()
        t = TestDienste(pfade.server)
        ablage = Ablage()
    }

    @After
    fun zu() {
        t.aufraeumen()
        Dispatchers.resetMain()
        pfade.server.shutdown()
    }

    @Test
    fun `eine Anmeldung leert die Filter, legt den Token ab und meldet die Sitzung`() {
        pfade.antworten["/api/v1/auth/login"] = """{"success":true,"token":"abc","user":{"id":1,"username":"marco","is_admin":true}}"""
        val vm = vm()
        vm.login("marco", "geheim")
        TestApi.warteBis("angemeldet") { t.sitzung.state.value.isLoggedIn }
        assertEquals(listOf("filter-leer", "token:abc", "name:marco"), ablage.protokoll)
        assertTrue(t.sitzung.state.value.isAdmin)
        assertFalse(vm.anmeldeState.value.loginLaeuft)
    }

    @Test
    fun `beim ersten Mal fragt der zweite Faktor nur nach dem Code`() {
        pfade.antworten["/api/v1/auth/login"] = """{"success":false,"zweiter_faktor":true,"error":"Code fehlt"}"""
        pfade.codes["/api/v1/auth/login"] = 401
        val vm = vm()
        vm.login("marco", "geheim")
        TestApi.warteBis("Codefeld") { vm.anmeldeState.value.codeNoetig }
        assertNull("Ohne eingegebenen Code ist das kein Fehler", vm.anmeldeState.value.loginError)

        vm.login("marco", "geheim", code = "123456")
        TestApi.warteBis("Satz des Servers") { vm.anmeldeState.value.loginError != null }
        assertEquals("Code fehlt", vm.anmeldeState.value.loginError)
        assertTrue(ablage.protokoll.none { it.startsWith("token:") })
    }

    @Test
    fun `ein zweiter QR-Anlauf nach gelungener Anmeldung meldet keinen Fehler`() {
        pfade.antworten["/api/v1/auth/qr-login"] = """{"success":false,"error":"Ungültiges oder abgelaufenes Token"}"""
        t.sitzung.aendere { it.copy(isLoggedIn = true) }
        val vm = vm()
        vm.loginWithQrToken("http://server/", "einmalig")
        TestApi.warteBis("Antwort") { pfade.anfragenAn("qr-login").isNotEmpty() && !vm.anmeldeState.value.loginLaeuft }
        assertNull(vm.anmeldeState.value.loginError)
        assertEquals("url:http://server", ablage.protokoll.first())
    }

    @Test
    fun `nach dem Abmelden ist das Formular leer`() {
        pfade.antworten["/api/v1/auth/login"] = """{"success":false,"error":"Falsches Passwort"}"""
        val vm = vm()
        vm.login("marco", "falsch")
        TestApi.warteBis("Fehler") { vm.anmeldeState.value.loginError != null }
        t.sitzung.abgemeldet()
        assertNull(vm.anmeldeState.value.loginError)
    }

    @Test
    fun `ein bestaetigter Klartext-Server wird vor der Adresse gemerkt`() {
        val vm = vm()
        vm.saveServerUrl("http://brick.example.org", klartextBestaetigt = true)
        TestApi.warteBis("abgelegt") { ablage.protokoll.size == 2 }
        assertEquals(listOf("klartext:brick.example.org", "url:http://brick.example.org"), ablage.protokoll)
    }
}
