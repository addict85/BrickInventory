package ch.brickinventoryapp.data

import android.app.Application
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.data.cache.VorschauSpeicher
import ch.brickinventoryapp.data.di.Netzablagen
import ch.brickinventoryapp.data.di.NetzModule
import ch.brickinventoryapp.data.di.buildInterceptorClient
import ch.brickinventoryapp.security.StoreCipher
import ch.brickinventoryapp.security.Ablageschluessel
import ch.brickinventoryapp.security.TokenEncryption
import ch.brickinventoryapp.security.CertificateQuestion
import ch.brickinventoryapp.network.di.ServerWaechter
import ch.brickinventoryapp.network.util.ImageHostGuard
import ch.brickinventoryapp.testing.testVertrauenschiffre
import coil3.request.ImageRequest
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
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * The clients to the own server, as NetzModule builds them, against a test server: none
 * follows redirects itself (the guard does that), the image client runs via the
 * host guard, throttles without starving a tile wall and has a
 * cache from which it delivers offline; the API client has none. Coil loads
 * via exactly this image client. Under Robolectric with a real store.
 *
 * Counter-checks (patches under gegenproben/, Robolectric, measured by CI):
 *   server-client-folgt-umleitung  followRedirects(false) in buildInterceptorClient removed → red “no server client …”
 *   bild-client-ohne-waechter      ImageHostGuard not hooked in → red “the image client talks …”
 *   bild-client-ohne-token         the ServerWaechter taken out of the image client → red “both clients …”
 *   bild-client-ohne-rueckfall     the FORCE_CACHE fallback keeps throwing → red “if the server is …”
 *   coil-ohne-bild-client          Coil without the image client's fetcher → red “Coil loads …”
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ServerClientsTest {

    private val ctx = ApplicationProvider.getApplicationContext<Application>()
    private val bereich = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val server = MockWebServer().apply { start() }

    /** Robolectric has no AndroidKeyStore; wrapping here is only for show. */
    private object Klartresor : TokenEncryption {
        override fun verschluessle(klartext: String) = klartext
        override fun entschluessle(gespeichert: String) = gespeichert
    }

    @After
    fun zu() {
        bereich.cancel()
        runCatching { server.shutdown() }
    }

    private val netz: Netzablagen by lazy {
        runBlocking {
            val store = PreferenceDataStoreFactory.create { File(ctx.filesDir, "clients-${System.nanoTime()}.preferences_pb") }
            val geraet = DevicesStore(ctx, store, testVertrauenschiffre())
            val token = TokenAblage(store, Klartresor, geraet, bereich).also { it.waitOnStart() }
            token.saveServerUrl(server.url("/").toString())
            Netzablagen(token, geraet)
        }
    }

    private fun apiClient() = buildInterceptorClient(netz, isApiClient = true, sessionExpired = SessionExpiredSignal(),
        ctx = ctx, frage = CertificateQuestion())

    private fun imageClient() = NetzModule.provideImageOkHttpClient(ctx, netz, SessionExpiredSignal(),
        VorschauSpeicher({ File(ctx.filesDir, "vorschau-clients") }, StoreCipher { ByteArray(32) { 2 } }, { ByteArray(32) { 12 } }),
        CertificateQuestion(), Ablageschluessel(File(ctx.noBackupFilesDir, "clients.schluessel"), Klartresor))

    private fun fetch(client: OkHttpClient, adresse: String) =
        client.newCall(Request.Builder().url(adresse).build()).execute().use { it.code to it.body.string() }

    @Test
    fun `no server client follows a redirect itself`() {
        for ((name, c) in listOf("api" to apiClient(), "bild" to imageClient())) {
            assertFalse("$name: OkHttp folgte Umleitungen am Wächter vorbei", c.followRedirects)
            assertFalse("$name: OkHttp folgte einer Umleitung von https auf http", c.followSslRedirects)
        }
    }

    /** The ServerWaechter attaches the token (ServerGuardTest); without it every image would load with 401. */
    @Test
    fun `both clients hook in the server guard`() {
        for ((name, c) in listOf("api" to apiClient(), "bild" to imageClient())) {
            assertTrue("$name: ohne ServerWaechter ginge kein Token mit", c.interceptors.any { it is ServerWaechter })
        }
    }

    @Test
    fun `the image client talks only via the host guard and throttles moderately`() {
        val bild = imageClient()
        assertTrue("Der Bild-Client lädt ohne Host-Wächter", bild.interceptors.any { it is ImageHostGuard })
        val perHost = bild.dispatcher.maxRequestsPerHost
        assertTrue("maxRequestsPerHost=$perHost ist zu eng für eine Kachelwand", perHost >= 6)
        assertTrue("maxRequests=${bild.dispatcher.maxRequests} ist keine bewusste Drosselung",
            bild.dispatcher.maxRequests in perHost..32)
        assertNotNull("Der Bild-Client hat keinen Zwischenspeicher", bild.cache)
        assertNull("Der API-Client hat einen Zwischenspeicher: Eine Änderung könnte aus ihm beantwortet werden",
            apiClient().cache)
    }

    @Test
    fun `if the server is unreachable, the image comes from the cache`() {
        server.enqueue(MockResponse().setHeader("Cache-Control", "max-age=0").setBody("bild-10179"))
        val bild = imageClient()
        val adresse = server.url("/api/v1/images/set/10179-1").toString()
        assertEquals(200 to "bild-10179", fetch(bild, adresse))
        server.shutdown()
        assertEquals("Offline bleibt die Kachel leer", 200 to "bild-10179", fetch(bild, adresse))
    }

    @Test
    fun `Coil loads via the image client and creates no own disk cache`() {
        server.enqueue(MockResponse().setBody("kein Bild"))
        val loader = NetzModule.provideImageLoader(ctx, imageClient())
        assertNull("Coil hielte dieselben Bytes noch einmal, im Klartext", loader.diskCache)
        runBlocking { loader.execute(ImageRequest.Builder(ctx).data(server.url("/api/v1/images/set/1-1").toString()).build()) }
        val anfrage = server.takeRequest(5, TimeUnit.SECONDS)
        assertNotNull("Coil hat nichts angefragt", anfrage)
        assertNotNull("Die Anfrage lief nicht über den Wächter des Bild-Clients", anfrage!!.getHeader("X-App-Api"))
    }
}
