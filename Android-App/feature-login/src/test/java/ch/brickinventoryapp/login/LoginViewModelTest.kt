package ch.brickinventoryapp.login

import ch.brickinventoryapp.model.ui.laeuft
import ch.brickinventoryapp.model.ui.errorMessage
import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.testing.text
import ch.brickinventoryapp.data.Anmeldeablage
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.login.ui.PasskeyQuery
import ch.brickinventoryapp.login.ui.PasskeyResult
import ch.brickinventoryapp.login.ui.viewmodel.AnmeldungViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import ch.brickinventoryapp.testing.testHouseholdRepository
import ch.brickinventoryapp.testing.testAccountRepository
import ch.brickinventoryapp.state.ui.Scope
import ch.brickinventoryapp.state.ui.FilterStore
import ch.brickinventoryapp.login.ui.QrAccount
import java.util.Base64
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap
import ch.brickinventoryapp.testing.PfadServer
import ch.brickinventoryapp.testing.SessionFake
import ch.brickinventoryapp.testing.StorageStore
import ch.brickinventoryapp.testing.testPartsRepository
import ch.brickinventoryapp.testing.TestDienste
import ch.brickinventoryapp.security.PinStore
import ch.brickinventoryapp.security.CertificateUnresolved
import ch.brickinventoryapp.security.CertificateQuestion

/**
 * The sign-in ViewModel, run against a PfadServer without network and a store in
 * memory.
 *
 * Counter-checks (measured 28.10.2026, kotlinc against AnmeldungViewModel.kt):
 *   A  in angemeldet() loginBegins() AFTER the token → red “a sign-in
 *      clears the filters, stores the token …” (the order is recorded)
 *   B  on the second factor the error shown even without a code → red “the
 *      first time, the second factor only asks for the code”
 *   C  in qrFailed() the sentence always set → red “a second QR attempt
 *      after a successful sign-in reports no error”
 *   D  zuruecksetzen() empty → red “after sign-out the form is empty”
 *   E  in setUpOne() the call sessionService.abmelden() removed → red “a different server
 *      signs out before the new address” (since S2 the QR path only signs out after the yes, see AC)
 *   F  sameOrigin() replaced with `!=` of the raw texts → red “the
 *      same server with a trailing slash does not sign out”
 *   G  in saveServerUrl() the check adressfehler() removed → red
 *      “an http address is not saved”
 *   H  in loginWithQrToken() the check removed → red “a
 *      QR code with an http address …” (address saved, qr-login called)
 *   I  rememberPin() in loginWithQrToken() after qrLogin() → red “a
 *      QR code with a fingerprint pins before the first request” (test rewritten
 *      since O–Q: held, not remembered)
 *   O  in loginWithQrToken() back to rememberPin() instead of holdBefore() before qrLogin() →
 *      red “a failed QR code leaves no pin” and “… holds the
 *      pin …”
 *   P  the check bisherigerPin() before the start removed → red “a QR code
 *      with a different key never silently replaces the pin”
 *   R  the check bestaetigtFingerabdruck() in loginWithQrToken()
 *      replaced with `pinSwitchInput == null` (any input is enough) → red
 *      “a QR code with a different key never silently replaces the pin” (wrongly
 *      typed-off value accepted)
 *   Q  the finally with forgetRetained() removed → red “a failed
 *      QR code leaves no pin behind” (timeout, nothing forgotten)
 *   J  LoginRequest back to a fixed neverExpires = true → red
 *      “a token without expiry only via https” (http part)
 *   K  PasskeyAnmeldung with mitToken = false → red “signing in with a
 *      passkey stores the token …”
 *   L  cancelled treated as NoPasskey with a sentence → red “a
 *      cancelled passkey dialog …”
 *   M  SecondFactorRoutes not read in AccountRepository → red
 *      “the second factor accepts the passkey …” (button missing)
 *   N  passkeyStattCode() does not pass the passkey to login() →
 *      red “the second factor accepts the passkey …” (no passkey in the body)
 *   S  in fetchPasskey() RpIdFinding.FOREIGN let through → red
 *      “options for a foreign domain …” and “options without an rpId … second factor”
 *   T  RpIdFinding.MISSING let through → red “options without an rpId …”
 *   U  checkRpId() with ignoreCase and subdomains (`host.endsWith("." + rpId)`)
 *      → red “options for a foreign domain …”
 *   V  the check on the address after the dialog removed → red “the
 *      address changes during the passkey dialog …”
 *   W  FINGERPRINT_TYPE_IN = 16 → red “a QR code with a different key
 *      never silently replaces the pin” (16 characters accepted)
 *   X  mussAbtippen() without a pin back to `false` (the state before: a tap
 *      was enough on first setup) → red “a private key from the
 *      QR code only counts, on first setup, once typed off”;
 *      gegenproben/qr-pin-ohne-abtippen.patch
 *   Y  in pairQr() the question about the account skipped (always yes) →
 *      red “a QR sign-in shows the account and server …”; gegenproben/qr-ohne-kontofrage.patch
 *   Z  on a no, discardQr() not called → red “a no to the shown
 *      account …”; gegenproben/qr-nein-ohne-verwerfen.patch
 * Counter-checks for the server switch via QR (added 12.11.2026; measurable only in CI without Gradle):
 *   AC loginWithQrToken() back to calling setUpOne() before the fetch (sign out right away) → red
 *      “a no to a different server's account …” and “… only after the yes …”;
 *      gegenproben/qr-wechsel-meldet-sofort-ab.patch
 *   AD in qrFailed() without `!pairingWithSwitch` → red “if the pairing fails with
 *      a different server …” (error swallowed); gegenproben/qr-wechsel-fehler-verschluckt.patch
 *   AE in leavePreviousServer() without `kopplungsziel(null)` → red “… only after the yes …”
 *      (signed out while requests were still going to the new server);
 *      gegenproben/qr-wechsel-abmelden-am-neuen.patch
 */
@OptIn(ExperimentalCoroutinesApi::class)
class LoginViewModelTest {

    /** Records what is stored in which order. */
    private class Ablage(var url: String = "https://server") : Anmeldeablage {
        val protokoll = Collections.synchronizedList(mutableListOf<String>())
        override suspend fun serverUrlJetzt() = url
        override suspend fun saveServerUrl(url: String) { this.url = url; protokoll += "url:$url" }
        override suspend fun saveAuthToken(token: String) { protokoll += "token:$token" }
        override suspend fun saveUsername(name: String) { protokoll += "name:$name" }
        val pins = ConcurrentHashMap<String, String>()
        override fun rememberPin(schluessel: String, fingerabdruck: String) {
            pins[schluessel] = fingerabdruck; protokoll += "pin:$schluessel=$fingerabdruck"
        }
        override fun rememberedPin(schluessel: String): String? = pins[schluessel]
        override fun holdBefore(schluessel: String, fingerabdruck: String) { protokoll += "vor:$schluessel=$fingerabdruck" }
        override fun forgetRetained(schluessel: String) { protokoll += "vergiss:$schluessel" }
        override fun kopplungsziel(url: String?) { protokoll += "ziel:$url" }
    }

    private lateinit var paths: PfadServer
    private lateinit var t: TestDienste
    private lateinit var ablage: Ablage
    private lateinit var frage: CertificateQuestion

    /** The filter store reports its clearing into the same log; [roots] plays the system roots. */
    private fun vm(roots: Set<String> = emptySet()): AnmeldungViewModel {
        val viewStore = object : FilterStore by StorageStore() {
            override suspend fun everythingForgotten() { ablage.protokoll += "filter-leer" }
        }
        val blickfeld = Scope(viewStore,
            testHouseholdRepository(t.api),
            testPartsRepository(t.api))
        val abmelden = SessionFake { ablage.protokoll += "abmelden" }
        return t.merke(AnmeldungViewModel(t.sitzung, blickfeld, t.hinweise, abmelden,
            testAccountRepository(t.api), ablage, frage) { it in roots })
    }

    @Before
    fun auf() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        paths = PfadServer()
        t = TestDienste(paths.imTakt(), io = Dispatchers.Main)
        ablage = Ablage()
        frage = CertificateQuestion()
    }

    @After
    fun zu() {
        t.aufraeumen()
        Dispatchers.resetMain()
        paths.server.shutdown()
    }

    @Test
    fun `a sign-in empties the filters, stores the token and reports the session`() {
        paths.antworten["/api/v1/auth/login"] = """{"success":true,"token":"abc","user":{"id":1,"username":"marco","is_admin":true},
            "token_info":{"scope":"voll","never_expires":false}}"""
        val vm = vm()
        vm.setFullAccess(true)
        vm.login("marco", "geheim")
        assertTrue("angemeldet", t.sitzung.state.value.isLoggedIn)
        assertEquals(listOf("filter-leer", "token:abc", "name:marco"), ablage.protokoll)
        assertTrue(paths.koerper.single(), "\"scope\":\"voll\"" in paths.koerper.single())
        assertTrue(t.sitzung.state.value.isAdmin)
        assertFalse(vm.anmeldeState.value.anmeldung.laeuft)
    }

    /**
     * Without the checkbox, a token with scope "app": the account right alone does not make
     * an admin in the app, the server would reject its calls with 403.
     * Counter-check: in AnmeldungViewModel `r.data.verwalter`
     * → `r.data.user?.isAdmin == true` → red “admin account without the checkbox …”.
     */
    @Test
    fun `admin account without the check mark signs in without admin rights`() {
        paths.antworten["/api/v1/auth/login"] = """{"success":true,"token":"abc","user":{"id":1,"username":"marco","is_admin":true},
            "token_info":{"scope":"app","never_expires":false}}"""
        val vm = vm()
        vm.login("marco", "geheim")
        assertTrue("angemeldet", t.sitzung.state.value.isLoggedIn)
        assertTrue(paths.koerper.single(), "\"scope\":\"app\"" in paths.koerper.single())
        assertFalse(t.sitzung.state.value.isAdmin)
    }

    @Test
    fun `the first time the second factor asks only for the code`() {
        paths.antworten["/api/v1/auth/login"] = """{"success":false,"zweiter_faktor":true,"error":"Code fehlt"}"""
        paths.codes["/api/v1/auth/login"] = 401
        val vm = vm()
        vm.login("marco", "geheim")
        assertTrue("Codefeld", vm.anmeldeState.value.codeNoetig)
        assertNull("Ohne eingegebenen Code ist das kein Fehler", vm.anmeldeState.value.anmeldung.errorMessage)
        assertFalse("Ohne `passkey: true` kein Passkey-Knopf", vm.anmeldeState.value.passkeyStattCode)

        vm.login("marco", "geheim", code = "123456")
        assertTrue("Satz des Servers", vm.anmeldeState.value.anmeldung.errorMessage != null)
        assertEquals("Code fehlt", vm.anmeldeState.value.anmeldung.errorMessage.text)
        assertTrue(ablage.protokoll.none { it.startsWith("token:") })
    }

    @Test
    fun `a second QR attempt after a successful sign-in reports no error`() {
        paths.antworten["/api/v1/auth/qr-login"] = """{"success":false,"error":"Ungültiges oder abgelaufenes Token"}"""
        t.sitzung.angemeldet(admin = false)
        val vm = vm()
        vm.loginWithQrToken("https://server/", "einmalig")
        assertTrue("Antwort", paths.requestsAn("qr-login").isNotEmpty() && !vm.anmeldeState.value.anmeldung.laeuft)
        assertNull(vm.anmeldeState.value.anmeldung.errorMessage)
        assertEquals("Derselbe Server: keine Abmeldung", "url:https://server", ablage.protokoll.first())
    }

    private val fp = Base64.getEncoder().encodeToString(ByteArray(32) { 7 })
    private val fpAlt = Base64.getEncoder().encodeToString(ByteArray(32) { 9 })

    @Test
    fun `a QR code with fingerprint holds the pin for the first request and remembers it only afterwards`() {
        paths.antworten["/api/v1/auth/qr-login"] = """{"success":true,"wartet":true,"abholung":"h","code":"123456","expires_in":300}"""
        paths.antworten["/api/v1/auth/qr-login/abholen"] = """{"success":true,"wartet":false,"token":"abc","user":{"id":1,"username":"marco"}}"""
        val vm = vm(roots = setOf(fp))
        vm.loginWithQrToken("https://brick.example.org/", "bim:x", fingerabdruck = fp)
        vm.decideQrAccount(true)
        assertTrue("angemeldet", t.sitzung.state.value.isLoggedIn && ablage.protokoll.any { it.startsWith("vergiss:") })
        val p = ablage.protokoll.toList()
        assertEquals("vor:brick.example.org:443=$fp", p.first())
        assertTrue("Gemerkt nach der Adresse, vor dem Token: $p",
            p.indexOf("url:https://brick.example.org") < p.indexOf("pin:brick.example.org:443=$fp") &&
                p.indexOf("pin:brick.example.org:443=$fp") < p.indexOf("token:abc"))
        assertEquals(fp, ablage.pins["brick.example.org:443"])
    }

    /** The first qr-login's handshake asks for the certificate and aborts (503 instead of TLS). */
    private fun firstContactOnFirstQrLogin() {
        paths.antworten["/api/v1/auth/qr-login"] = """{"success":true,"wartet":true,"abholung":"h","code":"123456","expires_in":300}"""
        paths.antworten["/api/v1/auth/qr-login/abholen"] = """{"success":true,"wartet":false,"token":"abc","user":{"id":1,"username":"marco"}}"""
        var erster = true
        paths.priority = { _, pfad ->
            if (erster && pfad == "/api/v1/auth/qr-login") {
                erster = false
                frage.melde(CertificateUnresolved("brick.example.org:443", fp, CertificateUnresolved.Art.ERSTKONTAKT, ctForced = true))
                503 to """{"success":false}"""
            } else null
        }
    }

    private val pinsTheStore = object : PinStore {
        override fun pin(schluessel: String) = ablage.rememberedPin(schluessel)
        override fun rememberPin(schluessel: String, fingerabdruck: String) = ablage.rememberPin(schluessel, fingerabdruck)
    }

    @Test
    fun `after the yes to the first contact the QR code signs in without a new scan`() {
        firstContactOnFirstQrLogin()
        val vm = vm()
        vm.loginWithQrToken("https://brick.example.org/", "bim:x")
        assertTrue("Wartet auf den Dialog statt „Keine Verbindung“", vm.anmeldeState.value.anmeldung.laeuft)
        assertNull(vm.anmeldeState.value.anmeldung.errorMessage)

        assertTrue(frage.confirm(pinsTheStore))
        assertEquals("Zweiter Versuch", 2, paths.requests.count { it == "POST /api/v1/auth/qr-login" })
        vm.decideQrAccount(true)
        assertTrue("angemeldet: ${ablage.protokoll}", t.sitzung.state.value.isLoggedIn)
        assertNull(vm.anmeldeState.value.anmeldung.errorMessage)
    }

    @Test
    fun `after the no to the first contact it stays at one attempt`() {
        firstContactOnFirstQrLogin()
        val vm = vm()
        vm.loginWithQrToken("https://brick.example.org/", "bim:x")
        frage.verwerfen()
        assertEquals(1, paths.requests.count { it == "POST /api/v1/auth/qr-login" })
        assertFalse(vm.anmeldeState.value.anmeldung.laeuft)
        assertNotNull(vm.anmeldeState.value.anmeldung.errorMessage)
        assertFalse(t.sitzung.state.value.isLoggedIn)
    }

    @Test
    fun `a failed QR code leaves no pin`() {
        paths.antworten["/api/v1/auth/qr-login"] = """{"success":false,"error":"Ungültiges oder abgelaufenes Token"}"""
        val vm = vm(roots = setOf(fp))
        vm.loginWithQrToken("https://brick.example.org/", "bim:x", fingerabdruck = fp)
        assertTrue("Antwort", ablage.protokoll.any { it.startsWith("vergiss:") })
        assertTrue(paths.requestsAn("qr-login").isNotEmpty())
        assertTrue("Nichts dauerhaft: ${ablage.protokoll}", ablage.pins.isEmpty())
        assertEquals("vergiss:brick.example.org:443", ablage.protokoll.last())
        assertFalse(t.sitzung.state.value.isLoggedIn)
    }

    @Test
    fun `a QR code with a different key never silently replaces the pin`() {
        paths.antworten["/api/v1/auth/qr-login"] = """{"success":true,"wartet":true,"abholung":"h","code":"123456","expires_in":300}"""
        paths.antworten["/api/v1/auth/qr-login/abholen"] = """{"success":true,"wartet":false,"token":"abc","user":{"id":1,"username":"marco"}}"""
        ablage.pins["brick.example.org:443"] = fpAlt
        val vm = vm()
        assertEquals("Der Bildschirm bekommt den bisherigen", fpAlt, vm.bisherigerPin("brick.example.org", fp))
        assertNull("Derselbe ist kein Wechsel", vm.bisherigerPin("https://brick.example.org/", fpAlt))

        vm.loginWithQrToken("https://brick.example.org/", "bim:x", fingerabdruck = fp)
        assertEquals("t${R.string.setup_qr_pin_wechsel_abgelehnt}", vm.anmeldeState.value.anmeldung.errorMessage.text)
        assertTrue("Ohne Bestätigung nichts: ${ablage.protokoll}", ablage.protokoll.isEmpty())
        assertTrue(paths.requestsAn("qr-login").isEmpty())
        assertEquals(fpAlt, ablage.pins["brick.example.org:443"])

        // A tap with a wrongly typed-off value is just as insufficient.
        vm.loginWithQrToken("https://brick.example.org/", "bim:x", fingerabdruck = fp,
            pinSwitchInput = "09:09:09:09:09:09:09:09:09:09:09:09")
        assertEquals("t${R.string.setup_qr_pin_wechsel_abgelehnt}", vm.anmeldeState.value.anmeldung.errorMessage.text)
        assertTrue("Falsch abgeschrieben: nichts", paths.requestsAn("qr-login").isEmpty())

        // 16 characters (64 bits) are no longer enough.
        vm.loginWithQrToken("https://brick.example.org/", "bim:x", fingerabdruck = fp,
            pinSwitchInput = "07:07:07:07:07:07:07:07")
        assertEquals("t${R.string.setup_qr_pin_wechsel_abgelehnt}", vm.anmeldeState.value.anmeldung.errorMessage.text)

        // The last 24 hex characters of the new fingerprint, as typed off from the web app.
        vm.loginWithQrToken("https://brick.example.org/", "bim:x", fingerabdruck = fp,
            pinSwitchInput = "07:07:07:07:07:07:07:07:07:07:07:07")
        vm.decideQrAccount(true)
        assertTrue("angemeldet", t.sitzung.state.value.isLoggedIn)
        assertEquals("Nach Bestätigung und Anmeldung gilt der neue", fp, ablage.pins["brick.example.org:443"])
    }

    @Test
    fun `an own key from the QR code applies on the first setup only when typed`() {
        paths.antworten["/api/v1/auth/qr-login"] = """{"success":true,"wartet":true,"abholung":"h","code":"123456","expires_in":300}"""
        paths.antworten["/api/v1/auth/qr-login/abholen"] = """{"success":true,"wartet":false,"token":"abc","user":{"id":1,"username":"marco"}}"""
        val vm = vm(roots = setOf(fpAlt))
        assertTrue("Eigene Wurzel: abtippen", vm.mussAbtippen("https://brick.example.org/", fp))
        assertFalse("System-Wurzel: ihre Kette muss ohnehin öffentlich gelten", vm.mussAbtippen("https://brick.example.org/", fpAlt))
        assertFalse("Ohne Fingerabdruck nichts abzutippen", vm.mussAbtippen("https://brick.example.org/", null))

        vm.loginWithQrToken("https://brick.example.org/", "bim:x", fingerabdruck = fp)
        assertEquals("t${R.string.setup_qr_pin_abtippen_abgelehnt}", vm.anmeldeState.value.anmeldung.errorMessage.text)
        assertTrue("Ein Tipp genügt nicht: ${ablage.protokoll}", ablage.protokoll.isEmpty())
        assertTrue(paths.requestsAn("qr-login").isEmpty())

        vm.loginWithQrToken("https://brick.example.org/", "bim:x", fingerabdruck = fp,
            pinSwitchInput = "09:09:09:09:09:09:09:09:09:09:09:09")
        assertTrue("Falsch abgeschrieben: nichts", paths.requestsAn("qr-login").isEmpty())

        vm.loginWithQrToken("https://brick.example.org/", "bim:x", fingerabdruck = fp,
            pinSwitchInput = "07:07:07:07:07:07:07:07:07:07:07:07")
        vm.decideQrAccount(true)
        assertTrue("angemeldet", t.sitzung.state.value.isLoggedIn)
        assertEquals(fp, ablage.pins["brick.example.org:443"])
        assertFalse("Der bestätigte Pin gilt beim nächsten Code ohne Abtippen", vm.mussAbtippen("https://brick.example.org/", fp))
    }

    @Test
    fun `a token without expiry only via https`() {
        paths.antworten["/api/v1/auth/login"] = """{"success":true,"token":"abc","user":{"id":1,"username":"marco"}}"""
        ablage.url = "http://localhost:3000"
        vm().login("marco", "geheim")
        assertTrue("http-Anmeldung", paths.requestsAn("/auth/login").size == 1)
        assertTrue(paths.koerper.last(), paths.koerper.last().contains("\"never_expires\":false"))

        ablage.url = "https://brick.example.org"
        vm().login("marco", "geheim")
        assertTrue("https-Anmeldung", paths.requestsAn("/auth/login").size == 2)
        assertTrue(paths.koerper.last(), paths.koerper.last().contains("\"never_expires\":true"))
    }

    @Test
    fun `after sign-out the form is empty`() {
        paths.antworten["/api/v1/auth/login"] = """{"success":false,"error":"Falsches Passwort"}"""
        val vm = vm()
        vm.login("marco", "falsch")
        assertTrue("Fehler", vm.anmeldeState.value.anmeldung.errorMessage != null)
        t.sitzung.abgemeldet()
        assertNull(vm.anmeldeState.value.anmeldung.errorMessage)
    }

    @Test
    fun `an http address is not saved, one without a scheme as https`() {
        t.sitzung.angemeldet(admin = false)
        val vm = vm()
        assertFalse(vm.saveServerUrl("http://nas:3000"))
        assertTrue(vm.saveServerUrl("brick.example.org"))
        assertTrue("abgelegt", ablage.protokoll.any { it.startsWith("url:") })
        assertEquals("Die abgelehnte Adresse meldet nicht ab und landet nirgends",
            listOf("abmelden", "url:https://brick.example.org"), ablage.protokoll.toList())
    }

    @Test
    fun `a QR code with an http address is not taken over and says why`() {
        paths.antworten["/api/v1/auth/qr-login"] = """{"success":true,"wartet":true,"abholung":"h","code":"123456","expires_in":300}"""
        paths.antworten["/api/v1/auth/qr-login/abholen"] = """{"success":true,"wartet":false,"token":"abc","user":{"id":1,"username":"marco"}}"""
        val vm = vm()
        vm.loginWithQrToken("http://nas:3000", "bim:x")
        assertEquals("t${R.string.setup_qr_klartext_abgelehnt}", vm.anmeldeState.value.anmeldung.errorMessage.text)
        assertTrue("Nichts gespeichert: ${ablage.protokoll}", ablage.protokoll.isEmpty())
        assertTrue("Der Code ging nicht hinaus", paths.requestsAn("qr-login").isEmpty())
        assertFalse(t.sitzung.state.value.isLoggedIn)
    }

    @Test
    fun `a different server signs out before the new address`() {
        t.sitzung.angemeldet(admin = false)
        val vm = vm()
        vm.saveServerUrl("https://anderer.example:8443")
        assertTrue("abgelegt", ablage.protokoll.any { it.startsWith("url:") })
        assertEquals(listOf("abmelden", "url:https://anderer.example:8443"), ablage.protokoll.take(2))
    }

    @Test
    fun `the same server with a slash does not sign out`() {
        t.sitzung.angemeldet(admin = false)
        val vm = vm()
        vm.saveServerUrl("https://SERVER/")
        assertTrue("abgelegt", ablage.protokoll.any { it.startsWith("url:") })
        assertFalse(ablage.protokoll.contains("abmelden"))
    }

    /**
     * Previously the scan signed out of the previous server right away; a rejected or
     * expired code then left no sign-in at all. Now the app pairs
     * alongside and leaves the previous server only after the yes to the account.
     */
    @Test
    fun `a QR code for a different server signs out only after the yes to the account`() {
        paths.antworten["/api/v1/auth/qr-login"] = """{"success":true,"wartet":true,"abholung":"h","code":"123456","expires_in":300}"""
        paths.antworten["/api/v1/auth/qr-login/abholen"] = """{"success":true,"wartet":false,"token":"neu","user":{"id":2,"username":"anna"}}"""
        t.sitzung.angemeldet(admin = false)
        val vm = vm()
        vm.loginWithQrToken("https://neu.example", "einmalig")
        assertEquals("https://neu.example", vm.anmeldeState.value.qrAccount?.server)
        assertEquals("Vor dem Ja nur das Kopplungsziel", listOf("ziel:https://neu.example"), ablage.protokoll.toList())
        assertTrue(t.sitzung.state.value.isLoggedIn)

        vm.decideQrAccount(true)
        val p = ablage.protokoll.toList()
        assertEquals("Erst die Kopplung beenden, dann abmelden, dann die neue Adresse: $p",
            listOf("ziel:https://neu.example", "ziel:null", "abmelden", "url:https://neu.example"), p.take(4))
        assertTrue("Die Adresse vor dem neuen Token: $p", p.indexOf("url:https://neu.example") < p.indexOf("token:neu"))
    }

    @Test
    fun `a no to the account of another server leaves the previous sign-in`() {
        paths.antworten["/api/v1/auth/qr-login"] = """{"success":true,"wartet":true,"abholung":"h","code":"123456","expires_in":300}"""
        paths.antworten["/api/v1/auth/qr-login/abholen"] = previewResponse
        paths.antworten["/api/v1/auth/qr-login/verwerfen"] = """{"success":true}"""
        t.sitzung.angemeldet(admin = false)
        val vm = vm()
        vm.loginWithQrToken("https://neu.example", "einmalig")
        vm.decideQrAccount(false)
        assertEquals("Nicht abgemeldet, keine neue Adresse, kein Token",
            listOf("ziel:https://neu.example", "ziel:null"), ablage.protokoll.toList())
        assertEquals("https://server", ablage.url)
        assertTrue(t.sitzung.state.value.isLoggedIn)
        assertFalse(vm.anmeldeState.value.anmeldung.laeuft)
    }

    @Test
    fun `if pairing with another server fails, the error is shown and the sign-in stays`() {
        paths.antworten["/api/v1/auth/qr-login"] = """{"success":false,"error":"Code abgelaufen","code":"qr_abgelaufen"}"""
        paths.codes["/api/v1/auth/qr-login"] = 410
        t.sitzung.angemeldet(admin = false)
        val vm = vm()
        vm.loginWithQrToken("https://neu.example", "einmalig")
        assertEquals("Fehler des Servers", "Code abgelaufen", vm.anmeldeState.value.anmeldung.errorMessage.text)
        assertEquals(listOf("ziel:https://neu.example", "ziel:null"), ablage.protokoll.toList())
        assertTrue(t.sitzung.state.value.isLoggedIn)
    }

    private val previewResponse = """{"success":true,"wartet":false,"vorschau":true,"username":"marco"}"""

    @Test
    fun `a QR sign-in shows account and server and takes over the token only after the yes`() {
        paths.antworten["/api/v1/auth/qr-login"] = """{"success":true,"wartet":true,"abholung":"h","code":"123456","expires_in":300}"""
        paths.antworten["/api/v1/auth/qr-login/abholen"] = previewResponse
        val vm = vm()
        vm.loginWithQrToken("https://brick.example.org/", "bim:x")
        assertEquals(QrAccount("marco", "https://brick.example.org"), vm.anmeldeState.value.qrAccount)
        assertTrue("Vor dem Ja kein Token: ${ablage.protokoll}", ablage.protokoll.none { it.startsWith("token:") })
        assertFalse(t.sitzung.state.value.isLoggedIn)
        assertTrue(paths.koerper.last(), "\"vorschau\":true" in paths.koerper.last())

        paths.antworten["/api/v1/auth/qr-login/abholen"] =
            """{"success":true,"wartet":false,"token":"abc","username":"marco","user":{"id":1,"username":"marco"}}"""
        vm.decideQrAccount(true)
        assertTrue(paths.koerper.last(), "\"vorschau\":false" in paths.koerper.last())
        assertTrue("angemeldet", t.sitzung.state.value.isLoggedIn)
        assertTrue(ablage.protokoll.toString(), ablage.protokoll.containsAll(listOf("token:abc", "name:marco")))
        assertNull(vm.anmeldeState.value.qrAccount)
        assertFalse(vm.anmeldeState.value.anmeldung.laeuft)
    }

    @Test
    fun `a no to the shown account discards the pairing and leaves nothing behind`() {
        paths.antworten["/api/v1/auth/qr-login"] = """{"success":true,"wartet":true,"abholung":"h","code":"123456","expires_in":300}"""
        paths.antworten["/api/v1/auth/qr-login/abholen"] = previewResponse
        paths.antworten["/api/v1/auth/qr-login/verwerfen"] = """{"success":true}"""
        val vm = vm(roots = setOf(fp))
        vm.loginWithQrToken("https://brick.example.org/", "bim:x", fingerabdruck = fp)
        assertEquals("marco", vm.anmeldeState.value.qrAccount?.benutzer)
        vm.decideQrAccount(false)
        assertEquals(1, paths.requestsAn("qr-login/verwerfen").size)
        assertEquals("""{"abholung":"h"}""", paths.koerper.last())
        assertEquals("Nur die Vorschau wurde abgeholt", 1, paths.requestsAn("qr-login/abholen").size)
        assertTrue("Kein Token, kein Pin: ${ablage.protokoll}",
            ablage.protokoll.none { it.startsWith("token:") || it.startsWith("pin:") })
        assertEquals("vergiss:brick.example.org:443", ablage.protokoll.last())
        assertFalse(t.sitzung.state.value.isLoggedIn)
        assertNull(vm.anmeldeState.value.qrAccount)
        assertFalse(vm.anmeldeState.value.anmeldung.laeuft)
    }

    /** Records which options arrived, and answers with [ergebnis]. */
    private class FakePasskey(val ergebnis: PasskeyResult) : PasskeyQuery {
        val optionen = mutableListOf<String>()
        override suspend fun fetch(optionsJson: String): PasskeyResult { optionen += optionsJson; return ergebnis }
    }

    private val passkeyResponse = PasskeyResult.Antwort("""{"id":"pk1","response":{"clientDataJSON":"cd"}}""")
    private val optionsBody = """{"success":true,"optionen":{"challenge":"ch-123","rpId":"brick.example.org"}}"""

    @Test
    fun `signing in with a passkey stores the token like the password`() {
        paths.antworten["/api/v1/auth/passkey/anmelden/optionen"] = optionsBody
        paths.antworten["/api/v1/auth/passkey/anmelden"] = """{"success":true,"token":"pk-token","user":{"id":1,"username":"marco","is_admin":true},
            "token_info":{"scope":"voll","never_expires":true}}"""
        ablage.url = "https://brick.example.org"
        val fake = FakePasskey(passkeyResponse)
        val vm = vm()
        vm.setFullAccess(true)
        vm.signInPasskey(fake)
        assertTrue("angemeldet", t.sitzung.state.value.isLoggedIn)
        assertEquals(listOf("filter-leer", "token:pk-token", "name:marco"), ablage.protokoll)
        assertTrue(fake.optionen.single(), "\"challenge\":\"ch-123\"" in fake.optionen.single())
        val rumpf = paths.koerper[paths.requests.indexOf("POST /api/v1/auth/passkey/anmelden")]
        assertTrue(rumpf, "\"mit_token\":true" in rumpf && "\"id\":\"pk1\"" in rumpf && "\"scope\":\"voll\"" in rumpf)
        assertTrue(rumpf, "\"never_expires\":true" in rumpf)
        assertTrue(paths.koerper.first(), "\"zweck\":\"anmelden\"" in paths.koerper.first())
        assertTrue(t.sitzung.state.value.isAdmin)
    }

    @Test
    fun `an aborted passkey dialog sends nothing and reports no error`() {
        paths.antworten["/api/v1/auth/passkey/anmelden/optionen"] = optionsBody
        ablage.url = "https://brick.example.org"
        val vm = vm()
        vm.signInPasskey(FakePasskey(PasskeyResult.Abgebrochen))
        assertTrue("Optionen geholt", paths.requestsAn("optionen").isNotEmpty() && !vm.anmeldeState.value.anmeldung.laeuft)
        assertNull(vm.anmeldeState.value.anmeldung.errorMessage)
        assertTrue(paths.requests.toString(), paths.requests.none { it == "POST /api/v1/auth/passkey/anmelden" })
        assertFalse(t.sitzung.state.value.isLoggedIn)
    }

    @Test
    fun `without a passkey on the device or without a domain the sign-in says why`() {
        paths.antworten["/api/v1/auth/passkey/anmelden/optionen"] = optionsBody
        ablage.url = "https://brick.example.org"
        val vm = vm()
        vm.signInPasskey(FakePasskey(PasskeyResult.NoPasskey))
        assertTrue("Satz", vm.anmeldeState.value.anmeldung.errorMessage != null)
        assertEquals("t${R.string.login_passkey_keiner}", vm.anmeldeState.value.anmeldung.errorMessage.text)

        paths.antworten["/api/v1/auth/passkey/anmelden/optionen"] = """{"success":false,"error":"Passkeys brauchen eine Domain"}"""
        paths.codes["/api/v1/auth/passkey/anmelden/optionen"] = 503
        val fake = FakePasskey(passkeyResponse)
        vm.signInPasskey(fake)
        // The server's sentence, from the error layer as with the password.
        assertTrue("Fehler des Servers", vm.anmeldeState.value.anmeldung.errorMessage.text == "Passkeys brauchen eine Domain")
        assertTrue("Ohne Optionen wird der Credential Manager nicht gefragt", fake.optionen.isEmpty())
    }

    @Test
    fun `the second factor takes the passkey if the server offers it, with name and password`() {
        paths.antworten["/api/v1/auth/login"] = """{"success":false,"zweiter_faktor":true,"passkey":true,"error":"Code fehlt"}"""
        paths.codes["/api/v1/auth/login"] = 401
        paths.antworten["/api/v1/auth/passkey/anmelden/optionen"] = optionsBody
        ablage.url = "https://brick.example.org"
        val vm = vm()
        vm.login("marco", "geheim")
        assertTrue("Codefeld", vm.anmeldeState.value.codeNoetig)
        assertTrue("Der Server bietet den Passkey an", vm.anmeldeState.value.passkeyStattCode)

        paths.codes.remove("/api/v1/auth/login")
        paths.antworten["/api/v1/auth/login"] = """{"success":true,"token":"abc","user":{"id":1,"username":"marco"}}"""
        vm.passkeyStattCode("marco", "geheim", FakePasskey(passkeyResponse))
        assertTrue("angemeldet", t.sitzung.state.value.isLoggedIn)
        val optionen = paths.koerper[paths.requests.indexOf("POST /api/v1/auth/passkey/anmelden/optionen")]
        assertTrue(optionen, "\"zweck\":\"zweiter_faktor\"" in optionen)
        val rumpf = paths.koerper[paths.requests.lastIndexOf("POST /api/v1/auth/login")]
        assertTrue(rumpf, "\"passkey\":{\"id\":\"pk1\"" in rumpf && "\"password\":\"geheim\"" in rumpf && "\"code\"" !in rumpf)
        assertFalse(vm.anmeldeState.value.passkeyStattCode)
    }

    /** Options with [rpId] (null: without the field) for the address https://brick.example.org. */
    private fun foreignOptions(rpId: String?): FakePasskey {
        val feld = rpId?.let { ",\"rpId\":\"$it\"" } ?: ""
        paths.antworten["/api/v1/auth/passkey/anmelden/optionen"] = """{"success":true,"optionen":{"challenge":"ch-1"$feld}}"""
        ablage.url = "https://brick.example.org"
        return FakePasskey(passkeyResponse)
    }

    @Test
    fun `options for a foreign domain never go to the Credential Manager`() {
        for (fremd in listOf("opfer.example", "example.org", "evil.brick.example.org", "BRICK.EXAMPLE.ORG")) {
            val fake = foreignOptions(fremd)
            val vm = vm()
            vm.signInPasskey(fake)
            assertTrue("abgelehnt $fremd", vm.anmeldeState.value.anmeldung.errorMessage != null)
            assertEquals(fremd, R.string.login_passkey_rpid_fremd, (vm.anmeldeState.value.anmeldung.errorMessage as Meldung.Resource).id)
            assertTrue("$fremd erreichte den Credential Manager", fake.optionen.isEmpty())
            assertFalse(vm.anmeldeState.value.anmeldung.laeuft)
        }
        assertTrue(paths.requests.toString(), paths.requests.none { it == "POST /api/v1/auth/passkey/anmelden" })
        assertFalse(t.sitzung.state.value.isLoggedIn)
    }

    @Test
    fun `options without rpId never go to the Credential Manager, not even for the second factor`() {
        val fake = foreignOptions(null)
        val vm = vm()
        vm.signInPasskey(fake)
        assertTrue("abgelehnt", vm.anmeldeState.value.anmeldung.errorMessage != null)
        assertEquals("t${R.string.login_passkey_rpid_fehlt}", vm.anmeldeState.value.anmeldung.errorMessage.text)

        val zweiter = foreignOptions("opfer.example")
        vm.passkeyStattCode("marco", "geheim", zweiter)
        assertTrue("abgelehnt", (vm.anmeldeState.value.anmeldung.errorMessage as? Meldung.Resource)?.id == R.string.login_passkey_rpid_fremd)
        assertTrue(fake.optionen.isEmpty() && zweiter.optionen.isEmpty())
        assertTrue(paths.requests.toString(), paths.requests.none { it.startsWith("POST /api/v1/auth/login") })
    }

    @Test
    fun `if the address changes during the passkey dialog, the response goes nowhere`() {
        foreignOptions("brick.example.org")
        val switch = PasskeyQuery { ablage.url = "https://anders.example"; passkeyResponse }
        val vm = vm()
        vm.signInPasskey(switch)
        assertTrue("abgelehnt", vm.anmeldeState.value.anmeldung.errorMessage != null)
        assertEquals("t${R.string.login_passkey_fehler}", vm.anmeldeState.value.anmeldung.errorMessage.text)
        assertTrue(paths.requests.toString(), paths.requests.none { it == "POST /api/v1/auth/passkey/anmelden" })
    }
}
