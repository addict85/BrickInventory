package ch.brickinventoryapp.login

import ch.brickinventoryapp.model.ui.errorMessage
import ch.brickinventoryapp.data.Anmeldeablage
import ch.brickinventoryapp.security.CertificateQuestion
import ch.brickinventoryapp.login.ui.qrAddressInvalid
import ch.brickinventoryapp.login.ui.qrSwitchesServer
import ch.brickinventoryapp.login.ui.viewmodel.AnmeldungViewModel
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
import ch.brickinventoryapp.testing.PfadServer
import ch.brickinventoryapp.testing.SessionFake
import ch.brickinventoryapp.testing.StorageStore
import ch.brickinventoryapp.testing.testPartsRepository
import ch.brickinventoryapp.testing.TestDienste

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
 *   C  in NetworkPolicy.ansicht() `url.host` replaced with the host's raw text
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
            assertTrue("von Hand angenommen: $url", NetworkPolicy.addressError(url, entwicklung = false) != null)
        }
        assertEquals(NetworkPolicy.AddressError.USER_INPUT,
            NetworkPolicy.addressError("https://brick.meinserver.ch@evil.example", entwicklung = false))
        assertEquals(NetworkPolicy.AddressError.EXTRA,
            NetworkPolicy.addressError("https://evil.example/x\n\nbrick.meinserver.ch", entwicklung = false))
        // What a real server needs stays allowed: port, subpath, capitalization.
        for (gut in listOf("https://brick.meinserver.ch", "https://nas:8443/brick", "HTTPS://Brick.Example.org/")) {
            assertFalse(gut, qrAddressInvalid(gut))
        }
    }

    @Test
    fun `whitespace at the edge of a code makes it invalid, by hand it does not`() {
        assertTrue(qrAddressInvalid("https://evil.example\n"))
        assertTrue(qrAddressInvalid(" https://evil.example"))
        assertNull("Von Hand getippt trägt der Rand nichts", NetworkPolicy.addressError(" brick.fritz.box ", entwicklung = false))
    }

    @Test
    fun `an international host appears in punycode and with a warning`() {
        val a = NetworkPolicy.ansicht("https://brіck.meinserver.ch")!!   // kyrillisches і
        assertEquals("xn--brck-m9d.meinserver.ch", a.host)
        assertEquals("https://xn--brck-m9d.meinserver.ch", a.adresse)
        assertTrue(a.international)
        val echt = NetworkPolicy.ansicht("https://Brick.MeinServer.ch:8443/brick/")!!
        assertEquals("brick.meinserver.ch", echt.host)
        assertEquals("https://brick.meinserver.ch:8443/brick", echt.adresse)
        assertFalse(echt.international)
        assertEquals("https://brick.meinserver.ch", NetworkPolicy.ansicht("https://brick.meinserver.ch:443")!!.adresse)
    }

    @Test
    fun `a code for a different host names the previous one, the same server does not`() {
        assertEquals("brick.meinserver.ch", qrSwitchesServer("https://brick.meinserver.ch", "https://xn--brck-m9d.meinserver.ch"))
        assertEquals("brick.meinserver.ch", qrSwitchesServer("https://brick.meinserver.ch", "https://brick.meinserver.ch:8443"))
        assertNull(qrSwitchesServer("https://brick.meinserver.ch", "https://BRICK.meinserver.ch/"))
        assertNull("Ohne bisherigen Server kein Wechsel", qrSwitchesServer("", "https://brick.meinserver.ch"))
    }

    // ── The ViewModel as a second line ─────────────────────────────────────────

    private class Ablage : Anmeldeablage {
        val protokoll = Collections.synchronizedList(mutableListOf<String>())
        override suspend fun serverUrlJetzt() = "https://brick.meinserver.ch"
        override suspend fun saveServerUrl(url: String) { protokoll += "url:$url" }
        override suspend fun saveAuthToken(token: String) { protokoll += "token:$token" }
        override suspend fun saveUsername(name: String) { protokoll += "name:$name" }
        override fun rememberPin(schluessel: String, fingerabdruck: String) { protokoll += "pin" }
        override fun rememberedPin(schluessel: String): String? = null
        override fun holdBefore(schluessel: String, fingerabdruck: String) { protokoll += "vor" }
        override fun forgetRetained(schluessel: String) = Unit
        override fun kopplungsziel(url: String?) { protokoll += "ziel:$url" }
    }

    private lateinit var paths: PfadServer
    private lateinit var t: TestDienste

    @Before
    fun auf() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        paths = PfadServer()
        t = TestDienste(paths.imTakt(), io = Dispatchers.Main)
    }

    @After
    fun zu() {
        t.aufraeumen()
        Dispatchers.resetMain()
        paths.server.shutdown()
    }

    @Test
    fun `the ViewModel does not accept an address with user info`() {
        val ablage = Ablage()
        val abmelden = SessionFake()
        val blickfeld = Scope(StorageStore(),
            testHouseholdRepository(t.api),
            testPartsRepository(t.api))
        val vm = t.merke(AnmeldungViewModel(t.sitzung, blickfeld, t.hinweise, abmelden,
            testAccountRepository(t.api), ablage, CertificateQuestion(), { false }))
        vm.loginWithQrToken("https://brick.meinserver.ch@evil.example", "bim:x")
        assertFalse(vm.saveServerUrl("https://brick.meinserver.ch@evil.example"))
        assertEquals(emptyList<String>(), ablage.protokoll.toList())
        assertEquals("Nichts abgemeldet", 0, abmelden.signOuts)
        assertTrue("kein qr-login", paths.requestsAn("qr-login").isEmpty())
        assertTrue(vm.anmeldeState.value.anmeldung.errorMessage != null)
    }
}
