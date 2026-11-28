package ch.brickinventoryapp.data

import android.app.Application
import android.os.Build
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.data.di.NetworkStores
import ch.brickinventoryapp.data.di.buildInterceptorClient
import ch.brickinventoryapp.data.testing.testTrustCipher
import ch.brickinventoryapp.data.util.AppCompatLanguage
import ch.brickinventoryapp.security.CertificateQuestion
import ch.brickinventoryapp.security.CertificateUnresolved
import ch.brickinventoryapp.security.TokenEncryption
import ch.brickinventoryapp.security.fingerprintReadable
import ch.brickinventoryapp.security.sheetPinKey
import ch.brickinventoryapp.security.spkiFingerprint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.io.IOException
import java.security.KeyFactory
import java.security.KeyStore
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.security.spec.PKCS8EncodedKeySpec
import java.util.Base64
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext

/**
 * On Android 16 (API 36) the app's own TLS path asks exactly as below it: a first contact and a
 * new server key under a public root only count with the fingerprint typed in. The API client is
 * built as NetworkModule builds it; the "system" roots are a trust store with one test root,
 * so the chain is publicly valid for the system check.
 *
 * Counter-check (counter-checks/api36-first-contact-one-tap.patch): transcriptNeeded for
 * FIRST_CONTACT and KEY_NEW again `SDK_INT < 36` → red “on API 36 first contact and a new server
 * key …” (“a tap is not enough on first contact”).
 *
 * The trust manager is shared per process (ServerClient.trustServer); Robolectric keeps one per
 * API level, so this class must stay the only one on API 36 and runs as one test.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class ServerTrustApi36Test {

    private val ctx = ApplicationProvider.getApplicationContext<Application>()
    private val area = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val folder = File(System.getProperty("java.io.tmpdir"), "bim-api36-${System.nanoTime()}").apply { mkdirs() }
    private val saved = PROPERTIES.associateWith { System.getProperty(it) }
    private var server = MockWebServer()
    private val question = CertificateQuestion()

    private object PlainVault : TokenEncryption {
        override fun encrypt(plaintext: String) = plaintext
        override fun decrypt(saved: String) = saved
    }

    /** The system CAs of this run: only [PUB_ROOT], read by TrustManagerFactory.init(null). */
    @Before
    fun systemRoot() {
        val roots = File(folder, "roots.jks")
        KeyStore.getInstance("JKS").apply {
            load(null)
            setCertificateEntry("root", cert(PUB_ROOT))
            roots.outputStream().use { store(it, PW) }
        }
        System.setProperty("javax.net.ssl.trustStore", roots.path)
        System.setProperty("javax.net.ssl.trustStoreType", "JKS")
        System.setProperty("javax.net.ssl.trustStorePassword", String(PW))
    }

    @After
    fun tearDown() {
        saved.forEach { (k, v) -> if (v == null) System.clearProperty(k) else System.setProperty(k, v) }
        area.cancel()
        runCatching { server.shutdown() }
        folder.deleteRecursively()
    }

    private lateinit var tokens: TokenStore

    private val network: NetworkStores by lazy {
        runBlocking {
            val store = PreferenceDataStoreFactory.create { File(ctx.filesDir, "api36-${System.nanoTime()}.preferences_pb") }
            val device = DevicesStore(ctx, store, testTrustCipher())
            tokens = TokenStore(store, PlainVault, device, area).also { it.waitOnStart() }
            NetworkStores(tokens, device)
        }
    }

    private val client: OkHttpClient by lazy {
        buildInterceptorClient(network, isApiClient = true, sessionExpired = SessionExpiredSignal(), ctx = ctx, appLanguage = AppCompatLanguage(),
            question = question)
    }

    /** Serves [leaf] with its intermediate and points the app at it. */
    private fun launch(leafKey: String, chain: List<String>) {
        val ks = KeyStore.getInstance("PKCS12").apply { load(null) }
        val key = KeyFactory.getInstance("EC").generatePrivate(PKCS8EncodedKeySpec(Base64.getDecoder().decode(leafKey)))
        ks.setKeyEntry("k", key, PW, chain.map { cert(it) }.toTypedArray())
        val kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm()).apply { init(ks, PW) }
        server = MockWebServer()
        server.useHttps(SSLContext.getInstance("TLS").apply { init(kmf.keyManagers, null, null) }.socketFactory, false)
        repeat(2) { server.enqueue(MockResponse().setBody("ok")) }
        server.start()
        network
        runBlocking { tokens.saveServerUrl(server.url("/").toString()) }
    }

    private fun own() = "${server.url("/").host}:${server.port}"

    private fun fetch(): Boolean = try {
        client.newCall(Request.Builder().url(server.url("/api/v2/sets")).build()).execute().use { it.isSuccessful }
    } catch (_: IOException) { false }

    private fun copied() = fingerprintReadable(question.open.value!!.fingerprint).takeLast(35)

    @Test
    fun `on API 36 first contact and a new server key need the transcript, a tap is not enough`() {
        assertEquals(36, Build.VERSION.SDK_INT)
        launch(PUB_SHEET_A_KEY, listOf(PUB_SHEET_A, PUB_ZW_A))
        assertFalse(fetch())
        assertEquals("nothing reached the server", 0, server.requestCount)
        val first = question.open.value!!
        assertEquals(CertificateUnresolved.Kind.FIRST_CONTACT, first.kind)
        assertEquals(spkiFingerprint(cert(PUB_ROOT)), first.fingerprint)
        assertTrue(first.transcriptNeeded)
        assertFalse("a tap is not enough on first contact", question.confirm(network.trust))
        assertNull("nothing remembered after the tap", network.trust.pin(own()))
        assertTrue(question.confirm(network.trust, copied()))
        assertTrue("after the transcript the server is trusted", fetch())

        // The same server restarted on another port, now with a different key under the same root.
        val root = network.trust.pin(own())!!
        val leaf = network.trust.pin(sheetPinKey(own()))!!
        server.shutdown()
        launch(PUB_SHEET_B_KEY, listOf(PUB_SHEET_B, PUB_ZW_B))
        network.trust.rememberPin(own(), root)
        network.trust.rememberPin(sheetPinKey(own()), leaf)
        assertFalse(fetch())
        val changed = question.open.value!!
        assertEquals(CertificateUnresolved.Kind.KEY_NEW, changed.kind)
        assertTrue(changed.transcriptNeeded)
        assertFalse("a tap is not enough for a new server key", question.confirm(network.trust))
        assertEquals(leaf, network.trust.pin(sheetPinKey(own())))
        assertTrue(question.confirm(network.trust, copied()))
        assertTrue(fetch())
    }

    private companion object {
        val PW = "test".toCharArray()
        val PROPERTIES = listOf("javax.net.ssl.trustStore", "javax.net.ssl.trustStoreType", "javax.net.ssl.trustStorePassword")
        fun cert(b64: String): X509Certificate = CertificateFactory.getInstance("X.509")
            .generateCertificate(Base64.getDecoder().decode(b64).inputStream()) as X509Certificate

        // Test chains from CertificatePinTest: a public root, two intermediates, two leaves for localhost.
        const val PUB_ROOT = "MIIBpDCCAUmgAwIBAgIUZIFCnfxNIQRpMPTNwW7BSSFDv80wCgYIKoZIzj0EAwIwHjEcMBoGA1UEAwwTT2VmZmVudGxpY2hlIFd1cnplbDAgFw0yNjExMDExNTU3MDdaGA8yMTI2MTAwODE1NTcwN1owHjEcMBoGA1UEAwwTT2VmZmVudGxpY2hlIFd1cnplbDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABMYW+yzOBBNjAat0l/sP4W3ZgRVDK5kCmFCH5Dv7185TkPr5k7scjn/974EXTVvZDYU1LPsZmW3gXy0FNGysUC+jYzBhMB0GA1UdDgQWBBRCHCEEa57KCCRJiaZxWSJ9GDEjCTAfBgNVHSMEGDAWgBRCHCEEa57KCCRJiaZxWSJ9GDEjCTAPBgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBBjAKBggqhkjOPQQDAgNJADBGAiEAp6GVM9JkGHL6UnRaaidFdJ2KXTkT5dVarFiyfXTEfDACIQDl6sX2VT243lSNJtFFpU3znF+GxV7T8KstC/lIGpQA/g=="
        const val PUB_ZW_A = "MIIBoDCCAUagAwIBAgIUAQU1sXdBgqFF38Hi+ijuOG1hvwYwCgYIKoZIzj0EAwIwHjEcMBoGA1UEAwwTT2VmZmVudGxpY2hlIFd1cnplbDAgFw0yNjExMDExNTU3MDdaGA8yMTI2MTAwODE1NTcwN1owGzEZMBcGA1UEAwwQWndpc2NoZW5zdGVsbGUgYTBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABOWdioVQKAOBRw6UiEyIXBhIl95junXb8p6oGzTDkKJWw4zE7efq82EiL0JrvnkWQziXaTCAzYqVk3xnwHqv4KSjYzBhMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMB0GA1UdDgQWBBTQ5IolVueozviLke93UtJ6G3Y0EDAfBgNVHSMEGDAWgBRCHCEEa57KCCRJiaZxWSJ9GDEjCTAKBggqhkjOPQQDAgNIADBFAiEA/5LLzEGDA7tkDnrGKtFmUDSyWyNizCD47OaVWdjPKjsCIFH/YtymGArW/cxrFfMpLjvPzmV3bh2fen18oGROYQLj"
        const val PUB_ZW_B = "MIIBnzCCAUagAwIBAgIUAQU1sXdBgqFF38Hi+ijuOG1hvwcwCgYIKoZIzj0EAwIwHjEcMBoGA1UEAwwTT2VmZmVudGxpY2hlIFd1cnplbDAgFw0yNjExMDExNTU3MDdaGA8yMTI2MTAwODE1NTcwN1owGzEZMBcGA1UEAwwQWndpc2NoZW5zdGVsbGUgYjBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABDEgpbf+s6SGWZj/quaQtakWiv4xWus5vjua3ax1UXeC9LoJh5UtlfkGbQ2wXR3EFesZjh3BGkrJhJY0asO6VkijYzBhMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMB0GA1UdDgQWBBQ/oP7MODYtWp9Gyzs6MtDPBmJIMDAfBgNVHSMEGDAWgBRCHCEEa57KCCRJiaZxWSJ9GDEjCTAKBggqhkjOPQQDAgNHADBEAiAK9OlzxqHfohUqtdRNpFUoOF4gPAqXPhPhlObB0JtBgQIgIZ0y638KPcdq6B1hVzLB3YARfLe32J/MhJExn8bcWKk="
        const val PUB_SHEET_A = "MIIBxjCCAWygAwIBAgIUEBLGo7NHqNVaaJN74wAlRIwi4W4wCgYIKoZIzj0EAwIwGzEZMBcGA1UEAwwQWndpc2NoZW5zdGVsbGUgYTAgFw0yNjExMDExNTU3MDdaGA8yMTI2MTAwODE1NTcwN1owFDESMBAGA1UEAwwJbG9jYWxob3N0MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEjqRhSfxnpKW8SVpXa+tPaRt6Vlwq2CmtlrBmms1LDiwh0W5nor0jmmIAf+DK2BrKpAgzdtTPsylxmTjIGpnezqOBkjCBjzAMBgNVHRMBAf8EAjAAMA4GA1UdDwEB/wQEAwIHgDATBgNVHSUEDDAKBggrBgEFBQcDATAaBgNVHREEEzARgglsb2NhbGhvc3SHBH8AAAEwHQYDVR0OBBYEFOw0VRfHzwggapzdIqYWyzwb8jflMB8GA1UdIwQYMBaAFNDkiiVW56jO+IuR73dS0nobdjQQMAoGCCqGSM49BAMCA0gAMEUCIQDYuBBmG4miA9O95DWJ35JamLrl6Hiz9MlCl3EzYekrRwIgebgFsZ6Ob4etGqT4Bk/zA2N4eMcO9yAtUeQrQ04sNsU="
        const val PUB_SHEET_A_KEY = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgHVYb+/H8EyhvizzUS3y9TAt7FlkQtQTQ67/8+ih/YaihRANCAASOpGFJ/GekpbxJWldr609pG3pWXCrYKa2WsGaazUsOLCHRbmeivSOaYgB/4MrYGsqkCDN21M+zKXGZOMgamd7O"
        const val PUB_SHEET_B = "MIIBxjCCAWygAwIBAgIUMZo/EI4H/XOHp4BTSLv9bt1IR58wCgYIKoZIzj0EAwIwGzEZMBcGA1UEAwwQWndpc2NoZW5zdGVsbGUgYjAgFw0yNjExMDExNTU3MDdaGA8yMTI2MTAwODE1NTcwN1owFDESMBAGA1UEAwwJbG9jYWxob3N0MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE2E8WBySJmiIWknMzbepPni3bP68iZpP3c2WwBCqoEMZb8ppgaIFnfP4x8FfQwxmbblOfnAK9qIpIMMOKcqJLhKOBkjCBjzAMBgNVHRMBAf8EAjAAMA4GA1UdDwEB/wQEAwIHgDATBgNVHSUEDDAKBggrBgEFBQcDATAaBgNVHREEEzARgglsb2NhbGhvc3SHBH8AAAEwHQYDVR0OBBYEFG5BwbuRc8QPiyQocRkuaHnm7J03MB8GA1UdIwQYMBaAFD+g/sw4Ni1an0bLOzoy0M8GYkgwMAoGCCqGSM49BAMCA0gAMEUCIQCvJtbBc2pqUGlh8evmznKK1G/O8iW531jJlET2gYW5KwIgDINFCTJgae8SPreE2VipqiyzSncwBRglIT3Sw1EcC6M="
        const val PUB_SHEET_B_KEY = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg7LsVCGLBPHR5qR7tBe+zQWeT/RemLJNrPJ7SFpGNHwyhRANCAATYTxYHJImaIhaSczNt6k+eLds/ryJmk/dzZbAEKqgQxlvymmBogWd8/jHwV9DDGZtuU5+cAr2oikgww4pyokuE"
    }
}
