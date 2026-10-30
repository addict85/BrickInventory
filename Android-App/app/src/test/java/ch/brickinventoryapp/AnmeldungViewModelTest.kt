package ch.brickinventoryapp

import ch.brickinventoryapp.data.Anmeldeablage
import ch.brickinventoryapp.data.repository.KontoRepository
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
 *   E  in richteEin() den Aufruf abmelden() entfernt → rot „ein anderer Server
 *      meldet vor der neuen Adresse ab“ und „ein QR-Code für einen anderen
 *      Server meldet zuerst ab“
 *   F  gleicheHerkunft() durch `!=` der rohen Texte ersetzt → rot „derselbe
 *      Server mit Schrägstrich meldet nicht ab“
 *   G  in login() die Rückfrage übersprungen (Bedingung `false`) → rot „ein
 *      Klartext-Login in einem fremden Netz fragt erst nach“
 *   H  richteEin() merkt das Netz nicht → rot „im Netz der Einrichtung fragt
 *      die Anmeldung nicht nach“
 *   I  (30.10.2026) merkePin() in loginWithQrToken() nach qrLogin() → rot „ein
 *      QR-Code mit Fingerabdruck pinnt vor der ersten Anfrage“
 *   J  (30.10.2026) LoginRequest wieder mit festem neverExpires = true → rot
 *      „ein Token ohne Ablauf nur ueber https“ (http-Teil)
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AnmeldungViewModelTest {

    /** Schreibt mit, was in welcher Reihenfolge abgelegt wird. */
    private class Ablage(var url: String = "https://server") : Anmeldeablage {
        val protokoll = java.util.Collections.synchronizedList(mutableListOf<String>())
        val netze = mutableSetOf<String>()
        override suspend fun serverUrlJetzt() = url
        override suspend fun saveServerUrl(url: String) { this.url = url; protokoll += "url:$url" }
        override suspend fun saveAuthToken(token: String) { protokoll += "token:$token" }
        override suspend fun saveUsername(name: String) { protokoll += "name:$name" }
        override suspend fun bestaetigeKlartext(host: String) { protokoll += "klartext:$host" }
        override suspend fun bekannteNetze() = netze.toSet()
        override suspend fun merkeNetz(eintrag: String) { netze += eintrag; protokoll += "netz:$eintrag" }
        override fun merkePin(schluessel: String, fingerabdruck: String) { protokoll += "pin:$schluessel=$fingerabdruck" }
    }

    /** Das Netz, in dem das Gerät gerade hängt. */
    private var netz: String? = "heim"

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
        return t.merke(AnmeldungViewModel(dienste, KontoRepository(t.api, t.cache), ablage) { netz })
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
        vm.loginWithQrToken("https://server/", "einmalig", abmelden = { ablage.protokoll += "abmelden" })
        TestApi.warteBis("Antwort") { pfade.anfragenAn("qr-login").isNotEmpty() && !vm.anmeldeState.value.loginLaeuft }
        assertNull(vm.anmeldeState.value.loginError)
        assertEquals("Derselbe Server: keine Abmeldung", "url:https://server", ablage.protokoll.first())
    }

    @Test
    fun `ein QR-Code mit Fingerabdruck pinnt vor der ersten Anfrage`() {
        val fp = java.util.Base64.getEncoder().encodeToString(ByteArray(32) { 7 })
        pfade.antworten["/api/v1/auth/qr-login"] = """{"success":true,"token":"abc","user":{"id":1,"username":"marco"}}"""
        val vm = vm()
        vm.loginWithQrToken("https://brick.example.org/", "bim:x", fingerabdruck = fp)
        TestApi.warteBis("angemeldet") { t.sitzung.state.value.isLoggedIn }
        assertEquals("pin:brick.example.org:443=$fp", ablage.protokoll.first())
    }

    @Test
    fun `ein Token ohne Ablauf nur ueber https`() {
        pfade.antworten["/api/v1/auth/login"] = """{"success":true,"token":"abc","user":{"id":1,"username":"marco"}}"""
        ablage.url = "http://localhost:3000"
        vm().login("marco", "geheim")
        TestApi.warteBis("http-Anmeldung") { pfade.anfragenAn("/auth/login").size == 1 }
        assertTrue(pfade.koerper.last(), pfade.koerper.last().contains("\"never_expires\":false"))

        ablage.url = "https://brick.example.org"
        vm().login("marco", "geheim")
        TestApi.warteBis("https-Anmeldung") { pfade.anfragenAn("/auth/login").size == 2 }
        assertTrue(pfade.koerper.last(), pfade.koerper.last().contains("\"never_expires\":true"))
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
        TestApi.warteBis("abgelegt") { ablage.protokoll.size == 3 }
        assertEquals(listOf("klartext:brick.example.org", "url:http://brick.example.org"), ablage.protokoll.take(2))
    }

    @Test
    fun `ein anderer Server meldet vor der neuen Adresse ab`() {
        t.sitzung.aendere { it.copy(isLoggedIn = true) }
        val vm = vm()
        vm.saveServerUrl("https://anderer.example:8443", abmelden = { ablage.protokoll += "abmelden" })
        TestApi.warteBis("abgelegt") { ablage.protokoll.any { it.startsWith("url:") } }
        assertEquals(listOf("abmelden", "url:https://anderer.example:8443"), ablage.protokoll.take(2))
    }

    @Test
    fun `derselbe Server mit Schraegstrich meldet nicht ab`() {
        t.sitzung.aendere { it.copy(isLoggedIn = true) }
        val vm = vm()
        vm.saveServerUrl("https://SERVER/", abmelden = { ablage.protokoll += "abmelden" })
        TestApi.warteBis("abgelegt") { ablage.protokoll.any { it.startsWith("url:") } }
        assertFalse(ablage.protokoll.contains("abmelden"))
    }

    @Test
    fun `ein QR-Code fuer einen anderen Server meldet zuerst ab`() {
        pfade.antworten["/api/v1/auth/qr-login"] = """{"success":true,"token":"neu","user":{"id":2,"username":"anna"}}"""
        t.sitzung.aendere { it.copy(isLoggedIn = true) }
        val vm = vm()
        vm.loginWithQrToken("https://neu.example", "einmalig", abmelden = { ablage.protokoll += "abmelden" })
        TestApi.warteBis("angemeldet") { ablage.protokoll.contains("token:neu") }
        val p = ablage.protokoll.toList()
        assertTrue("Abmelden vor der Adresse: $p", p.indexOf("abmelden") in 0 until p.indexOf("url:https://neu.example"))
        assertTrue("Die Adresse vor dem neuen Token: $p", p.indexOf("url:https://neu.example") < p.indexOf("token:neu"))
    }

    @Test
    fun `ein Klartext-Login in einem fremden Netz fragt erst nach`() {
        pfade.antworten["/api/v1/auth/login"] = """{"success":true,"token":"abc","user":{"id":1,"username":"marco"}}"""
        ablage.url = "http://nas:3000"
        netz = "hotel"
        val vm = vm()
        vm.login("marco", "geheim")
        TestApi.warteBis("Rückfrage") { vm.anmeldeState.value.netzFrage }
        Thread.sleep(100)
        assertTrue("Ohne Ja geht das Passwort nicht hinaus", pfade.anfragenAn("/auth/login").isEmpty())

        vm.login("marco", "geheim", netzBestaetigt = true)
        TestApi.warteBis("angemeldet") { t.sitzung.state.value.isLoggedIn }
        assertFalse(vm.anmeldeState.value.netzFrage)
        assertTrue(ablage.netze.contains("http://nas:3000|hotel"))
    }

    @Test
    fun `im Netz der Einrichtung fragt die Anmeldung nicht nach`() {
        pfade.antworten["/api/v1/auth/login"] = """{"success":true,"token":"abc","user":{"id":1,"username":"marco"}}"""
        val vm = vm()
        vm.saveServerUrl("http://nas:3000")
        TestApi.warteBis("eingerichtet") { ablage.netze.isNotEmpty() }
        vm.login("marco", "geheim")
        TestApi.warteBis("angemeldet") { t.sitzung.state.value.isLoggedIn }
        assertFalse(vm.anmeldeState.value.netzFrage)
    }

    @Test
    fun `verneint geht nichts hinaus und die Frage verschwindet`() {
        ablage.url = "http://nas:3000"
        netz = null
        val vm = vm()
        vm.login("marco", "geheim")
        TestApi.warteBis("Rückfrage") { vm.anmeldeState.value.netzFrage }
        vm.netzFrageVerwerfen()
        assertFalse(vm.anmeldeState.value.netzFrage)
        assertTrue(pfade.anfragenAn("/auth/login").isEmpty())
    }
}
