package ch.brickinventoryapp.login

import ch.brickinventoryapp.model.ui.errorMessage
import ch.brickinventoryapp.data.LoginStore
import ch.brickinventoryapp.security.CertificateQuestion
import ch.brickinventoryapp.login.ui.qrAddressInvalid
import ch.brickinventoryapp.login.ui.qrSwitchesServer
import ch.brickinventoryapp.login.ui.viewmodel.LoginViewModel
import ch.brickinventoryapp.network.util.NetworkPolicy
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
import ch.brickinventoryapp.testing.testHouseholdRepository
import ch.brickinventoryapp.testing.testAccountRepository
import ch.brickinventoryapp.state.ui.Scope
import java.util.Collections
import ch.brickinventoryapp.testing.PathServer
import ch.brickinventoryapp.testing.SessionFake
import ch.brickinventoryapp.testing.StorageStore
import ch.brickinventoryapp.testing.testPartsRepository
import ch.brickinventoryapp.testing.TestServices

/**
 * The QR dialog is the only hurdle against a planted code. Checked
 * with the inputs from the security review's evidence: every one looked
 * in the dialog like `brick.meinserver.ch` and led somewhere else.
 *
 * Counter-checks:
 *   A  NetworkPolicy.adressfehler() reverted to ad4a297 (only UNLESBAR/PLAINTEXT)
 *      → red “user info, line break and backslash …” and “the ViewModel
 *      does not accept an address with user info”
 *   B  in qrAddressInvalid() the check for blank/control characters removed → red
 *      “whitespace at the edge of a code …”
 *   C  in NetworkPolicy.view() `url.host` replaced with the host's raw text
 *      (Unicode instead of Punycode) → red “an international host appears in Punycode …”
 *   D  qrSwitchesServer() always returns null → red “a code for a different
 *      host names the previous one …”
 */
@OptIn(ExperimentalCoroutinesApi::class)
class QrAddressTest {

    private val deceptive = listOf(
        "https://brick.meinserver.ch@evil.example",
        "https://brick.meinserver.ch%40x@evil.example/",
        "https://brick.meinserver.ch\\@evil.example",
        "https://evil.example/x\n\nbrick.meinserver.ch (dein Server)",
        "https://brick.meinserver.ch:pw@evil.example",
        "https://evil.example/?brick.meinserver.ch",
        "https://evil.example/#brick.meinserver.ch",
    )

    @Test
    fun `user info, line break and backslash make the code invalid`() {
        for (url in deceptive) {
            assertTrue("angenommen: $url", qrAddressInvalid(url))
            assertTrue("von Hand angenommen: $url", NetworkPolicy.addressError(url, development = false) != null)
        }
        assertEquals(NetworkPolicy.AddressError.USER_INPUT,
            NetworkPolicy.addressError("https://brick.meinserver.ch@evil.example", development = false))
        assertEquals(NetworkPolicy.AddressError.EXTRA,
            NetworkPolicy.addressError("https://evil.example/x\n\nbrick.meinserver.ch", development = false))
        // What a real server needs stays allowed: port, subpath, capitalization.
        for (good in listOf("https://brick.meinserver.ch", "https://nas:8443/brick", "HTTPS://Brick.Example.org/")) {
            assertFalse(good, qrAddressInvalid(good))
        }
    }

    @Test
    fun `whitespace at the edge of a code makes it invalid, by hand it does not`() {
        assertTrue(qrAddressInvalid("https://evil.example\n"))
        assertTrue(qrAddressInvalid(" https://evil.example"))
        assertNull("Von Hand getippt trägt der Rand nichts", NetworkPolicy.addressError(" brick.fritz.box ", development = false))
    }

    @Test
    fun `an international host appears in punycode and with a warning`() {
        val a = NetworkPolicy.view("https://brіck.meinserver.ch")!!   // kyrillisches і
        assertEquals("xn--brck-m9d.meinserver.ch", a.host)
        assertEquals("https://xn--brck-m9d.meinserver.ch", a.address)
        assertTrue(a.international)
        val real = NetworkPolicy.view("https://Brick.MeinServer.ch:8443/brick/")!!
        assertEquals("brick.meinserver.ch", real.host)
        assertEquals("https://brick.meinserver.ch:8443/brick", real.address)
        assertFalse(real.international)
        assertEquals("https://brick.meinserver.ch", NetworkPolicy.view("https://brick.meinserver.ch:443")!!.address)
    }

    @Test
    fun `a code for a different host names the previous one, the same server does not`() {
        assertEquals("brick.meinserver.ch", qrSwitchesServer("https://brick.meinserver.ch", "https://xn--brck-m9d.meinserver.ch"))
        assertEquals("brick.meinserver.ch", qrSwitchesServer("https://brick.meinserver.ch", "https://brick.meinserver.ch:8443"))
        assertNull(qrSwitchesServer("https://brick.meinserver.ch", "https://BRICK.meinserver.ch/"))
        assertNull("Ohne bisherigen Server kein Wechsel", qrSwitchesServer("", "https://brick.meinserver.ch"))
    }

    // ── The ViewModel as a second line ─────────────────────────────────────────

    private class Store : LoginStore {
        val log = Collections.synchronizedList(mutableListOf<String>())
        override suspend fun serverUrlNow() = "https://brick.meinserver.ch"
        override suspend fun saveServerUrl(url: String) { log += "url:$url" }
        override suspend fun saveAuthToken(token: String) { log += "token:$token" }
        override suspend fun saveUsername(name: String) { log += "name:$name" }
        override fun rememberPin(key: String, fingerprint: String) { log += "pin" }
        override fun rememberedPin(key: String): String? = null
        override fun holdBefore(key: String, fingerprint: String) { log += "vor" }
        override fun forgetRetained(key: String) = Unit
        override fun pairingTarget(url: String?) { log += "ziel:$url" }
    }

    private lateinit var paths: PathServer
    private lateinit var t: TestServices

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        paths = PathServer()
        t = TestServices(paths.onTick(), io = Dispatchers.Main)
    }

    @After
    fun tearDown() {
        t.cleanUp()
        Dispatchers.resetMain()
        paths.server.shutdown()
    }

    @Test
    fun `the ViewModel does not accept an address with user info`() {
        val store = Store()
        val logout = SessionFake()
        val viewport = Scope(StorageStore(),
            testHouseholdRepository(t.api),
            testPartsRepository(t.api))
        val vm = t.track(LoginViewModel(t.session, viewport, t.hints, logout,
            testAccountRepository(t.api), store, CertificateQuestion(), { false }))
        vm.loginWithQrToken("https://brick.meinserver.ch@evil.example", "bim:x")
        assertFalse(vm.saveServerUrl("https://brick.meinserver.ch@evil.example"))
        assertEquals(emptyList<String>(), store.log.toList())
        assertEquals("Nichts abgemeldet", 0, logout.logouts)
        assertTrue("kein qr-login", paths.requestsTo("qr-login").isEmpty())
        assertTrue(vm.loginState.value.login.errorMessage != null)
    }
}
