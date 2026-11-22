package ch.brickinventoryapp.data

import ch.brickinventoryapp.security.trustJob
import ch.brickinventoryapp.security.spkiFingerprint
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test
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
 * The deferred invalidation after a server switch checks the old server with
 * its pin, via real TLS: the old server has its own CA, like
 * the typical home server; the set-up one is a different one by now. The
 * certificates are the same fixed test data as in CertificatePinTest.
 *
 * Counter-checks:
 *   A  trustJob() with `ownServer = { null }` (the old server counts as
 *      foreign host, only system CAs — the older state) → red “the old server with
 *      its own CA is reached with its pin” (LATER instead of ENTWERTET);
 *      counter-checks/entwertung-ohne-alten-pin.patch
 *   B  in the canceller the rejection neither remembered (RemembersRejection) nor searched in the
 *      cause chain (LATER for every IOException) → red “a different
 *      key under the pin gets no token …”. In CI (Conscrypt in the
 *      same JVM) the search in the cause chain alone was not enough.
 */
class OldServerPinTest {

    private val server = MockWebServer()

    @After
    fun tearDown() = server.shutdown()

    private fun launch(key: String, chain: List<String>) {
        val ks = KeyStore.getInstance("PKCS12").apply { load(null) }
        val key = KeyFactory.getInstance("EC").generatePrivate(PKCS8EncodedKeySpec(Base64.getDecoder().decode(key)))
        ks.setKeyEntry("k", key, PW, chain.map { cert(it) }.toTypedArray())
        val kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm()).apply { init(ks, PW) }
        server.useHttps(SSLContext.getInstance("TLS").apply { init(kmf.keyManagers, null, null) }.socketFactory, false)
        server.enqueue(MockResponse().setBody("""{"success":true}"""))
        server.start()
    }

    /** The „system“: knows only a public root, not the old server's CA. */
    private val system: X509ExtendedTrustManager by lazy {
        val ks = KeyStore.getInstance("PKCS12").apply { load(null) }
        ks.setCertificateEntry("w", cert(ROOT))
        TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
            .apply { init(ks) }.trustManagers.filterIsInstance<X509ExtendedTrustManager>().first()
    }

    /** As NetworkModule builds it: one trust per job for its server and pin. */
    private val redeemer = Redeemer(
        OkHttpClient.Builder().connectTimeout(2, TimeUnit.SECONDS).readTimeout(2, TimeUnit.SECONDS).build(),
        development = false,
        trustFor = { key, pin -> trustJob(system, system, key, pin) },
    )

    private fun oldServer() = server.url("/brick").toString().trimEnd('/')

    @Test
    fun `the old server with its own CA is reached with its pin`() {
        launch(ROOT_SHEET_KEY, listOf(ROOT_SHEET, CADDY_ROOT))
        val pin = spkiFingerprint(cert(CADDY_ROOT))
        assertEquals(RedemptionOutcome.REDEEMED, redeemer.redeem(oldServer(), "altes-token", pin))
        val a = server.takeRequest(1, TimeUnit.SECONDS)!!
        assertEquals("/brick/api/v1/auth/logout", a.path)
        assertEquals("Bearer altes-token", a.getHeader("Authorization"))
    }

    @Test
    fun `a different key under the pin gets no token, and waiting does not help`() {
        // A publicly valid certificate (system knows ROOT) is not enough where the pin requires the own CA.
        launch(LEAF_KEY, listOf(LEAF, INTER))
        val pin = spkiFingerprint(cert(CADDY_ROOT))
        assertEquals(RedemptionOutcome.GIVE_UP, redeemer.redeem(oldServer(), "altes-token", pin))
        assertEquals("Keine Anfrage darf den Server erreichen", 0, server.requestCount)
    }

    @Test
    fun `without a pin the token goes nowhere`() {
        launch(LEAF_KEY, listOf(LEAF, INTER))
        assertEquals(RedemptionOutcome.GIVE_UP, redeemer.redeem(oldServer(), "altes-token", null))
        assertEquals(0, server.requestCount)
    }

    private companion object {
        val PW = "test".toCharArray()
        fun cert(b64: String): X509Certificate = CertificateFactory.getInstance("X.509")
            .generateCertificate(Base64.getDecoder().decode(b64).inputStream()) as X509Certificate

        const val ROOT = "MIIBlTCCATugAwIBAgIUCbgn7Upu9fEAMGToKKauXo+baGUwCgYIKoZIzj0EAwIwFzEVMBMGA1UEAwwMQnJpY2sgV3VyemVsMCAXDTI2MTAzMDE1NDI1OFoYDzIxMjYxMDA2MTU0MjU4WjAXMRUwEwYDVQQDDAxCcmljayBXdXJ6ZWwwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAR8FJcl3BEyvVpJgfQ/T5qw/+pweuS6179KUZKyiCZGxiBp5q11Lyk/Z/qZ3lYWC8vf5F1vn/BNqU7bbKB3HhkPo2MwYTAdBgNVHQ4EFgQUXGDtWh02N49g+YF9OEkqvnoC1EgwHwYDVR0jBBgwFoAUXGDtWh02N49g+YF9OEkqvnoC1EgwDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMCAQYwCgYIKoZIzj0EAwIDSAAwRQIhALnFIf/TxItrcCD4WHUT6D3XfqsMqHQ8Rx7Qjc7304s4AiADtT8yG+NtvZHTDM/cmC/eJWf/LsA1xnJTA5yXuGlxzg=="
        const val INTER = "MIIBlzCCAT2gAwIBAgIUQyjZ8Us4p6zbuUu9OD8NEe+rg0IwCgYIKoZIzj0EAwIwFzEVMBMGA1UEAwwMQnJpY2sgV3VyemVsMCAXDTI2MTAzMDE1NDI1OFoYDzIxMjYxMDA2MTU0MjU4WjAZMRcwFQYDVQQDDA5CcmljayBad2lzY2hlbjBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABKHmNbAOfGEGwyrPGQynBjdkBGW5x/8pNc/Lcpad3cW5GqsvY5WChv5QSJhnj/3jWqC/9hIcIgoOR6w1OsgpN16jYzBhMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMB0GA1UdDgQWBBS/HkuEroFohODqD2wk4HPnlSdDQDAfBgNVHSMEGDAWgBRcYO1aHTY3j2D5gX04SSq+egLUSDAKBggqhkjOPQQDAgNIADBFAiAb/nz4SUy5/d2t/ci7w0eBD9c7HadJ4CcVtCs4ugUuFwIhAJAxMmuBap9q2jYYNRmSymGdOBt78fT12KETYQ4uWnaO"
        const val LEAF = "MIIBxDCCAWqgAwIBAgIUGKFt31uRyQEpo2/dyXJUnyNBQvQwCgYIKoZIzj0EAwIwGTEXMBUGA1UEAwwOQnJpY2sgWndpc2NoZW4wIBcNMjYxMDMwMTU0MjU4WhgPMjEyNjEwMDYxNTQyNThaMBQxEjAQBgNVBAMMCWxvY2FsaG9zdDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABMRphX3E9F+1CxrClvKYvhQLC1GyRMM0KV6hemBqhqJ4ErxTmWWsCmCaLxc9ai0HRRVGcwRaTUYN2zwUwOruxrqjgZIwgY8wDAYDVR0TAQH/BAIwADAOBgNVHQ8BAf8EBAMCB4AwEwYDVR0lBAwwCgYIKwYBBQUHAwEwGgYDVR0RBBMwEYIJbG9jYWxob3N0hwR/AAABMB8GA1UdIwQYMBaAFL8eS4SugWiE4OoPbCTgc+eVJ0NAMB0GA1UdDgQWBBTYiTrV8idg50suxhBOzVR4ehDuXjAKBggqhkjOPQQDAgNIADBFAiEAqVWMQNoCR/Qv0iDKhwjlSmbIpcj4QkkvEwOLQJjmWVkCIHbT27kp+E5rJEcyBRHjRi8lrrqHGMcGJY3hZQXm0rOc"
        const val LEAF_KEY = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg84oF2kTvPuV0IbWxEBoJyR56Fy+0F8JahbFGp5BLWNyhRANCAATEaYV9xPRftQsawpbymL4UCwtRskTDNCleoXpgaoaieBK8U5llrApgmi8XPWotB0UVRnMEWk1GDds8FMDq7sa6"
        const val CADDY_ROOT = "MIIBlTCCATugAwIBAgIUWfsD4SFXkS/uYDWYXA+OWZbAS0owCgYIKoZIzj0EAwIwFzEVMBMGA1UEAwwMQ2FkZHkgV3VyemVsMCAXDTI2MTAzMDIyMjg0NFoYDzIxMjYxMDA2MjIyODQ0WjAXMRUwEwYDVQQDDAxDYWRkeSBXdXJ6ZWwwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAASudcnAk+7NFzlNgXJlzLpv1WNLgSrYkYdxzHKOI9CAGktSDWCmqhJfXKbJezy/XJtJhb8No+g98CcCX+K4RZ7wo2MwYTAdBgNVHQ4EFgQULpDKa+iFWhIS/Vl4s94pdZYH43QwHwYDVR0jBBgwFoAULpDKa+iFWhIS/Vl4s94pdZYH43QwDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMCAQYwCgYIKoZIzj0EAwIDSAAwRQIgDuvgqOOE7zjj0LE3ZMADdJ6CbM9zLc9uZyPLXQIcJ24CIQDvseM//f4Ymtat2eDiE0guayf6MFBXQwVmUEAs/h5jsA=="
        const val ROOT_SHEET = "MIIBwjCCAWigAwIBAgIUJ5bQK16akXTtVJGiddkeeCeimhAwCgYIKoZIzj0EAwIwFzEVMBMGA1UEAwwMQ2FkZHkgV3VyemVsMCAXDTI2MTAzMDIyMjg0NFoYDzIxMjYxMDA2MjIyODQ0WjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAQkCXdFDKqjNGrBKlNNRxL4eL+CDWRzYEeNTxLPedxdqAmZELd0QILkTpIU3gnrMSNC92sr9JqJMj6bI6rbtqwHo4GSMIGPMAwGA1UdEwEB/wQCMAAwDgYDVR0PAQH/BAQDAgeAMBMGA1UdJQQMMAoGCCsGAQUFBwMBMBoGA1UdEQQTMBGCCWxvY2FsaG9zdIcEfwAAATAdBgNVHQ4EFgQUAZczQX6xjqiWuzi8ceAiL8aMRSgwHwYDVR0jBBgwFoAULpDKa+iFWhIS/Vl4s94pdZYH43QwCgYIKoZIzj0EAwIDSAAwRQIhAIDDuQsj3wEuClpl1bZMDbJQ1fnXG3pDWbfkcK9Nbkj1AiAoe+I71U9V5jog/wz5Y5bOc2YbEAw1q+grLMsqMP1jUA=="
        const val ROOT_SHEET_KEY = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgqZs7tPJIE6CpMc2pY0PdwG3yxUHoNpKYXMHNMTymB+KhRANCAAQkCXdFDKqjNGrBKlNNRxL4eL+CDWRzYEeNTxLPedxdqAmZELd0QILkTpIU3gnrMSNC92sr9JqJMj6bI6rbtqwH"
    }
}
