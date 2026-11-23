package ch.brickinventoryapp.login

import ch.brickinventoryapp.data.LoginStore
import ch.brickinventoryapp.data.testing.PathServer
import ch.brickinventoryapp.data.testing.testAccountRepository
import ch.brickinventoryapp.data.testing.testHouseholdRepository
import ch.brickinventoryapp.data.testing.testPartsRepository
import ch.brickinventoryapp.data.testing.text
import ch.brickinventoryapp.login.ui.PasskeyQuery
import ch.brickinventoryapp.login.ui.PasskeyResult
import ch.brickinventoryapp.login.ui.QrAccount
import ch.brickinventoryapp.login.ui.viewmodel.LoginViewModel
import ch.brickinventoryapp.model.ui.Message
import ch.brickinventoryapp.model.ui.errorMessage
import ch.brickinventoryapp.model.ui.running
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.security.CertificateQuestion
import ch.brickinventoryapp.security.CertificateUnresolved
import ch.brickinventoryapp.security.PinStore
import ch.brickinventoryapp.session.testing.SessionFake
import ch.brickinventoryapp.state.testing.StorageStore
import ch.brickinventoryapp.state.testing.TestServices
import ch.brickinventoryapp.state.ui.FilterStore
import ch.brickinventoryapp.state.ui.ScopeService
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
import java.util.Base64
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap

/**
 * The sign-in ViewModel, run against a PathServer without network and a store in
 * memory.
 *
 * Counter-checks (measured 28.10.2026, kotlinc against LoginViewModel.kt):
 *   A  in loggedIn() loginBegins() AFTER the token → red “a sign-in
 *      clears the filters, stores the token …” (the order is recorded)
 *   B  on the second factor the error shown even without a code → red “the
 *      first time, the second factor only asks for the code”
 *   C  in qrFailed() the sentence always set → red “a second QR attempt
 *      after a successful sign-in reports no error”
 *   D  zuruecksetzen() empty → red “after sign-out the form is empty”
 *   E  in setUpOne() the call sessionService.logout() removed → red “a different server
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
 *   P  the check previousPin() before the start removed → red “a QR code
 *      with a different key never silently replaces the pin”
 *   R  the check bestaetigtFingerabdruck() in loginWithQrToken()
 *      replaced with `pinSwitchInput == null` (any input is enough) → red
 *      “a QR code with a different key never silently replaces the pin” (wrongly
 *      typed-off value accepted)
 *   Q  the finally with forgetRetained() removed → red “a failed
 *      QR code leaves no pin behind” (timeout, nothing forgotten)
 *   J  LoginRequest back to a fixed neverExpires = true → red
 *      “a token without expiry only via https” (http part)
 *   K  PasskeyAnmeldung with withToken = false → red “signing in with a
 *      passkey stores the token …”
 *   L  cancelled treated as NoPasskey with a sentence → red “a
 *      cancelled passkey dialog …”
 *   M  SecondFactorRoutes not read in AccountRepository → red
 *      “the second factor accepts the passkey …” (button missing)
 *   N  passkeyInsteadOfCode() does not pass the passkey to login() →
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
 *   X  mustTypeIn() without a pin back to `false` (the state before: a tap
 *      was enough on first setup) → red “a private key from the
 *      QR code only counts, on first setup, once typed off”;
 *      counter-checks/qr-pin-without-typing.patch
 *   Y  in pairQr() the question about the account skipped (always yes) →
 *      red “a QR sign-in shows the account and server …”; counter-checks/qr-without-account-question.patch
 *   Z  on a no, discardQr() not called → red “a no to the shown
 *      account …”; counter-checks/qr-no-without-discard.patch
 * Counter-checks for the server switch via QR (added 12.11.2026; measurable only in CI without Gradle):
 *   AC loginWithQrToken() back to calling setUpOne() before the fetch (sign out right away) → red
 *      “a no to a different server's account …” and “… only after the yes …”;
 *      counter-checks/qr-switch-logs-out-immediately.patch
 *   AD in qrFailed() without `!pairingWithSwitch` → red “if the pairing fails with
 *      a different server …” (error swallowed); counter-checks/qr-switch-error-swallowed.patch
 *   AE in leavePreviousServer() without `pairingTarget(null)` → red “… only after the yes …”
 *      (signed out while requests were still going to the new server);
 *      counter-checks/qr-switch-logout-on-new.patch
 */
@OptIn(ExperimentalCoroutinesApi::class)
class LoginViewModelTest {

    /** Records what is stored in which order. */
    private class Store(var url: String = "https://server") : LoginStore {
        val log = Collections.synchronizedList(mutableListOf<String>())
        override suspend fun serverUrlNow() = url
        override suspend fun saveServerUrl(url: String) { this.url = url; log += "url:$url" }
        override suspend fun saveAuthToken(token: String) { log += "token:$token" }
        override suspend fun saveUsername(name: String) { log += "name:$name" }
        val pins = ConcurrentHashMap<String, String>()
        override fun rememberPin(key: String, fingerprint: String) {
            pins[key] = fingerprint; log += "pin:$key=$fingerprint"
        }
        override fun rememberedPin(key: String): String? = pins[key]
        override fun holdBefore(key: String, fingerprint: String) { log += "vor:$key=$fingerprint" }
        override fun forgetRetained(key: String) { log += "vergiss:$key" }
        override fun pairingTarget(url: String?) { log += "ziel:$url" }
    }

    private lateinit var paths: PathServer
    private lateinit var t: TestServices
    private lateinit var store: Store
    private lateinit var question: CertificateQuestion

    /** The filter store reports its clearing into the same log; [roots] plays the system roots. */
    private fun vm(roots: Set<String> = emptySet()): LoginViewModel {
        val viewStore = object : FilterStore by StorageStore() {
            override suspend fun forgetAll() { store.log += "filter-leer" }
        }
        val viewport = ScopeService(viewStore,
            testHouseholdRepository(t.api),
            testPartsRepository(t.api))
        val logout = SessionFake { store.log += "abmelden" }
        return t.track(LoginViewModel(t.session, viewport, t.hints, logout,
            testAccountRepository(t.api), store, question) { it in roots })
    }

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        paths = PathServer()
        t = TestServices(paths.onTick(), io = Dispatchers.Main)
        store = Store()
        question = CertificateQuestion()
    }

    @After
    fun tearDown() {
        t.cleanUp()
        Dispatchers.resetMain()
        paths.server.shutdown()
    }

    @Test
    fun `a sign-in empties the filters, stores the token and reports the session`() {
        paths.responses["/api/v2/auth/login"] = """{"success":true,"token":"abc","user":{"id":1,"username":"marco","is_admin":true},
            "token_info":{"scope":"voll","never_expires":false}}"""
        val vm = vm()
        vm.setFullAccess(true)
        vm.login("marco", "geheim")
        assertTrue("signed in", t.session.state.value.isLoggedIn)
        assertEquals(listOf("filter-leer", "token:abc", "name:marco"), store.log)
        assertTrue(paths.bodyBytes.single(), "\"scope\":\"voll\"" in paths.bodyBytes.single())
        assertTrue(t.session.state.value.isAdmin)
        assertFalse(vm.loginState.value.login.running)
    }

    /**
     * Without the checkbox, a token with scope "app": the account right alone does not make
     * an admin in the app, the server would reject its calls with 403.
     * Counter-check: in LoginViewModel `r.data.admin`
     * → `r.data.user?.isAdmin == true` → red “admin account without the checkbox …”.
     */
    @Test
    fun `admin account without the check mark signs in without admin rights`() {
        paths.responses["/api/v2/auth/login"] = """{"success":true,"token":"abc","user":{"id":1,"username":"marco","is_admin":true},
            "token_info":{"scope":"app","never_expires":false}}"""
        val vm = vm()
        vm.login("marco", "geheim")
        assertTrue("signed in", t.session.state.value.isLoggedIn)
        assertTrue(paths.bodyBytes.single(), "\"scope\":\"app\"" in paths.bodyBytes.single())
        assertFalse(t.session.state.value.isAdmin)
    }

    @Test
    fun `the first time the second factor asks only for the code`() {
        paths.responses["/api/v2/auth/login"] = """{"success":false,"second_factor":true,"error":"Code fehlt"}"""
        paths.codes["/api/v2/auth/login"] = 401
        val vm = vm()
        vm.login("marco", "geheim")
        assertTrue("Codefeld", vm.loginState.value.codeNeeded)
        assertNull("Without an entered code this is no error", vm.loginState.value.login.errorMessage)
        assertFalse("No passkey button without `passkey: true`", vm.loginState.value.passkeyInsteadOfCode)

        vm.login("marco", "geheim", code = "123456")
        assertTrue("Sentence of the server", vm.loginState.value.login.errorMessage != null)
        assertEquals("Code fehlt", vm.loginState.value.login.errorMessage.text)
        assertTrue(store.log.none { it.startsWith("token:") })
    }

    @Test
    fun `a second QR attempt after a successful sign-in reports no error`() {
        paths.responses["/api/v2/auth/qr-login"] = """{"success":false,"error":"Ungültiges oder abgelaufenes Token"}"""
        t.session.loggedIn(admin = false)
        val vm = vm()
        vm.loginWithQrToken("https://server/", "einmalig")
        assertTrue("Response", paths.requestsTo("qr-login").isNotEmpty() && !vm.loginState.value.login.running)
        assertNull(vm.loginState.value.login.errorMessage)
        assertEquals("The same server: no sign-out", "url:https://server", store.log.first())
    }

    private val fp = Base64.getEncoder().encodeToString(ByteArray(32) { 7 })
    private val fpOld = Base64.getEncoder().encodeToString(ByteArray(32) { 9 })

    @Test
    fun `a QR code with fingerprint holds the pin for the first request and remembers it only afterwards`() {
        paths.responses["/api/v2/auth/qr-login"] = """{"success":true,"waiting":true,"pickup":"h","code":"123456","expires_in":300}"""
        paths.responses["/api/v2/auth/qr-login/collect"] = """{"success":true,"waiting":false,"token":"abc","user":{"id":1,"username":"marco"}}"""
        val vm = vm(roots = setOf(fp))
        vm.loginWithQrToken("https://brick.example.org/", "bim:x", fingerprint = fp)
        vm.decideQrAccount(true)
        assertTrue("signed in", t.session.state.value.isLoggedIn && store.log.any { it.startsWith("vergiss:") })
        val p = store.log.toList()
        assertEquals("vor:brick.example.org:443=$fp", p.first())
        assertTrue("Remembered after the address, before the token: $p",
            p.indexOf("url:https://brick.example.org") < p.indexOf("pin:brick.example.org:443=$fp") &&
                p.indexOf("pin:brick.example.org:443=$fp") < p.indexOf("token:abc"))
        assertEquals(fp, store.pins["brick.example.org:443"])
    }

    /** The first qr-login's handshake asks for the certificate and aborts (503 instead of TLS). */
    private fun firstContactOnFirstQrLogin() {
        paths.responses["/api/v2/auth/qr-login"] = """{"success":true,"waiting":true,"pickup":"h","code":"123456","expires_in":300}"""
        paths.responses["/api/v2/auth/qr-login/collect"] = """{"success":true,"waiting":false,"token":"abc","user":{"id":1,"username":"marco"}}"""
        var first = true
        paths.priority = { _, path ->
            if (first && path == "/api/v2/auth/qr-login") {
                first = false
                question.report(CertificateUnresolved("brick.example.org:443", fp, CertificateUnresolved.Kind.FIRST_CONTACT, ctForced = true))
                503 to """{"success":false}"""
            } else null
        }
    }

    private val pinsTheStore = object : PinStore {
        override fun pin(key: String) = store.rememberedPin(key)
        override fun rememberPin(key: String, fingerprint: String) = store.rememberPin(key, fingerprint)
    }

    @Test
    fun `after the yes to the first contact the QR code signs in without a new scan`() {
        firstContactOnFirstQrLogin()
        val vm = vm()
        vm.loginWithQrToken("https://brick.example.org/", "bim:x")
        assertTrue("Waits for the dialog instead of „Keine Verbindung“", vm.loginState.value.login.running)
        assertNull(vm.loginState.value.login.errorMessage)

        assertTrue(question.confirm(pinsTheStore))
        assertEquals("Second attempt", 2, paths.requests.count { it == "POST /api/v2/auth/qr-login" })
        vm.decideQrAccount(true)
        assertTrue("signed in: ${store.log}", t.session.state.value.isLoggedIn)
        assertNull(vm.loginState.value.login.errorMessage)
    }

    @Test
    fun `after the no to the first contact it stays at one attempt`() {
        firstContactOnFirstQrLogin()
        val vm = vm()
        vm.loginWithQrToken("https://brick.example.org/", "bim:x")
        question.discard()
        assertEquals(1, paths.requests.count { it == "POST /api/v2/auth/qr-login" })
        assertFalse(vm.loginState.value.login.running)
        assertNotNull(vm.loginState.value.login.errorMessage)
        assertFalse(t.session.state.value.isLoggedIn)
    }

    @Test
    fun `a failed QR code leaves no pin`() {
        paths.responses["/api/v2/auth/qr-login"] = """{"success":false,"error":"Ungültiges oder abgelaufenes Token"}"""
        val vm = vm(roots = setOf(fp))
        vm.loginWithQrToken("https://brick.example.org/", "bim:x", fingerprint = fp)
        assertTrue("Response", store.log.any { it.startsWith("vergiss:") })
        assertTrue(paths.requestsTo("qr-login").isNotEmpty())
        assertTrue("Nothing permanent: ${store.log}", store.pins.isEmpty())
        assertEquals("vergiss:brick.example.org:443", store.log.last())
        assertFalse(t.session.state.value.isLoggedIn)
    }

    @Test
    fun `a QR code with a different key never silently replaces the pin`() {
        paths.responses["/api/v2/auth/qr-login"] = """{"success":true,"waiting":true,"pickup":"h","code":"123456","expires_in":300}"""
        paths.responses["/api/v2/auth/qr-login/collect"] = """{"success":true,"waiting":false,"token":"abc","user":{"id":1,"username":"marco"}}"""
        store.pins["brick.example.org:443"] = fpOld
        val vm = vm()
        assertEquals("The screen gets the previous one", fpOld, vm.previousPin("brick.example.org", fp))
        assertNull("The same one is no switch", vm.previousPin("https://brick.example.org/", fpOld))

        vm.loginWithQrToken("https://brick.example.org/", "bim:x", fingerprint = fp)
        assertEquals("t${R.string.setup_qr_pin_switch_declined}", vm.loginState.value.login.errorMessage.text)
        assertTrue("Nothing without confirmation: ${store.log}", store.log.isEmpty())
        assertTrue(paths.requestsTo("qr-login").isEmpty())
        assertEquals(fpOld, store.pins["brick.example.org:443"])

        // A tap with a wrongly typed-off value is just as insufficient.
        vm.loginWithQrToken("https://brick.example.org/", "bim:x", fingerprint = fp,
            pinSwitchInput = "09:09:09:09:09:09:09:09:09:09:09:09")
        assertEquals("t${R.string.setup_qr_pin_switch_declined}", vm.loginState.value.login.errorMessage.text)
        assertTrue("Copied wrongly: nothing", paths.requestsTo("qr-login").isEmpty())

        // 16 characters (64 bits) are no longer enough.
        vm.loginWithQrToken("https://brick.example.org/", "bim:x", fingerprint = fp,
            pinSwitchInput = "07:07:07:07:07:07:07:07")
        assertEquals("t${R.string.setup_qr_pin_switch_declined}", vm.loginState.value.login.errorMessage.text)

        // The last 24 hex characters of the new fingerprint, as typed off from the web app.
        vm.loginWithQrToken("https://brick.example.org/", "bim:x", fingerprint = fp,
            pinSwitchInput = "07:07:07:07:07:07:07:07:07:07:07:07")
        vm.decideQrAccount(true)
        assertTrue("signed in", t.session.state.value.isLoggedIn)
        assertEquals("After confirmation and sign-in the new one applies", fp, store.pins["brick.example.org:443"])
    }

    @Test
    fun `an own key from the QR code applies on the first setup only when typed`() {
        paths.responses["/api/v2/auth/qr-login"] = """{"success":true,"waiting":true,"pickup":"h","code":"123456","expires_in":300}"""
        paths.responses["/api/v2/auth/qr-login/collect"] = """{"success":true,"waiting":false,"token":"abc","user":{"id":1,"username":"marco"}}"""
        val vm = vm(roots = setOf(fpOld))
        assertTrue("Own root: type off", vm.mustTypeIn("https://brick.example.org/", fp))
        assertFalse("System root: its chain must be publicly valid anyway", vm.mustTypeIn("https://brick.example.org/", fpOld))
        assertFalse("Without a fingerprint nothing to type off", vm.mustTypeIn("https://brick.example.org/", null))

        vm.loginWithQrToken("https://brick.example.org/", "bim:x", fingerprint = fp)
        assertEquals("t${R.string.setup_qr_pin_type_declined}", vm.loginState.value.login.errorMessage.text)
        assertTrue("A tap is not enough: ${store.log}", store.log.isEmpty())
        assertTrue(paths.requestsTo("qr-login").isEmpty())

        vm.loginWithQrToken("https://brick.example.org/", "bim:x", fingerprint = fp,
            pinSwitchInput = "09:09:09:09:09:09:09:09:09:09:09:09")
        assertTrue("Copied wrongly: nothing", paths.requestsTo("qr-login").isEmpty())

        vm.loginWithQrToken("https://brick.example.org/", "bim:x", fingerprint = fp,
            pinSwitchInput = "07:07:07:07:07:07:07:07:07:07:07:07")
        vm.decideQrAccount(true)
        assertTrue("signed in", t.session.state.value.isLoggedIn)
        assertEquals(fp, store.pins["brick.example.org:443"])
        assertFalse("The confirmed pin applies to the next code without typing off", vm.mustTypeIn("https://brick.example.org/", fp))
    }

    @Test
    fun `a token without expiry only via https`() {
        paths.responses["/api/v2/auth/login"] = """{"success":true,"token":"abc","user":{"id":1,"username":"marco"}}"""
        store.url = "http://localhost:3000"
        vm().login("marco", "geheim")
        assertTrue("http sign-in", paths.requestsTo("/auth/login").size == 1)
        assertTrue(paths.bodyBytes.last(), paths.bodyBytes.last().contains("\"never_expires\":false"))

        store.url = "https://brick.example.org"
        vm().login("marco", "geheim")
        assertTrue("https sign-in", paths.requestsTo("/auth/login").size == 2)
        assertTrue(paths.bodyBytes.last(), paths.bodyBytes.last().contains("\"never_expires\":true"))
    }

    @Test
    fun `after sign-out the form is empty`() {
        paths.responses["/api/v2/auth/login"] = """{"success":false,"error":"Falsches Passwort"}"""
        val vm = vm()
        vm.login("marco", "falsch")
        assertTrue("Error", vm.loginState.value.login.errorMessage != null)
        t.session.loggedOut()
        assertNull(vm.loginState.value.login.errorMessage)
    }

    @Test
    fun `an http address is not saved, one without a scheme as https`() {
        t.session.loggedIn(admin = false)
        val vm = vm()
        assertFalse(vm.saveServerUrl("http://nas:3000"))
        assertTrue(vm.saveServerUrl("brick.example.org"))
        assertTrue("stored", store.log.any { it.startsWith("url:") })
        assertEquals("The rejected address does not sign out and lands nowhere",
            listOf("abmelden", "url:https://brick.example.org"), store.log.toList())
    }

    @Test
    fun `a QR code with an http address is not taken over and says why`() {
        paths.responses["/api/v2/auth/qr-login"] = """{"success":true,"waiting":true,"pickup":"h","code":"123456","expires_in":300}"""
        paths.responses["/api/v2/auth/qr-login/collect"] = """{"success":true,"waiting":false,"token":"abc","user":{"id":1,"username":"marco"}}"""
        val vm = vm()
        vm.loginWithQrToken("http://nas:3000", "bim:x")
        assertEquals("t${R.string.setup_qr_plaintext_declined}", vm.loginState.value.login.errorMessage.text)
        assertTrue("Nothing saved: ${store.log}", store.log.isEmpty())
        assertTrue("The code did not go out", paths.requestsTo("qr-login").isEmpty())
        assertFalse(t.session.state.value.isLoggedIn)
    }

    @Test
    fun `a different server signs out before the new address`() {
        t.session.loggedIn(admin = false)
        val vm = vm()
        vm.saveServerUrl("https://anderer.example:8443")
        assertTrue("stored", store.log.any { it.startsWith("url:") })
        assertEquals(listOf("abmelden", "url:https://anderer.example:8443"), store.log.take(2))
    }

    @Test
    fun `the same server with a slash does not sign out`() {
        t.session.loggedIn(admin = false)
        val vm = vm()
        vm.saveServerUrl("https://SERVER/")
        assertTrue("stored", store.log.any { it.startsWith("url:") })
        assertFalse(store.log.contains("abmelden"))
    }

    /**
     * Previously the scan signed out of the previous server right away; a rejected or
     * expired code then left no sign-in at all. Now the app pairs
     * alongside and leaves the previous server only after the yes to the account.
     */
    @Test
    fun `a QR code for a different server signs out only after the yes to the account`() {
        paths.responses["/api/v2/auth/qr-login"] = """{"success":true,"waiting":true,"pickup":"h","code":"123456","expires_in":300}"""
        paths.responses["/api/v2/auth/qr-login/collect"] = """{"success":true,"waiting":false,"token":"neu","user":{"id":2,"username":"anna"}}"""
        t.session.loggedIn(admin = false)
        val vm = vm()
        vm.loginWithQrToken("https://neu.example", "einmalig")
        assertEquals("https://neu.example", vm.loginState.value.qrAccount?.server)
        assertEquals("Before the yes only the pairing target", listOf("ziel:https://neu.example"), store.log.toList())
        assertTrue(t.session.state.value.isLoggedIn)

        vm.decideQrAccount(true)
        val p = store.log.toList()
        assertEquals("First end the pairing, then sign out, then the new address: $p",
            listOf("ziel:https://neu.example", "ziel:null", "abmelden", "url:https://neu.example"), p.take(4))
        assertTrue("The address before the new token: $p", p.indexOf("url:https://neu.example") < p.indexOf("token:neu"))
    }

    @Test
    fun `a no to the account of another server leaves the previous sign-in`() {
        paths.responses["/api/v2/auth/qr-login"] = """{"success":true,"waiting":true,"pickup":"h","code":"123456","expires_in":300}"""
        paths.responses["/api/v2/auth/qr-login/collect"] = previewResponse
        paths.responses["/api/v2/auth/qr-login/discard"] = """{"success":true}"""
        t.session.loggedIn(admin = false)
        val vm = vm()
        vm.loginWithQrToken("https://neu.example", "einmalig")
        vm.decideQrAccount(false)
        assertEquals("Not signed out, no new address, no token",
            listOf("ziel:https://neu.example", "ziel:null"), store.log.toList())
        assertEquals("https://server", store.url)
        assertTrue(t.session.state.value.isLoggedIn)
        assertFalse(vm.loginState.value.login.running)
    }

    @Test
    fun `if pairing with another server fails, the error is shown and the sign-in stays`() {
        paths.responses["/api/v2/auth/qr-login"] = """{"success":false,"error":"Code abgelaufen","code":"qr_abgelaufen"}"""
        paths.codes["/api/v2/auth/qr-login"] = 410
        t.session.loggedIn(admin = false)
        val vm = vm()
        vm.loginWithQrToken("https://neu.example", "einmalig")
        assertEquals("Error of the server", "Code abgelaufen", vm.loginState.value.login.errorMessage.text)
        assertEquals(listOf("ziel:https://neu.example", "ziel:null"), store.log.toList())
        assertTrue(t.session.state.value.isLoggedIn)
    }

    private val previewResponse = """{"success":true,"waiting":false,"preview":true,"username":"marco"}"""

    @Test
    fun `a QR sign-in shows account and server and takes over the token only after the yes`() {
        paths.responses["/api/v2/auth/qr-login"] = """{"success":true,"waiting":true,"pickup":"h","code":"123456","expires_in":300}"""
        paths.responses["/api/v2/auth/qr-login/collect"] = previewResponse
        val vm = vm()
        vm.loginWithQrToken("https://brick.example.org/", "bim:x")
        assertEquals(QrAccount("marco", "https://brick.example.org"), vm.loginState.value.qrAccount)
        assertTrue("No token before the yes: ${store.log}", store.log.none { it.startsWith("token:") })
        assertFalse(t.session.state.value.isLoggedIn)
        assertTrue(paths.bodyBytes.last(), "\"preview\":true" in paths.bodyBytes.last())

        paths.responses["/api/v2/auth/qr-login/collect"] =
            """{"success":true,"waiting":false,"token":"abc","username":"marco","user":{"id":1,"username":"marco"}}"""
        vm.decideQrAccount(true)
        assertTrue(paths.bodyBytes.last(), "\"preview\":false" in paths.bodyBytes.last())
        assertTrue("signed in", t.session.state.value.isLoggedIn)
        assertTrue(store.log.toString(), store.log.containsAll(listOf("token:abc", "name:marco")))
        assertNull(vm.loginState.value.qrAccount)
        assertFalse(vm.loginState.value.login.running)
    }

    @Test
    fun `a no to the shown account discards the pairing and leaves nothing behind`() {
        paths.responses["/api/v2/auth/qr-login"] = """{"success":true,"waiting":true,"pickup":"h","code":"123456","expires_in":300}"""
        paths.responses["/api/v2/auth/qr-login/collect"] = previewResponse
        paths.responses["/api/v2/auth/qr-login/discard"] = """{"success":true}"""
        val vm = vm(roots = setOf(fp))
        vm.loginWithQrToken("https://brick.example.org/", "bim:x", fingerprint = fp)
        assertEquals("marco", vm.loginState.value.qrAccount?.user)
        vm.decideQrAccount(false)
        assertEquals(1, paths.requestsTo("qr-login/discard").size)
        assertEquals("""{"pickup":"h"}""", paths.bodyBytes.last())
        assertEquals("Only the preview was fetched", 1, paths.requestsTo("qr-login/collect").size)
        assertTrue("No token, no pin: ${store.log}",
            store.log.none { it.startsWith("token:") || it.startsWith("pin:") })
        assertEquals("vergiss:brick.example.org:443", store.log.last())
        assertFalse(t.session.state.value.isLoggedIn)
        assertNull(vm.loginState.value.qrAccount)
        assertFalse(vm.loginState.value.login.running)
    }

    /** Records which options arrived, and answers with [outcome]. */
    private class FakePasskey(val outcome: PasskeyResult) : PasskeyQuery {
        val options = mutableListOf<String>()
        override suspend fun fetch(optionsJson: String): PasskeyResult { options += optionsJson; return outcome }
    }

    private val passkeyResponse = PasskeyResult.Response("""{"id":"pk1","response":{"clientDataJSON":"cd"}}""")
    private val optionsBody = """{"success":true,"options":{"challenge":"ch-123","rpId":"brick.example.org"}}"""

    @Test
    fun `signing in with a passkey stores the token like the password`() {
        paths.responses["/api/v2/auth/passkey/login/options"] = optionsBody
        paths.responses["/api/v2/auth/passkey/login"] = """{"success":true,"token":"pk-token","user":{"id":1,"username":"marco","is_admin":true},
            "token_info":{"scope":"voll","never_expires":true}}"""
        store.url = "https://brick.example.org"
        val fake = FakePasskey(passkeyResponse)
        val vm = vm()
        vm.setFullAccess(true)
        vm.loginPasskey(fake)
        assertTrue("signed in", t.session.state.value.isLoggedIn)
        assertEquals(listOf("filter-leer", "token:pk-token", "name:marco"), store.log)
        assertTrue(fake.options.single(), "\"challenge\":\"ch-123\"" in fake.options.single())
        val body = paths.bodyBytes[paths.requests.indexOf("POST /api/v2/auth/passkey/login")]
        assertTrue(body, "\"with_token\":true" in body && "\"id\":\"pk1\"" in body && "\"scope\":\"voll\"" in body)
        assertTrue(body, "\"never_expires\":true" in body)
        assertTrue(paths.bodyBytes.first(), "\"purpose\":\"login\"" in paths.bodyBytes.first())
        assertTrue(t.session.state.value.isAdmin)
    }

    @Test
    fun `an aborted passkey dialog sends nothing and reports no error`() {
        paths.responses["/api/v2/auth/passkey/login/options"] = optionsBody
        store.url = "https://brick.example.org"
        val vm = vm()
        vm.loginPasskey(FakePasskey(PasskeyResult.Cancelled))
        assertTrue("Options fetched", paths.requestsTo("options").isNotEmpty() && !vm.loginState.value.login.running)
        assertNull(vm.loginState.value.login.errorMessage)
        assertTrue(paths.requests.toString(), paths.requests.none { it == "POST /api/v2/auth/passkey/login" })
        assertFalse(t.session.state.value.isLoggedIn)
    }

    @Test
    fun `without a passkey on the device or without a domain the sign-in says why`() {
        paths.responses["/api/v2/auth/passkey/login/options"] = optionsBody
        store.url = "https://brick.example.org"
        val vm = vm()
        vm.loginPasskey(FakePasskey(PasskeyResult.NoPasskey))
        assertTrue("Satz", vm.loginState.value.login.errorMessage != null)
        assertEquals("t${R.string.login_passkey_none}", vm.loginState.value.login.errorMessage.text)

        paths.responses["/api/v2/auth/passkey/login/options"] = """{"success":false,"error":"Passkeys brauchen eine Domain"}"""
        paths.codes["/api/v2/auth/passkey/login/options"] = 503
        val fake = FakePasskey(passkeyResponse)
        vm.loginPasskey(fake)
        // The server's sentence, from the error layer as with the password.
        assertTrue("Error of the server", vm.loginState.value.login.errorMessage.text == "Passkeys brauchen eine Domain")
        assertTrue("Without options the Credential Manager is not asked", fake.options.isEmpty())
    }

    @Test
    fun `the second factor takes the passkey if the server offers it, with name and password`() {
        paths.responses["/api/v2/auth/login"] = """{"success":false,"second_factor":true,"passkey":true,"error":"Code fehlt"}"""
        paths.codes["/api/v2/auth/login"] = 401
        paths.responses["/api/v2/auth/passkey/login/options"] = optionsBody
        store.url = "https://brick.example.org"
        val vm = vm()
        vm.login("marco", "geheim")
        assertTrue("Codefeld", vm.loginState.value.codeNeeded)
        assertTrue("The server offers the passkey", vm.loginState.value.passkeyInsteadOfCode)

        paths.codes.remove("/api/v2/auth/login")
        paths.responses["/api/v2/auth/login"] = """{"success":true,"token":"abc","user":{"id":1,"username":"marco"}}"""
        vm.passkeyInsteadOfCode("marco", "geheim", FakePasskey(passkeyResponse))
        assertTrue("signed in", t.session.state.value.isLoggedIn)
        val options = paths.bodyBytes[paths.requests.indexOf("POST /api/v2/auth/passkey/login/options")]
        assertTrue(options, "\"purpose\":\"second_factor\"" in options)
        val body = paths.bodyBytes[paths.requests.lastIndexOf("POST /api/v2/auth/login")]
        assertTrue(body, "\"passkey\":{\"id\":\"pk1\"" in body && "\"password\":\"geheim\"" in body && "\"code\"" !in body)
        assertFalse(vm.loginState.value.passkeyInsteadOfCode)
    }

    /** Options with [rpId] (null: without the field) for the address https://brick.example.org. */
    private fun foreignOptions(rpId: String?): FakePasskey {
        val field = rpId?.let { ",\"rpId\":\"$it\"" } ?: ""
        paths.responses["/api/v2/auth/passkey/login/options"] = """{"success":true,"options":{"challenge":"ch-1"$field}}"""
        store.url = "https://brick.example.org"
        return FakePasskey(passkeyResponse)
    }

    @Test
    fun `options for a foreign domain never go to the Credential Manager`() {
        for (foreign in listOf("opfer.example", "example.org", "evil.brick.example.org", "BRICK.EXAMPLE.ORG")) {
            val fake = foreignOptions(foreign)
            val vm = vm()
            vm.loginPasskey(fake)
            assertTrue("rejected $foreign", vm.loginState.value.login.errorMessage != null)
            assertEquals(foreign, R.string.login_passkey_rpid_foreign, (vm.loginState.value.login.errorMessage as Message.Resource).id)
            assertTrue("$foreign reached the Credential Manager", fake.options.isEmpty())
            assertFalse(vm.loginState.value.login.running)
        }
        assertTrue(paths.requests.toString(), paths.requests.none { it == "POST /api/v2/auth/passkey/login" })
        assertFalse(t.session.state.value.isLoggedIn)
    }

    @Test
    fun `options without rpId never go to the Credential Manager, not even for the second factor`() {
        val fake = foreignOptions(null)
        val vm = vm()
        vm.loginPasskey(fake)
        assertTrue("rejected", vm.loginState.value.login.errorMessage != null)
        assertEquals("t${R.string.login_passkey_rpid_missing}", vm.loginState.value.login.errorMessage.text)

        val second = foreignOptions("opfer.example")
        vm.passkeyInsteadOfCode("marco", "geheim", second)
        assertTrue("rejected", (vm.loginState.value.login.errorMessage as? Message.Resource)?.id == R.string.login_passkey_rpid_foreign)
        assertTrue(fake.options.isEmpty() && second.options.isEmpty())
        assertTrue(paths.requests.toString(), paths.requests.none { it.startsWith("POST /api/v2/auth/login") })
    }

    @Test
    fun `if the address changes during the passkey dialog, the response goes nowhere`() {
        foreignOptions("brick.example.org")
        val switch = PasskeyQuery { store.url = "https://anders.example"; passkeyResponse }
        val vm = vm()
        vm.loginPasskey(switch)
        assertTrue("rejected", vm.loginState.value.login.errorMessage != null)
        assertEquals("t${R.string.login_passkey_error}", vm.loginState.value.login.errorMessage.text)
        assertTrue(paths.requests.toString(), paths.requests.none { it == "POST /api/v2/auth/passkey/login" })
    }
}
