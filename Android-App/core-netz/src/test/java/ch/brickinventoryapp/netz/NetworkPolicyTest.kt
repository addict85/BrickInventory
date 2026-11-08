package ch.brickinventoryapp.netz

import ch.brickinventoryapp.netz.util.NetworkPolicy
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Tests für util/NetworkPolicy: gleiche Herkunft statt Präfixvergleich, und
 * kein Klartext ausser im Debug-Build zum Gerät und zum Emulator-Host.
 *
 * Gegenproben:
 *   in herkunft() den Port weggelassen → rot „die Herkunft eines Tokens …“
 *   in verbindungErlaubt() `entwicklung &&` weggelassen → rot „https
 *     geht immer, http im Release-Build nie“
 *   ENTWICKLUNGS_HOSTS per `startsWith` statt `in` geprüft → rot „der
 *     Debug-Build darf http nur …“ (localhost.angreifer.tld ging durch)
 *   normalisiere() ohne https-Vorsatz → rot „die Einrichtung nimmt
 *     nur https an …“ (brick.fritz.box unlesbar)
 */
class NetworkPolicyTest {

    // ── isSameOrigin ────────────────────────────────────────────────────────
    @Test
    fun `gleiche Origin wird erkannt`() {
        val base = "https://brick.example.com"
        assertTrue(NetworkPolicy.isSameOrigin("https://brick.example.com/api/v1/sets".toHttpUrl(), base))
        assertTrue(NetworkPolicy.isSameOrigin("https://BRICK.example.com/api/v1/sets".toHttpUrl(), base))
        // Trailing slash in der gespeicherten URL darf nichts ändern
        assertTrue(NetworkPolicy.isSameOrigin("https://brick.example.com/x".toHttpUrl(), "$base/"))
    }

    @Test
    fun `Suffix-Angriff wird abgewiesen`() {
        val base = "https://brick.example.com"
        assertFalse(
            "Präfixvergleich-Lücke: Angreifer-Domain mit der Server-URL als Präfix",
            NetworkPolicy.isSameOrigin("https://brick.example.com.angreifer.tld/api/v1/sets".toHttpUrl(), base)
        )
        assertFalse(NetworkPolicy.isSameOrigin("https://evil.tld/brick.example.com".toHttpUrl(), base))
    }

    @Test
    fun `Scheme und Port zaehlen mit`() {
        assertFalse(NetworkPolicy.isSameOrigin("http://brick.example.com/x".toHttpUrl(), "https://brick.example.com"))
        assertFalse(NetworkPolicy.isSameOrigin("https://brick.example.com:8443/x".toHttpUrl(), "https://brick.example.com"))
        assertTrue(NetworkPolicy.isSameOrigin("https://192.168.1.50:8443/x".toHttpUrl(), "https://192.168.1.50:8443"))
    }

    // ── Klartext ────────────────────────────────────────────────────────────
    @Test
    fun `https geht immer, http im Release-Build nie`() {
        for (url in listOf("https://brick.example.com/x", "https://192.168.1.50/x", "https://localhost:8443/x"))
            for (entwicklung in listOf(false, true))
                assertTrue(url, NetworkPolicy.verbindungErlaubt(url.toHttpUrl(), entwicklung))
        for (url in listOf("http://localhost:3000/x", "http://127.0.0.1/x", "http://10.0.2.2:3000/x",
                           "http://192.168.1.50:3000/x", "http://nas:3000/x", "http://brick.example.com/x"))
            assertFalse(url, NetworkPolicy.verbindungErlaubt(url.toHttpUrl(), entwicklung = false))
    }

    @Test
    fun `der Debug-Build darf http nur zum Geraet und zum Emulator-Host`() {
        for (url in listOf("http://localhost:3000/x", "http://LOCALHOST/x", "http://127.0.0.1:3000/x", "http://10.0.2.2:3000/x"))
            assertTrue(url, NetworkPolicy.verbindungErlaubt(url.toHttpUrl(), entwicklung = true))
        for (url in listOf("http://192.168.1.50:3000/x", "http://nas:3000/x", "http://10.0.2.3/x",
                           "http://localhost.angreifer.tld/x", "http://brick.fritz.box/x"))
            assertFalse(url, NetworkPolicy.verbindungErlaubt(url.toHttpUrl(), entwicklung = true))
    }

    @Test
    fun `die Einrichtung nimmt nur https an und ergaenzt es ohne Schema`() {
        assertEquals("https://brick.fritz.box", NetworkPolicy.normalisiere("  brick.fritz.box/ "))
        assertEquals("http://nas:3000", NetworkPolicy.normalisiere("http://nas:3000/"))
        assertNull(NetworkPolicy.adressfehler("brick.fritz.box", entwicklung = false))
        assertNull(NetworkPolicy.adressfehler("HTTPS://nas:8443/brick", entwicklung = false))
        assertEquals(NetworkPolicy.Adressfehler.KLARTEXT, NetworkPolicy.adressfehler("http://nas:3000", entwicklung = false))
        assertEquals(NetworkPolicy.Adressfehler.KLARTEXT, NetworkPolicy.adressfehler("HTTP://nas:3000", entwicklung = true))
        assertEquals(NetworkPolicy.Adressfehler.UNLESBAR, NetworkPolicy.adressfehler("https://", entwicklung = false))
        assertEquals(NetworkPolicy.Adressfehler.UNLESBAR, NetworkPolicy.adressfehler("https://nas:abc", entwicklung = false))
        assertNull("Im Debug-Build der Emulator-Host", NetworkPolicy.adressfehler("http://10.0.2.2:3000", entwicklung = true))
    }

    @Test
    fun `eine gespeicherte http-Adresse ist Altbestand, eine leere nicht`() {
        assertTrue(NetworkPolicy.klartextAltbestand("http://192.168.1.50:3000", entwicklung = false))
        assertTrue(NetworkPolicy.klartextAltbestand("http://localhost:3000", entwicklung = false))
        assertFalse(NetworkPolicy.klartextAltbestand("http://localhost:3000", entwicklung = true))
        assertFalse(NetworkPolicy.klartextAltbestand("https://nas", entwicklung = false))
        assertFalse("Noch nicht eingerichtet ist kein Altbestand", NetworkPolicy.klartextAltbestand("", entwicklung = false))
        assertTrue(NetworkPolicy.istHttps("https://nas:8443"))
        assertFalse(NetworkPolicy.istHttps("http://nas:3000"))
    }

    @Test
    fun `die Herkunft eines Tokens ist Schema, Host und Port`() {
        assertEquals("https://brick.example.com:443", NetworkPolicy.herkunft("https://Brick.example.com/brick/"))
        assertTrue(NetworkPolicy.gleicheHerkunft("http://nas:3000", "http://NAS:3000/"))
        assertFalse(NetworkPolicy.gleicheHerkunft("http://nas:3000", "http://nas:3001"))
        assertFalse(NetworkPolicy.gleicheHerkunft("http://nas:3000", "https://nas:3000"))
        assertFalse("Eine leere Adresse ist kein Server", NetworkPolicy.gleicheHerkunft("", ""))
    }
}
