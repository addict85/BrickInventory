package ch.brickinventoryapp

import ch.brickinventoryapp.data.Anmeldeablage
import ch.brickinventoryapp.data.repository.KontoRepository
import ch.brickinventoryapp.ui.qrAdresseUngueltig
import ch.brickinventoryapp.ui.qrWechseltServer
import ch.brickinventoryapp.ui.viewmodel.AnmeldungViewModel
import ch.brickinventoryapp.util.NetworkPolicy
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
import ch.brickinventoryapp.data.repository.HaushaltRepository
import ch.brickinventoryapp.ui.Blickfeld

/**
 * Der QR-Dialog ist die einzige Hürde gegen einen untergeschobenen Code. Geprüft
 * mit den Eingaben aus dem Nachweis der Sicherheitsprüfung (sec7, M1): Jede sah
 * im Dialog nach `brick.meinserver.ch` aus und führte woandershin.
 *
 * Gegenproben (03.11.2026, kotlinc lokal gemessen):
 *   A  NetworkPolicy.adressfehler() auf den Stand ad4a297 (nur UNLESBAR/KLARTEXT)
 *      → rot „Benutzerangabe, Zeilenumbruch und Rueckstrich …“ und „das ViewModel
 *      nimmt eine Adresse mit Benutzerangabe nicht an“
 *   B  in qrAdresseUngueltig() die Prüfung auf Leer-/Steuerzeichen entfernt → rot
 *      „Leerraum am Rand eines Codes …“
 *   C  in NetworkPolicy.ansicht() `url.host` durch den Rohtext des Hosts ersetzt
 *      (Unicode statt Punycode) → rot „ein internationaler Host erscheint in Punycode …“
 *   D  qrWechseltServer() liefert immer null → rot „ein Code fuer einen anderen
 *      Host nennt den bisherigen …“
 */
@OptIn(ExperimentalCoroutinesApi::class)
class QrAdresseTest {

    private val taeuschend = listOf(
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
        for (url in taeuschend) {
            assertTrue("angenommen: $url", qrAdresseUngueltig(url))
            assertTrue("von Hand angenommen: $url", NetworkPolicy.adressfehler(url, entwicklung = false) != null)
        }
        assertEquals(NetworkPolicy.Adressfehler.BENUTZERANGABE,
            NetworkPolicy.adressfehler("https://brick.meinserver.ch@evil.example", entwicklung = false))
        assertEquals(NetworkPolicy.Adressfehler.ZUSATZ,
            NetworkPolicy.adressfehler("https://evil.example/x\n\nbrick.meinserver.ch", entwicklung = false))
        // Was ein echter Server braucht, bleibt erlaubt: Port, Unterpfad, Grossschreibung.
        for (gut in listOf("https://brick.meinserver.ch", "https://nas:8443/brick", "HTTPS://Brick.Example.org/")) {
            assertFalse(gut, qrAdresseUngueltig(gut))
        }
    }

    @Test
    fun `Leerraum am Rand eines Codes macht ihn ungueltig, von Hand nicht`() {
        assertTrue(qrAdresseUngueltig("https://evil.example\n"))
        assertTrue(qrAdresseUngueltig(" https://evil.example"))
        assertNull("Von Hand getippt trägt der Rand nichts", NetworkPolicy.adressfehler(" brick.fritz.box ", entwicklung = false))
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
        assertEquals("brick.meinserver.ch", qrWechseltServer("https://brick.meinserver.ch", "https://xn--brck-m9d.meinserver.ch"))
        assertEquals("brick.meinserver.ch", qrWechseltServer("https://brick.meinserver.ch", "https://brick.meinserver.ch:8443"))
        assertNull(qrWechseltServer("https://brick.meinserver.ch", "https://BRICK.meinserver.ch/"))
        assertNull("Ohne bisherigen Server kein Wechsel", qrWechseltServer("", "https://brick.meinserver.ch"))
    }

    // ── Das ViewModel als zweite Linie ─────────────────────────────────────────

    private class Ablage : Anmeldeablage {
        val protokoll = java.util.Collections.synchronizedList(mutableListOf<String>())
        override suspend fun serverUrlJetzt() = "https://brick.meinserver.ch"
        override suspend fun saveServerUrl(url: String) { protokoll += "url:$url" }
        override suspend fun saveAuthToken(token: String) { protokoll += "token:$token" }
        override suspend fun saveUsername(name: String) { protokoll += "name:$name" }
        override fun merkePin(schluessel: String, fingerabdruck: String) { protokoll += "pin" }
        override fun gemerkterPin(schluessel: String): String? = null
        override fun halteVor(schluessel: String, fingerabdruck: String) { protokoll += "vor" }
        override fun vergissVorgehaltenen(schluessel: String) = Unit
    }

    private lateinit var pfade: PfadServer
    private lateinit var t: TestDienste

    @Before
    fun auf() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        pfade = PfadServer()
        t = TestDienste(pfade.imTakt(), io = Dispatchers.Main)
    }

    @After
    fun zu() {
        t.aufraeumen()
        Dispatchers.resetMain()
        pfade.server.shutdown()
    }

    @Test
    fun `das ViewModel nimmt eine Adresse mit Benutzerangabe nicht an`() {
        val ablage = Ablage()
        val abmelden = SitzungsAttrappe()
        val blickfeld = Blickfeld(SpeicherAblage(),
            HaushaltRepository(t.api, t.cache),
            TeileRepository(t.api, t.cache))
        val vm = t.merke(AnmeldungViewModel(t.sitzung, blickfeld, t.hinweise, abmelden,
            KontoRepository(t.api, t.cache), ablage, { false }))
        vm.loginWithQrToken("https://brick.meinserver.ch@evil.example", "bim:x")
        assertFalse(vm.saveServerUrl("https://brick.meinserver.ch@evil.example"))
        assertEquals(emptyList<String>(), ablage.protokoll.toList())
        assertEquals("Nichts abgemeldet", 0, abmelden.abmeldungen)
        assertTrue("kein qr-login", pfade.anfragenAn("qr-login").isEmpty())
        assertTrue(vm.anmeldeState.value.loginError != null)
    }
}
