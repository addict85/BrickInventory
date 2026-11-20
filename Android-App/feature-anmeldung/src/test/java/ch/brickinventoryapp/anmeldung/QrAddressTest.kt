package ch.brickinventoryapp.anmeldung

import ch.brickinventoryapp.model.ui.errorMessage
import ch.brickinventoryapp.data.Anmeldeablage
import ch.brickinventoryapp.sicherheit.CertificateQuestion
import ch.brickinventoryapp.anmeldung.ui.qrAddressInvalid
import ch.brickinventoryapp.anmeldung.ui.qrSwitchesServer
import ch.brickinventoryapp.anmeldung.ui.viewmodel.AnmeldungViewModel
import ch.brickinventoryapp.netz.util.NetworkPolicy
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
import ch.brickinventoryapp.zustand.ui.Scope
import java.util.Collections
import ch.brickinventoryapp.testing.PfadServer
import ch.brickinventoryapp.testing.SessionFake
import ch.brickinventoryapp.testing.StorageStore
import ch.brickinventoryapp.testing.testPartsRepository
import ch.brickinventoryapp.testing.TestDienste

/**
 * Der QR-Dialog ist die einzige Hürde gegen einen untergeschobenen Code. Geprüft
 * mit den Eingaben aus dem Nachweis der Sicherheitsprüfung: Jede sah
 * im Dialog nach `brick.meinserver.ch` aus und führte woandershin.
 *
 * Gegenproben:
 *   A  NetworkPolicy.adressfehler() auf den Stand ad4a297 (nur UNLESBAR/PLAINTEXT)
 *      → rot „Benutzerangabe, Zeilenumbruch und Rueckstrich …“ und „das ViewModel
 *      nimmt eine Adresse mit Benutzerangabe nicht an“
 *   B  in qrAddressInvalid() die Prüfung auf Leer-/Steuerzeichen entfernt → rot
 *      „Leerraum am Rand eines Codes …“
 *   C  in NetworkPolicy.ansicht() `url.host` durch den Rohtext des Hosts ersetzt
 *      (Unicode statt Punycode) → rot „ein internationaler Host erscheint in Punycode …“
 *   D  qrSwitchesServer() liefert immer null → rot „ein Code fuer einen anderen
 *      Host nennt den bisherigen …“
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
    fun `Benutzerangabe, Zeilenumbruch und Rueckstrich machen den Code ungueltig`() {
        for (url in deceptive) {
            assertTrue("angenommen: $url", qrAddressInvalid(url))
            assertTrue("von Hand angenommen: $url", NetworkPolicy.addressError(url, entwicklung = false) != null)
        }
        assertEquals(NetworkPolicy.AddressError.USER_INPUT,
            NetworkPolicy.addressError("https://brick.meinserver.ch@evil.example", entwicklung = false))
        assertEquals(NetworkPolicy.AddressError.EXTRA,
            NetworkPolicy.addressError("https://evil.example/x\n\nbrick.meinserver.ch", entwicklung = false))
        // Was ein echter Server braucht, bleibt erlaubt: Port, Unterpfad, Grossschreibung.
        for (gut in listOf("https://brick.meinserver.ch", "https://nas:8443/brick", "HTTPS://Brick.Example.org/")) {
            assertFalse(gut, qrAddressInvalid(gut))
        }
    }

    @Test
    fun `Leerraum am Rand eines Codes macht ihn ungueltig, von Hand nicht`() {
        assertTrue(qrAddressInvalid("https://evil.example\n"))
        assertTrue(qrAddressInvalid(" https://evil.example"))
        assertNull("Von Hand getippt trägt der Rand nichts", NetworkPolicy.addressError(" brick.fritz.box ", entwicklung = false))
    }

    @Test
    fun `ein internationaler Host erscheint in Punycode und mit Warnung`() {
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
    fun `ein Code fuer einen anderen Host nennt den bisherigen, derselbe Server nicht`() {
        assertEquals("brick.meinserver.ch", qrSwitchesServer("https://brick.meinserver.ch", "https://xn--brck-m9d.meinserver.ch"))
        assertEquals("brick.meinserver.ch", qrSwitchesServer("https://brick.meinserver.ch", "https://brick.meinserver.ch:8443"))
        assertNull(qrSwitchesServer("https://brick.meinserver.ch", "https://BRICK.meinserver.ch/"))
        assertNull("Ohne bisherigen Server kein Wechsel", qrSwitchesServer("", "https://brick.meinserver.ch"))
    }

    // ── Das ViewModel als zweite Linie ─────────────────────────────────────────

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
    fun `das ViewModel nimmt eine Adresse mit Benutzerangabe nicht an`() {
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
