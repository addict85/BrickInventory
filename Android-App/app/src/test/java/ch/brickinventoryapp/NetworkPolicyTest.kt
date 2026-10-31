package ch.brickinventoryapp

import ch.brickinventoryapp.util.NetworkPolicy
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
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
 *
 * Gegenproben für Herkunft und Rückfrage (29.10.2026, gemessen): in herkunft()
 * den Port weggelassen → rot „die Herkunft eines Tokens …“; in
 * anmeldungBrauchtNetzBestaetigung() die Loopback-Ausnahme entfernt → rot „nur
 * ein Passwort im Klartext …“.
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
            assertTrue("$it muss erlaubt sein", NetworkPolicy.isCleartextAllowed(it.toHttpUrl(), experte = true))
        }
    }

    @Test
    fun `nur oeffentliche IP-Adressen werden im Klartext blockiert`() {
        assertFalse("Bearer-Token darf nicht im Klartext an eine öffentliche IP",
            NetworkPolicy.isCleartextAllowed("http://8.8.8.8/api/v1/sets".toHttpUrl(), experte = true))
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
    fun `http im lokalen Netz ist mit dem Expertenschalter erlaubt`() {
        assertTrue(NetworkPolicy.isCleartextAllowed("http://192.168.1.50:3000/api/v1/sets".toHttpUrl(), experte = true))
        assertTrue(NetworkPolicy.isCleartextAllowed("http://localhost:3000/api/v1/sets".toHttpUrl(), experte = true))
    }

    // Gegenprobe (30.10.2026, gemessen): in isCleartextAllowed die Zeile
    // `if (!experte) return false` entfernt → rot.
    @Test
    fun `ohne Expertenschalter geht kein Klartext hinaus, auch nicht ins Heimnetz`() {
        listOf("http://192.168.1.50:3000/x", "http://nas:3000/x", "http://localhost:3000/x").forEach {
            assertFalse(it, NetworkPolicy.isCleartextAllowed(it.toHttpUrl()))
            assertFalse(it, NetworkPolicy.isCleartextAllowed(it.toHttpUrl(), setOf("nas", "localhost", "192.168.1.50")))
        }
        assertTrue(NetworkPolicy.isCleartextAllowed("https://nas:3000/x".toHttpUrl()))
    }

    // Gegenprobe (30.10.2026, gemessen): klartextVorgabe() immer false → rot.
    @Test
    fun `nach dem Update behaelt nur ein http-Altbestand den Klartext`() {
        assertTrue(NetworkPolicy.klartextVorgabe(" HTTP://nas:3000"))
        assertFalse(NetworkPolicy.klartextVorgabe("https://brick.example.org"))
        assertFalse("Eine Neuinstallation beginnt ohne", NetworkPolicy.klartextVorgabe(""))
        assertTrue(NetworkPolicy.istHttps("https://nas:8443"))
        assertFalse(NetworkPolicy.istHttps("http://nas:3000"))
    }

    // Gegenprobe (am 27.10. mit kotlinc gemessen): in isCleartextAllowed wieder
    // `return true` für Namen → rot, der unbestätigte Host ging durch.
    @Test
    fun `ein oeffentlicher Name im Klartext nur nach Bestaetigung genau dieses Hosts`() {
        val url = "http://brick.example.com/api/v1/sets".toHttpUrl()
        assertFalse(NetworkPolicy.isCleartextAllowed(url, experte = true))
        assertFalse(NetworkPolicy.isCleartextAllowed(url, setOf("anderer.example.com"), experte = true))
        assertTrue(NetworkPolicy.isCleartextAllowed(url, setOf("brick.example.com"), experte = true))
        // Eine öffentliche IP bleibt gesperrt, auch bestätigt.
        assertFalse(NetworkPolicy.isCleartextAllowed("http://8.8.8.8/x".toHttpUrl(), setOf("8.8.8.8"), experte = true))
    }

    @Test
    fun `die Einrichtung fragt nur fuer oeffentliche Namen nach`() {
        assertTrue(NetworkPolicy.klartextHost("http://Brick.Example.com:3000") == "brick.example.com")
        for (url in listOf("https://brick.example.com", "http://192.168.1.50:3000", "http://nas:3000", "http://8.8.8.8", ""))
            assertTrue("$url braucht keine Bestätigung", NetworkPolicy.klartextHost(url) == null)
    }

    // Gegenprobe (am 27.10. mit kotlinc gemessen): klartextNachAussen ohne die
    // isPrivateHost-Prüfung → rot, die Heimnetz-Adressen warnten mit.
    @Test
    fun `die Einrichtung warnt bei Klartext nach aussen, nicht im Heimnetz`() {
        for (url in listOf("http://brick.example.com", "http://203.0.113.5:3000", "HTTP://lego.example.org/brick"))
            assertTrue("$url muss warnen", NetworkPolicy.klartextNachAussen(url))
        for (url in listOf("https://brick.example.com", "http://192.168.1.50:3000", "http://nas:3000",
                           "http://brick.fritz.box", "http://localhost:3000", "", "kein url"))
            assertFalse("$url darf nicht warnen", NetworkPolicy.klartextNachAussen(url))
    }

    @Test
    fun `die Herkunft eines Tokens ist Schema, Host und Port`() {
        assertEquals("https://brick.example.com:443", NetworkPolicy.herkunft("https://Brick.example.com/brick/"))
        assertTrue(NetworkPolicy.gleicheHerkunft("http://nas:3000", "http://NAS:3000/"))
        assertFalse(NetworkPolicy.gleicheHerkunft("http://nas:3000", "http://nas:3001"))
        assertFalse(NetworkPolicy.gleicheHerkunft("http://nas:3000", "https://nas:3000"))
        assertFalse("Eine leere Adresse ist kein Server", NetworkPolicy.gleicheHerkunft("", ""))
    }

    @Test
    fun `nur ein Passwort im Klartext in einem unbekannten Netz braucht die Rueckfrage`() {
        val bekannt = setOf(NetworkPolicy.netzEintrag("http://nas:3000", "heim"))
        assertFalse(NetworkPolicy.anmeldungBrauchtNetzBestaetigung("http://nas:3000", "heim", bekannt))
        assertTrue(NetworkPolicy.anmeldungBrauchtNetzBestaetigung("http://nas:3000", "hotel", bekannt))
        assertTrue("Ohne Kennung ist das Netz unbekannt",
            NetworkPolicy.anmeldungBrauchtNetzBestaetigung("http://nas:3000", null, bekannt))
        assertFalse(NetworkPolicy.anmeldungBrauchtNetzBestaetigung("https://nas:3000", "hotel", emptySet()))
        assertFalse("Das Gerät selbst ist kein fremder Rechner",
            NetworkPolicy.anmeldungBrauchtNetzBestaetigung("http://127.0.0.1:3000", null, emptySet()))
    }
}
