package ch.brickinventoryapp.network

import ch.brickinventoryapp.network.util.NetworkPolicy
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Tests for util/NetworkPolicy: same origin instead of a prefix comparison, and
 * no plain text except in a debug build, to the device and to the emulator host.
 *
 * Gegenproben:
 *   in herkunft(), dropped the port → red "die Herkunft eines Tokens …"
 *   in connectionAllowed(), dropped `entwicklung &&` → red "https
 *     geht immer, http im Release-Build nie"
 *   ENTWICKLUNGS_HOSTS checked with `startsWith` instead of `in` → red "der
 *     Debug-Build darf http nur …" (localhost.angreifer.tld got through)
 *   normalisiere() without the https prefix → red "die Einrichtung nimmt
 *     nur https an …" (brick.fritz.box unreadable)
 */
class NetworkPolicyTest {

    // ── isSameOrigin ────────────────────────────────────────────────────────
    @Test
    fun `same origin is recognized`() {
        val base = "https://brick.example.com"
        assertTrue(NetworkPolicy.isSameOrigin("https://brick.example.com/api/v1/sets".toHttpUrl(), base))
        assertTrue(NetworkPolicy.isSameOrigin("https://BRICK.example.com/api/v1/sets".toHttpUrl(), base))
        // A trailing slash in the stored URL must not change anything
        assertTrue(NetworkPolicy.isSameOrigin("https://brick.example.com/x".toHttpUrl(), "$base/"))
    }

    @Test
    fun `suffix attack is rejected`() {
        val base = "https://brick.example.com"
        assertFalse(
            "Präfixvergleich-Lücke: Angreifer-Domain mit der Server-URL als Präfix",
            NetworkPolicy.isSameOrigin("https://brick.example.com.angreifer.tld/api/v1/sets".toHttpUrl(), base)
        )
        assertFalse(NetworkPolicy.isSameOrigin("https://evil.tld/brick.example.com".toHttpUrl(), base))
    }

    @Test
    fun `scheme and port count too`() {
        assertFalse(NetworkPolicy.isSameOrigin("http://brick.example.com/x".toHttpUrl(), "https://brick.example.com"))
        assertFalse(NetworkPolicy.isSameOrigin("https://brick.example.com:8443/x".toHttpUrl(), "https://brick.example.com"))
        assertTrue(NetworkPolicy.isSameOrigin("https://192.168.1.50:8443/x".toHttpUrl(), "https://192.168.1.50:8443"))
    }

    // ── Plain text ───────────────────────────────────────────────────────────
    @Test
    fun `https always works, http never in the release build`() {
        for (url in listOf("https://brick.example.com/x", "https://192.168.1.50/x", "https://localhost:8443/x"))
            for (entwicklung in listOf(false, true))
                assertTrue(url, NetworkPolicy.connectionAllowed(url.toHttpUrl(), entwicklung))
        for (url in listOf("http://localhost:3000/x", "http://127.0.0.1/x", "http://10.0.2.2:3000/x",
                           "http://192.168.1.50:3000/x", "http://nas:3000/x", "http://brick.example.com/x"))
            assertFalse(url, NetworkPolicy.connectionAllowed(url.toHttpUrl(), entwicklung = false))
    }

    @Test
    fun `the debug build may use http only to the device and the emulator host`() {
        for (url in listOf("http://localhost:3000/x", "http://LOCALHOST/x", "http://127.0.0.1:3000/x", "http://10.0.2.2:3000/x"))
            assertTrue(url, NetworkPolicy.connectionAllowed(url.toHttpUrl(), entwicklung = true))
        for (url in listOf("http://192.168.1.50:3000/x", "http://nas:3000/x", "http://10.0.2.3/x",
                           "http://localhost.angreifer.tld/x", "http://brick.fritz.box/x"))
            assertFalse(url, NetworkPolicy.connectionAllowed(url.toHttpUrl(), entwicklung = true))
    }

    @Test
    fun `the setup accepts only https and adds it without a scheme`() {
        assertEquals("https://brick.fritz.box", NetworkPolicy.normalize("  brick.fritz.box/ "))
        assertEquals("http://nas:3000", NetworkPolicy.normalize("http://nas:3000/"))
        assertNull(NetworkPolicy.addressError("brick.fritz.box", entwicklung = false))
        assertNull(NetworkPolicy.addressError("HTTPS://nas:8443/brick", entwicklung = false))
        assertEquals(NetworkPolicy.AddressError.PLAINTEXT, NetworkPolicy.addressError("http://nas:3000", entwicklung = false))
        assertEquals(NetworkPolicy.AddressError.PLAINTEXT, NetworkPolicy.addressError("HTTP://nas:3000", entwicklung = true))
        assertEquals(NetworkPolicy.AddressError.UNLESBAR, NetworkPolicy.addressError("https://", entwicklung = false))
        assertEquals(NetworkPolicy.AddressError.UNLESBAR, NetworkPolicy.addressError("https://nas:abc", entwicklung = false))
        assertNull("Im Debug-Build der Emulator-Host", NetworkPolicy.addressError("http://10.0.2.2:3000", entwicklung = true))
    }

    @Test
    fun `a saved http address is legacy, an empty one is not`() {
        assertTrue(NetworkPolicy.plaintextLegacyStock("http://192.168.1.50:3000", entwicklung = false))
        assertTrue(NetworkPolicy.plaintextLegacyStock("http://localhost:3000", entwicklung = false))
        assertFalse(NetworkPolicy.plaintextLegacyStock("http://localhost:3000", entwicklung = true))
        assertFalse(NetworkPolicy.plaintextLegacyStock("https://nas", entwicklung = false))
        assertFalse("Noch nicht eingerichtet ist kein Altbestand", NetworkPolicy.plaintextLegacyStock("", entwicklung = false))
        assertTrue(NetworkPolicy.istHttps("https://nas:8443"))
        assertFalse(NetworkPolicy.istHttps("http://nas:3000"))
    }

    @Test
    fun `the origin of a token is scheme, host and port`() {
        assertEquals("https://brick.example.com:443", NetworkPolicy.herkunft("https://Brick.example.com/brick/"))
        assertTrue(NetworkPolicy.sameOrigin("http://nas:3000", "http://NAS:3000/"))
        assertFalse(NetworkPolicy.sameOrigin("http://nas:3000", "http://nas:3001"))
        assertFalse(NetworkPolicy.sameOrigin("http://nas:3000", "https://nas:3000"))
        assertFalse("Eine leere Adresse ist kein Server", NetworkPolicy.sameOrigin("", ""))
    }
}
