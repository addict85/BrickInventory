package ch.brickinventoryapp

import ch.brickinventoryapp.util.NetworkPolicy
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Tests für util/NetworkPolicy — beide Regeln hatten vorher echte Lücken:
 *
 *  - Der Token wurde per `finalUrl.startsWith(serverUrl)` angehängt. Ein
 *    Präfixvergleich hält "https://brick.example.com.angreifer.tld" für den
 *    eigenen Server.
 *  - `usesCleartextTraffic="true"` galt app-weit, also auch für öffentliche
 *    Hosts — der nie ablaufende Bearer-Token ging dann im Klartext raus.
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
        assertTrue(NetworkPolicy.isSameOrigin("http://192.168.1.50:3000/x".toHttpUrl(), "http://192.168.1.50:3000"))
    }

    // ── isPrivateHost ───────────────────────────────────────────────────────
    @Test
    fun `private Adressen werden erkannt`() {
        listOf(
            "192.168.1.50", "10.0.0.5", "172.16.0.1", "172.31.255.254",
            "127.0.0.1", "169.254.1.1", "localhost", "brickserver.local", "::1"
        ).forEach { assertTrue("$it sollte privat sein", NetworkPolicy.isPrivateHost(it)) }
    }

    @Test
    fun `gewoehnliche Hostnamen im Heimnetz werden nicht blockiert`() {
        // Der Fehler, der die App lahmgelegt hat: Die erste Fassung liess nur
        // IP-Adressen und wenige Suffixe durch und blockierte damit jede
        // Adresse der Form http://nas:3000 — also den Normalfall für einen
        // selbstgehosteten Server.
        listOf(
            "http://nas:3000/api/v1/sets",
            "http://raspberrypi:3000/api/v1/sets",
            "http://brickserver:3000/api/v1/sets",
            "http://brick.fritz.box:3000/api/v1/sets",
            "http://server.lan:3000/api/v1/sets",
        ).forEach {
            assertTrue("$it muss erlaubt sein", NetworkPolicy.isCleartextAllowed(it.toHttpUrl()))
        }
    }

    @Test
    fun `nur oeffentliche IP-Adressen werden im Klartext blockiert`() {
        assertFalse("Bearer-Token darf nicht im Klartext an eine öffentliche IP",
            NetworkPolicy.isCleartextAllowed("http://8.8.8.8/api/v1/sets".toHttpUrl()))
        assertTrue(NetworkPolicy.isCleartextAllowed("https://8.8.8.8/api/v1/sets".toHttpUrl()))
    }

    @Test
    fun `oeffentliche Adressen werden nicht als privat gewertet`() {
        listOf(
            "8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1",
            "192.169.1.1", "brick.example.com", "cdn.rebrickable.com",
            // Hostnamen mit fc/fd-Präfix dürfen nicht als IPv6-ULA gelten
            "fcbayern.example", "fdservice.example.com"
            // Hinweis: Namen OHNE Punkt gelten bewusst als privat (Intranet-
            // Namen sind öffentlich nicht auflösbar) — siehe eigener Test oben.
        ).forEach { assertFalse("$it sollte öffentlich sein", NetworkPolicy.isPrivateHost(it)) }
    }

    // ── isCleartextAllowed ──────────────────────────────────────────────────
    @Test
    fun `https ist immer erlaubt`() {
        assertTrue(NetworkPolicy.isCleartextAllowed("https://brick.example.com/x".toHttpUrl()))
        assertTrue(NetworkPolicy.isCleartextAllowed("https://192.168.1.50/x".toHttpUrl()))
    }

    @Test
    fun `http im lokalen Netz ist erlaubt`() {
        assertTrue(NetworkPolicy.isCleartextAllowed("http://192.168.1.50:3000/api/v1/sets".toHttpUrl()))
        assertTrue(NetworkPolicy.isCleartextAllowed("http://localhost:3000/api/v1/sets".toHttpUrl()))
        // Ein öffentlich aussehender NAME wird nur noch protokolliert, nicht
        // blockiert — sonst legt eine Fehleinschätzung die ganze App still.
        assertTrue(NetworkPolicy.isCleartextAllowed("http://brick.example.com/api/v1/sets".toHttpUrl()))
    }
}
