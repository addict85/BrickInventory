package ch.brickinventoryapp.data

import android.app.Application
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.core.data.BuildConfig
import ch.brickinventoryapp.data.cache.PreviewMemory
import ch.brickinventoryapp.data.di.NetworkModule
import ch.brickinventoryapp.data.di.NetworkStores
import ch.brickinventoryapp.data.di.buildInterceptorClient
import ch.brickinventoryapp.data.testing.testTrustCipher
import ch.brickinventoryapp.network.di.ServerGuard
import ch.brickinventoryapp.network.util.ImageHostGuard
import ch.brickinventoryapp.security.CertificateQuestion
import ch.brickinventoryapp.security.StoreCipher
import ch.brickinventoryapp.security.StoreKey
import ch.brickinventoryapp.security.TokenEncryption
import coil3.request.ImageRequest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.logging.HttpLoggingInterceptor
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
 * The clients to the own server, as NetworkModule builds them, against a test server: none
 * follows redirects itself (the guard does that), the image client runs via the
 * host guard, throttles without starving a tile wall and has a
 * cache from which it delivers offline; the API client has none. Coil loads
 * via exactly this image client. Under Robolectric with a real store.
 *
 * Counter-checks (patches under counter-checks/, Robolectric, measured by CI):
 *   server-client-folgt-umleitung  followRedirects(false) in buildInterceptorClient removed → red “no server client …”
 *   bild-client-ohne-waechter      ImageHostGuard not hooked in → red “the image client talks …”
 *   bild-client-ohne-token         the ServerGuard taken out of the image client → red “both clients …”
 *   bild-client-ohne-rueckfall     the FORCE_CACHE fallback keeps throwing → red “if the server is …”
 *   coil-ohne-bild-client          Coil without the image client's fetcher → red “Coil loads …”
 * Counter-check (run here): `if (isApiClient && BuildConfig.DEBUG)` around the recording → red
 * “both clients are logged …” (image client).
 * Counter-checks (run here): previewTap no longer hooked in → red “… a preview comes from the preview
 * store”. previewTap behind the offline fallback stays green: the tap then catches the connection error itself.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ServerClientsTest {

    private val ctx = ApplicationProvider.getApplicationContext<Application>()
    private val area = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val server = MockWebServer().apply { start() }

    /** Robolectric has no AndroidKeyStore; wrapping here is only for show. */
    private object PlainVault : TokenEncryption {
        override fun encrypt(plaintext: String) = plaintext
        override fun decrypt(saved: String) = saved
    }

    @After
    fun tearDown() {
        area.cancel()
        runCatching { server.shutdown() }
    }

    private val network: NetworkStores by lazy {
        runBlocking {
            val store = PreferenceDataStoreFactory.create { File(ctx.filesDir, "clients-${System.nanoTime()}.preferences_pb") }
            val device = DevicesStore(ctx, store, testTrustCipher())
            val token = TokenStore(store, PlainVault, device, area).also { it.waitOnStart() }
            token.saveServerUrl(server.url("/").toString())
            NetworkStores(token, device)
        }
    }

    private fun apiClient() = buildInterceptorClient(network, isApiClient = true, sessionExpired = SessionExpiredSignal(),
        ctx = ctx, question = CertificateQuestion())

    private val previews = PreviewMemory({ File(ctx.filesDir, "vorschau-clients") }, StoreCipher { ByteArray(32) { 2 } }, { ByteArray(32) { 12 } })

    private fun imageClient() = NetworkModule.provideImageOkHttpClient(ctx, network, SessionExpiredSignal(), previews,
        CertificateQuestion(), StoreKey(File(ctx.noBackupFilesDir, "clients.schluessel"), PlainVault))

    private fun fetch(client: OkHttpClient, address: String) =
        client.newCall(Request.Builder().url(address).build()).execute().use { it.code to it.body.string() }

    @Test
    fun `no server client follows a redirect itself`() {
        for ((name, c) in listOf("api" to apiClient(), "bild" to imageClient())) {
            assertFalse("$name: OkHttp followed redirects past the guard", c.followRedirects)
            assertFalse("$name: OkHttp followed a redirect from https to http", c.followSslRedirects)
        }
    }

    /** The ServerGuard attaches the token (ServerGuardTest); without it every image would load with 401. */
    @Test
    fun `both clients hook in the server guard`() {
        for ((name, c) in listOf("api" to apiClient(), "bild" to imageClient())) {
            assertTrue("$name: without ServerGuard no token would go along", c.interceptors.any { it is ServerGuard })
        }
    }

    /** In the debug build both are logged; without the image client its requests would be missing in logcat. */
    @Test
    fun `both clients are logged in the debug build`() {
        assertTrue("this test runs the debug variant", BuildConfig.DEBUG)
        for ((name, c) in listOf("api" to apiClient(), "bild" to imageClient())) {
            assertTrue("$name: no network recording", c.interceptors.any { it is HttpLoggingInterceptor })
        }
    }

    @Test
    fun `the image client talks only via the host guard and throttles moderately`() {
        val image = imageClient()
        assertTrue("The image client loads without host guard", image.interceptors.any { it is ImageHostGuard })
        val perHost = image.dispatcher.maxRequestsPerHost
        assertTrue("maxRequestsPerHost=$perHost is too narrow for a tile wall", perHost >= 6)
        assertTrue("maxRequests=${image.dispatcher.maxRequests} is no deliberate throttling",
            image.dispatcher.maxRequests in perHost..32)
        assertNotNull("The image client has no cache", image.cache)
        assertNull("The API client has a cache: a change could be answered from it",
            apiClient().cache)
    }

    @Test
    fun `if the server is unreachable, the image comes from the cache`() {
        server.enqueue(MockResponse().setHeader("Cache-Control", "max-age=0").setBody("bild-10179"))
        val image = imageClient()
        val address = server.url("/api/v2/images/set/10179-1").toString()
        assertEquals(200 to "bild-10179", fetch(image, address))
        server.shutdown()
        assertEquals("Offline the tile stays empty", 200 to "bild-10179", fetch(image, address))
    }

    @Test
    fun `if the server is unreachable and the cache empty, a preview comes from the preview store`() {
        val address = server.url("/api/v2/images/set/75192-1?thumb=1").toString()
        previews.write(address, "vorschau-75192".toByteArray())
        val image = imageClient()
        server.shutdown()
        assertEquals("Offline the tile stays empty", 200 to "vorschau-75192", fetch(image, address))
    }

    @Test
    fun `Coil loads via the image client and creates no own disk cache`() {
        server.enqueue(MockResponse().setBody("kein Bild"))
        val loader = NetworkModule.provideImageLoader(ctx, imageClient())
        assertNull("Coil would hold the same bytes once more, in plaintext", loader.diskCache)
        runBlocking { loader.execute(ImageRequest.Builder(ctx).data(server.url("/api/v2/images/set/1-1").toString()).build()) }
        val request = server.takeRequest(5, TimeUnit.SECONDS)
        assertNotNull("Coil requested nothing", request)
        assertNotNull("The request did not go through the image client's guard", request!!.getHeader("X-App-Api"))
    }
}
