package ch.brickinventoryapp.network

import ch.brickinventoryapp.model.address.AddressError
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
 * Counter-checks:
 *   in origin(), dropped the port → red “the origin of a token …”
 *   in connectionAllowed(), dropped `development &&` → red “https
 *     always works, http never in the release build”
 *   DEVELOPMENT_HOSTS checked with `startsWith` instead of `in` → red “the
 *     debug build may use http only …” (localhost.angreifer.tld got through)
 *   normalisiere() without the https prefix → red “the setup accepts
 *     only https …” (brick.fritz.box unreadable)
 */
class NetworkPolicyTest {

    // ── isSameOrigin ────────────────────────────────────────────────────────
    @Test
    fun `same origin is recognized`() {
        val base = "https://brick.example.com"
        assertTrue(NetworkPolicy.isSameOrigin("https://brick.example.com/api/v2/sets".toHttpUrl(), base))
        assertTrue(NetworkPolicy.isSameOrigin("https://BRICK.example.com/api/v2/sets".toHttpUrl(), base))
        // A trailing slash in the stored URL must not change anything
        assertTrue(NetworkPolicy.isSameOrigin("https://brick.example.com/x".toHttpUrl(), "$base/"))
    }

    @Test
    fun `suffix attack is rejected`() {
        val base = "https://brick.example.com"
        assertFalse(
            "prefix comparison gap: attacker domain with the server URL as a prefix",
            NetworkPolicy.isSameOrigin("https://brick.example.com.angreifer.tld/api/v2/sets".toHttpUrl(), base)
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
            for (development in listOf(false, true))
                assertTrue(url, NetworkPolicy.connectionAllowed(url.toHttpUrl(), development))
        for (url in listOf("http://localhost:3000/x", "http://127.0.0.1/x", "http://10.0.2.2:3000/x",
                           "http://192.168.1.50:3000/x", "http://nas:3000/x", "http://brick.example.com/x"))
            assertFalse(url, NetworkPolicy.connectionAllowed(url.toHttpUrl(), development = false))
    }

    @Test
    fun `the debug build may use http only to the device and the emulator host`() {
        for (url in listOf("http://localhost:3000/x", "http://LOCALHOST/x", "http://127.0.0.1:3000/x", "http://10.0.2.2:3000/x"))
            assertTrue(url, NetworkPolicy.connectionAllowed(url.toHttpUrl(), development = true))
        for (url in listOf("http://192.168.1.50:3000/x", "http://nas:3000/x", "http://10.0.2.3/x",
                           "http://localhost.angreifer.tld/x", "http://brick.fritz.box/x"))
            assertFalse(url, NetworkPolicy.connectionAllowed(url.toHttpUrl(), development = true))
    }

    @Test
    fun `the setup accepts only https and adds it without a scheme`() {
        assertEquals("https://brick.fritz.box", NetworkPolicy.normalize("  brick.fritz.box/ "))
        assertEquals("http://nas:3000", NetworkPolicy.normalize("http://nas:3000/"))
        assertNull(NetworkPolicy.addressError("brick.fritz.box", development = false))
        assertNull(NetworkPolicy.addressError("HTTPS://nas:8443/brick", development = false))
        assertEquals(AddressError.PLAINTEXT, NetworkPolicy.addressError("http://nas:3000", development = false))
        assertEquals(AddressError.PLAINTEXT, NetworkPolicy.addressError("HTTP://nas:3000", development = true))
        assertEquals(AddressError.UNREADABLE, NetworkPolicy.addressError("https://", development = false))
        assertEquals(AddressError.UNREADABLE, NetworkPolicy.addressError("https://nas:abc", development = false))
        assertNull("the emulator host in the debug build", NetworkPolicy.addressError("http://10.0.2.2:3000", development = true))
    }

    @Test
    fun `a saved http address is legacy, an empty one is not`() {
        assertTrue(NetworkPolicy.plaintextLegacyStock("http://192.168.1.50:3000", development = false))
        assertTrue(NetworkPolicy.plaintextLegacyStock("http://localhost:3000", development = false))
        assertFalse(NetworkPolicy.plaintextLegacyStock("http://localhost:3000", development = true))
        assertFalse(NetworkPolicy.plaintextLegacyStock("https://nas", development = false))
        assertFalse("not set up yet is no legacy data", NetworkPolicy.plaintextLegacyStock("", development = false))
        assertTrue(NetworkPolicy.isHttps("https://nas:8443"))
        assertFalse(NetworkPolicy.isHttps("http://nas:3000"))
    }

    @Test
    fun `the origin of a token is scheme, host and port`() {
        assertEquals("https://brick.example.com:443", NetworkPolicy.origin("https://Brick.example.com/brick/"))
        assertTrue(NetworkPolicy.sameOrigin("http://nas:3000", "http://NAS:3000/"))
        assertFalse(NetworkPolicy.sameOrigin("http://nas:3000", "http://nas:3001"))
        assertFalse(NetworkPolicy.sameOrigin("http://nas:3000", "https://nas:3000"))
        assertFalse("an empty address is no server", NetworkPolicy.sameOrigin("", ""))
    }
}
