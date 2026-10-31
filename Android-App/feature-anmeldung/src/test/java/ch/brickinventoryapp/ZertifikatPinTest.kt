package ch.brickinventoryapp

import ch.brickinventoryapp.ui.parseQrPayload
import ch.brickinventoryapp.util.PinAblage
import ch.brickinventoryapp.util.PinVertrauen
import ch.brickinventoryapp.util.ZertifikatUngeklaert
import ch.brickinventoryapp.util.ZertifikatsFrage
import ch.brickinventoryapp.util.passtZumPin
import ch.brickinventoryapp.util.pinSchluessel
import ch.brickinventoryapp.util.spkiFingerabdruck
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import java.security.KeyFactory
import java.security.KeyStore
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.security.spec.PKCS8EncodedKeySpec
import java.util.Base64
import java.util.concurrent.TimeUnit
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509ExtendedTrustManager

/**
 * Pinning des eigenen Servers, über echtes TLS gegen einen Testserver: Wurzel →
 * Zwischenstelle → Blatt „localhost“, dazu ein fremdes selbst signiertes Blatt.
 * Die Zertifikate sind feste Testdaten (100 Jahre gültig).
 *
 * Gegenproben (30.10.2026, gemessen gegen util/ServerVertrauen.kt):
 *   A  in pruefe() ohne Pin `return kettenPruefung()` statt nachzufragen → rot
 *      „ohne Pin geht beim ersten Kontakt nichts hinaus“
 *   B  passtZumPin() nur `indexOfFirst >= 0` (ohne Pfadprüfung) → rot „ein
 *      fremdes Blatt mit angehängter echter Zwischenstelle passt nicht“
 *   C  bei abweichendem Pin `return` statt zu melden → rot „ein anderer
 *      Schlüssel unter dem gemerkten Pin wird nicht still angenommen“
 *   D  der Vergleich mit eigenerServer() entfernt (alle Hosts gepinnt) → rot
 *      „fremde Hosts prüft nur die Kette“
 *   E  parseQrPayload() übernimmt ein unlesbares fp → rot „ein QR-Code mit
 *      unlesbarem Fingerabdruck gilt nicht“
 */
class ZertifikatPinTest {

    private val server = MockWebServer()
    private val frage = ZertifikatsFrage()
    private val pins = object : PinAblage {
        val map = mutableMapOf<String, String>()
        override fun pin(schluessel: String) = map[schluessel]
        override fun merkePin(schluessel: String, fingerabdruck: String) { map[schluessel] = fingerabdruck }
    }

    @After
    fun zu() = server.shutdown()

    /** Der Server zeigt Blatt und Zwischenstelle, wie Caddy es tut. */
    private fun starte(schluessel: String = LEAF_KEY, kette: List<String> = listOf(LEAF, INTER)) {
        val ks = KeyStore.getInstance("PKCS12").apply { load(null) }
        val key = KeyFactory.getInstance("EC").generatePrivate(PKCS8EncodedKeySpec(Base64.getDecoder().decode(schluessel)))
        ks.setKeyEntry("k", key, PW, kette.map { zert(it) }.toTypedArray())
        val kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm()).apply { init(ks, PW) }
        server.useHttps(SSLContext.getInstance("TLS").apply { init(kmf.keyManagers, null, null) }.socketFactory, false)
        server.enqueue(MockResponse().setBody("ok"))
        server.enqueue(MockResponse().setBody("ok"))
        server.start()
    }

    /** Das „System“: vertraut nur den genannten Wurzeln. */
    private fun system(vararg wurzeln: String): X509ExtendedTrustManager {
        val ks = KeyStore.getInstance("PKCS12").apply { load(null) }
        wurzeln.forEachIndexed { i, w -> ks.setCertificateEntry("w$i", zert(w)) }
        return TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
            .apply { init(ks) }.trustManagers.filterIsInstance<X509ExtendedTrustManager>().first()
    }

    private fun eigener() = "${server.url("/").host}:${server.port}"

    private fun hole(kette: X509ExtendedTrustManager, eigen: String = eigener()): Boolean {
        val tm = PinVertrauen(kette, pins, eigenerServer = { eigen }, frage = frage)
        val ctx = SSLContext.getInstance("TLS").apply { init(null, arrayOf(tm), null) }
        val c = OkHttpClient.Builder().sslSocketFactory(ctx.socketFactory, tm)
            .connectTimeout(2, TimeUnit.SECONDS).readTimeout(2, TimeUnit.SECONDS).build()
        return try {
            c.newCall(Request.Builder().url(server.url("/api/v1/sets")).build()).execute().use { it.isSuccessful }
        } catch (_: IOException) { false }
    }

    @Test
    fun `ohne Pin geht beim ersten Kontakt nichts hinaus, gefragt wird nach dem Fingerabdruck`() {
        starte()
        assertFalse(hole(system(ROOT)))
        assertEquals("Keine Anfrage darf den Server erreichen", 0, server.requestCount)
        val f = frage.offen.value!!
        assertEquals(ZertifikatUngeklaert.Art.ERSTKONTAKT, f.art)
        assertEquals(spkiFingerabdruck(zert(LEAF)), f.fingerabdruck)
        assertEquals(eigener(), f.schluessel)

        frage.bestaetige(pins)
        assertNull(frage.offen.value)
        assertTrue("Nach der Bestätigung gilt der Pin", hole(system(ROOT)))
    }

    @Test
    fun `nach der Bestaetigung gilt der Pin auch ohne bekannte CA`() {
        starte()
        assertFalse(hole(system(FREMD)))
        assertEquals(ZertifikatUngeklaert.Art.UNBEKANNTE_CA, frage.offen.value?.art)
        frage.bestaetige(pins)
        assertTrue(hole(system(FREMD)))
        assertEquals(1, server.requestCount)
    }

    @Test
    fun `ein anderer Schluessel unter dem gemerkten Pin wird nicht still angenommen`() {
        starte()
        pins.merkePin(eigener(), spkiFingerabdruck(zert(FREMD)))
        assertFalse(hole(system(ROOT)))
        val f = frage.offen.value!!
        assertEquals(ZertifikatUngeklaert.Art.GEAENDERT, f.art)
        assertEquals(spkiFingerabdruck(zert(FREMD)), f.erwartet)
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `der Pin einer Zwischenstelle aus dem QR-Code deckt das Blatt ohne bekannte CA`() {
        starte()
        pins.merkePin(eigener(), spkiFingerabdruck(zert(INTER)))
        assertTrue(hole(system(FREMD)))
        assertNull(frage.offen.value)
    }

    /**
     * Caddy mit `sign_with_root`: Die Kette ist Blatt + Wurzel, und der QR-Code
     * trägt den Fingerabdruck der WURZEL. Sie genügt als Pin.
     * Gegenprobe (30.10.2026, gemessen): in passtZumPin nur das Blatt prüfen
     * (`indexOfFirst { … }` → `if (spkiFingerabdruck(chain[0]) == pin) 0 else -1`) → rot.
     */
    @Test
    fun `die Wurzel aus dem QR-Code genuegt als Pin, wenn die Kette Blatt und Wurzel ist`() {
        starte(WURZEL_BLATT_KEY, listOf(WURZEL_BLATT, WURZEL))
        pins.merkePin(eigener(), spkiFingerabdruck(zert(WURZEL)))
        assertTrue(hole(system(FREMD)))
        assertNull(frage.offen.value)
        assertFalse(passtZumPin(arrayOf(zert(FREMD), zert(WURZEL)), spkiFingerabdruck(zert(WURZEL))))
    }

    @Test
    fun `ein fremdes Blatt mit angehaengter echter Zwischenstelle passt nicht`() {
        val pin = spkiFingerabdruck(zert(INTER))
        assertTrue(passtZumPin(arrayOf(zert(LEAF), zert(INTER)), pin))
        assertFalse(passtZumPin(arrayOf(zert(FREMD), zert(INTER)), pin))
        assertFalse(passtZumPin(arrayOf(zert(LEAF), zert(INTER)), spkiFingerabdruck(zert(FREMD))))
    }

    @Test
    fun `fremde Hosts prueft nur die Kette`() {
        starte()
        assertTrue(hole(system(ROOT), eigen = "brick.example.org:443"))
        assertNull(frage.offen.value)
        assertFalse(hole(system(FREMD), eigen = "brick.example.org:443"))
        assertNull("Für fremde Hosts gibt es nichts zu bestätigen", frage.offen.value)
    }

    @Test
    fun `der Pin gilt je Host und Port, nur fuer https`() {
        assertEquals("brick.example.org:443", pinSchluessel("https://Brick.Example.org/"))
        assertEquals("nas:8443", pinSchluessel("https://nas:8443/brick"))
        assertNull(pinSchluessel("http://nas:3000"))
    }

    @Test
    fun `ein QR-Code traegt den Fingerabdruck mit`() {
        val fp = spkiFingerabdruck(zert(LEAF))
        val p = parseQrPayload("""{"url":"https://nas:8443","token":"bim:abc","fp":"$fp"}""")!!
        assertEquals(fp, p.fingerabdruck)
        assertNull(parseQrPayload("""{"url":"https://nas:8443","token":"bim:abc"}""")!!.fingerabdruck)
    }

    @Test
    fun `ein QR-Code mit unlesbarem Fingerabdruck gilt nicht`() {
        assertNull(parseQrPayload("""{"url":"https://nas:8443","token":"bim:abc","fp":"kurz"}"""))
        val fp = spkiFingerabdruck(zert(LEAF))
        assertNull("Ein Pin über http ergibt nichts", parseQrPayload("""{"url":"http://nas:3000","token":"bim:abc","fp":"$fp"}"""))
        assertNull(parseQrPayload("""{"url":"https://nas","token":"fremd"}"""))
    }

    private companion object {
        val PW = "test".toCharArray()
        fun zert(b64: String): X509Certificate = CertificateFactory.getInstance("X.509")
            .generateCertificate(Base64.getDecoder().decode(b64).inputStream()) as X509Certificate

        const val ROOT = "MIIBlTCCATugAwIBAgIUCbgn7Upu9fEAMGToKKauXo+baGUwCgYIKoZIzj0EAwIwFzEVMBMGA1UEAwwMQnJpY2sgV3VyemVsMCAXDTI2MTAzMDE1NDI1OFoYDzIxMjYxMDA2MTU0MjU4WjAXMRUwEwYDVQQDDAxCcmljayBXdXJ6ZWwwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAR8FJcl3BEyvVpJgfQ/T5qw/+pweuS6179KUZKyiCZGxiBp5q11Lyk/Z/qZ3lYWC8vf5F1vn/BNqU7bbKB3HhkPo2MwYTAdBgNVHQ4EFgQUXGDtWh02N49g+YF9OEkqvnoC1EgwHwYDVR0jBBgwFoAUXGDtWh02N49g+YF9OEkqvnoC1EgwDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMCAQYwCgYIKoZIzj0EAwIDSAAwRQIhALnFIf/TxItrcCD4WHUT6D3XfqsMqHQ8Rx7Qjc7304s4AiADtT8yG+NtvZHTDM/cmC/eJWf/LsA1xnJTA5yXuGlxzg=="
        const val INTER = "MIIBlzCCAT2gAwIBAgIUQyjZ8Us4p6zbuUu9OD8NEe+rg0IwCgYIKoZIzj0EAwIwFzEVMBMGA1UEAwwMQnJpY2sgV3VyemVsMCAXDTI2MTAzMDE1NDI1OFoYDzIxMjYxMDA2MTU0MjU4WjAZMRcwFQYDVQQDDA5CcmljayBad2lzY2hlbjBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABKHmNbAOfGEGwyrPGQynBjdkBGW5x/8pNc/Lcpad3cW5GqsvY5WChv5QSJhnj/3jWqC/9hIcIgoOR6w1OsgpN16jYzBhMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMB0GA1UdDgQWBBS/HkuEroFohODqD2wk4HPnlSdDQDAfBgNVHSMEGDAWgBRcYO1aHTY3j2D5gX04SSq+egLUSDAKBggqhkjOPQQDAgNIADBFAiAb/nz4SUy5/d2t/ci7w0eBD9c7HadJ4CcVtCs4ugUuFwIhAJAxMmuBap9q2jYYNRmSymGdOBt78fT12KETYQ4uWnaO"
        const val LEAF = "MIIBxDCCAWqgAwIBAgIUGKFt31uRyQEpo2/dyXJUnyNBQvQwCgYIKoZIzj0EAwIwGTEXMBUGA1UEAwwOQnJpY2sgWndpc2NoZW4wIBcNMjYxMDMwMTU0MjU4WhgPMjEyNjEwMDYxNTQyNThaMBQxEjAQBgNVBAMMCWxvY2FsaG9zdDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABMRphX3E9F+1CxrClvKYvhQLC1GyRMM0KV6hemBqhqJ4ErxTmWWsCmCaLxc9ai0HRRVGcwRaTUYN2zwUwOruxrqjgZIwgY8wDAYDVR0TAQH/BAIwADAOBgNVHQ8BAf8EBAMCB4AwEwYDVR0lBAwwCgYIKwYBBQUHAwEwGgYDVR0RBBMwEYIJbG9jYWxob3N0hwR/AAABMB8GA1UdIwQYMBaAFL8eS4SugWiE4OoPbCTgc+eVJ0NAMB0GA1UdDgQWBBTYiTrV8idg50suxhBOzVR4ehDuXjAKBggqhkjOPQQDAgNIADBFAiEAqVWMQNoCR/Qv0iDKhwjlSmbIpcj4QkkvEwOLQJjmWVkCIHbT27kp+E5rJEcyBRHjRi8lrrqHGMcGJY3hZQXm0rOc"
        /** Nur für diesen Test erzeugt; schützt nichts. */
        /** Caddy sign_with_root: Blatt direkt von der Wurzel signiert (openssl, 30.10.2026). */
        const val WURZEL = "MIIBlTCCATugAwIBAgIUWfsD4SFXkS/uYDWYXA+OWZbAS0owCgYIKoZIzj0EAwIwFzEVMBMGA1UEAwwMQ2FkZHkgV3VyemVsMCAXDTI2MTAzMDIyMjg0NFoYDzIxMjYxMDA2MjIyODQ0WjAXMRUwEwYDVQQDDAxDYWRkeSBXdXJ6ZWwwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAASudcnAk+7NFzlNgXJlzLpv1WNLgSrYkYdxzHKOI9CAGktSDWCmqhJfXKbJezy/XJtJhb8No+g98CcCX+K4RZ7wo2MwYTAdBgNVHQ4EFgQULpDKa+iFWhIS/Vl4s94pdZYH43QwHwYDVR0jBBgwFoAULpDKa+iFWhIS/Vl4s94pdZYH43QwDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMCAQYwCgYIKoZIzj0EAwIDSAAwRQIgDuvgqOOE7zjj0LE3ZMADdJ6CbM9zLc9uZyPLXQIcJ24CIQDvseM//f4Ymtat2eDiE0guayf6MFBXQwVmUEAs/h5jsA=="
        const val WURZEL_BLATT = "MIIBwjCCAWigAwIBAgIUJ5bQK16akXTtVJGiddkeeCeimhAwCgYIKoZIzj0EAwIwFzEVMBMGA1UEAwwMQ2FkZHkgV3VyemVsMCAXDTI2MTAzMDIyMjg0NFoYDzIxMjYxMDA2MjIyODQ0WjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAQkCXdFDKqjNGrBKlNNRxL4eL+CDWRzYEeNTxLPedxdqAmZELd0QILkTpIU3gnrMSNC92sr9JqJMj6bI6rbtqwHo4GSMIGPMAwGA1UdEwEB/wQCMAAwDgYDVR0PAQH/BAQDAgeAMBMGA1UdJQQMMAoGCCsGAQUFBwMBMBoGA1UdEQQTMBGCCWxvY2FsaG9zdIcEfwAAATAdBgNVHQ4EFgQUAZczQX6xjqiWuzi8ceAiL8aMRSgwHwYDVR0jBBgwFoAULpDKa+iFWhIS/Vl4s94pdZYH43QwCgYIKoZIzj0EAwIDSAAwRQIhAIDDuQsj3wEuClpl1bZMDbJQ1fnXG3pDWbfkcK9Nbkj1AiAoe+I71U9V5jog/wz5Y5bOc2YbEAw1q+grLMsqMP1jUA=="
        const val WURZEL_BLATT_KEY = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgqZs7tPJIE6CpMc2pY0PdwG3yxUHoNpKYXMHNMTymB+KhRANCAAQkCXdFDKqjNGrBKlNNRxL4eL+CDWRzYEeNTxLPedxdqAmZELd0QILkTpIU3gnrMSNC92sr9JqJMj6bI6rbtqwH"
        const val LEAF_KEY = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg84oF2kTvPuV0IbWxEBoJyR56Fy+0F8JahbFGp5BLWNyhRANCAATEaYV9xPRftQsawpbymL4UCwtRskTDNCleoXpgaoaieBK8U5llrApgmi8XPWotB0UVRnMEWk1GDds8FMDq7sa6"
        const val FREMD = "MIIBmDCCAT6gAwIBAgIUBpLM0+8DZR9WqDw7DqtrEKH9KDswCgYIKoZIzj0EAwIwFDESMBAGA1UEAwwJbG9jYWxob3N0MCAXDTI2MTAzMDE1NDI1OFoYDzIxMjYxMDA2MTU0MjU4WjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAATSAfTFPtfDF3dy0bcjX8dCElM9oKs2NYwoZEyfWsb5EIpbYtqP7F6JCLbrsb7GVytdEqsatNJDifymfYNnIJPjo2wwajAdBgNVHQ4EFgQU5NOS8aVLD/bPQjWQ5foWE5AcTIQwHwYDVR0jBBgwFoAU5NOS8aVLD/bPQjWQ5foWE5AcTIQwGgYDVR0RBBMwEYIJbG9jYWxob3N0hwR/AAABMAwGA1UdEwEB/wQCMAAwCgYIKoZIzj0EAwIDSAAwRQIgD2hCTe+02K17PzDfV7EgrTEgIV1C99ShlLSwHZsc1IICIQCknNnfSKSNOc+Kilyyna8ag4H9A8XH9kfcAia1XVWbDg=="
    }
}
