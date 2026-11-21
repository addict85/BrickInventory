package ch.brickinventoryapp.network

import ch.brickinventoryapp.network.util.ImageHostGuard
import ch.brickinventoryapp.network.util.isOwnImageServer
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The image client only loads from our own server; a foreign host — an image
 * CDN included — is never requested, not even via a redirect: images come
 * through the server's proxy, a direct path would give third parties the device's IP.
 *
 * Counter-checks:
 *   A  in vorbereitet(), let every request through → red “a foreign host is
 *      not requested” and “a redirect to a foreign host …”
 *   C  the CDN allowance built back in
 *      (gegenproben/bild-cdn-wieder-frei.patch) → red “an image CDN …”
 *   D  removed the `ownServer(r.url) -> r` branch → red “the own server
 *      gets the request unchanged” and both redirect tests
 *   E  isOwnImageServer() without `entwicklung &&` → red “localhost counts as own server
 *      only in the debug build” (200 instead of 403)
 *   F  in intercept(), nextRedirect called without basePath() (the state before
 *      the same host used to be enough) → red “a redirect out of the base path
 *      goes without a token”; gegenproben/bild-umleitung-verlaesst-basispfad.patch
 */
class ImageHostGuardTest {

    private val server = MockWebServer().apply { start() }
    private val gesehen = mutableListOf<Request>()

    @After
    fun zu() = server.shutdown()

    /** Instead of the network: what would go to the CDN is recorded here and answered with 200. */
    private val cdnFake = Interceptor { chain ->
        val r = chain.request()
        if (r.url.host == server.hostName && r.url.port == server.port) chain.proceed(r)
        else {
            gesehen += r
            Response.Builder().request(r).protocol(Protocol.HTTP_1_1).code(200).message("ok")
                .body("bild".toResponseBody(null)).build()
        }
    }

    private val client = OkHttpClient.Builder()
        .addInterceptor(ImageHostGuard { it.host == server.hostName && it.port == server.port })
        .addInterceptor(cdnFake)
        .followRedirects(false)
        .build()

    private fun fetch(url: String, token: String? = null) = client.newCall(
        Request.Builder().url(url).apply { token?.let { header("Authorization", "Bearer $it") } }.build()
    ).execute().use { it.code }

    @Test
    fun `a foreign host is not requested`() {
        assertEquals(403, fetch("https://evil.example/x.jpg"))
        assertTrue("Die Anfrage ging trotzdem hinaus", gesehen.isEmpty())
    }

    @Test
    fun `the own server gets the request unchanged`() {
        server.enqueue(MockResponse().setBody("bild"))
        assertEquals(200, fetch(server.url("/images/a.jpg").toString(), token = "t1"))
        val r = server.takeRequest()
        assertEquals("Bearer t1", r.getHeader("Authorization"))
        assertFalse(r.getHeader("User-Agent").orEmpty().contains("Chrome"))
        assertNull(r.getHeader("Referer"))
    }

    @Test
    fun `an image CDN is not requested directly either`() {
        for (cdn in listOf("https://cdn.rebrickable.com/sets/1.jpg", "https://images.brickset.com/a.png",
                           "https://img.bricklink.com/a.png")) {
            assertEquals(cdn, 403, fetch(cdn))
        }
        assertTrue("Ein CDN wurde direkt angefragt: $gesehen", gesehen.isEmpty())
    }

    @Test
    fun `a redirect to a foreign host is not followed`() {
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "https://evil.example/x.jpg"))
        assertEquals(403, fetch(server.url("/images/a.jpg").toString(), token = "t1"))
        assertEquals(1, server.requestCount)
        assertTrue(gesehen.isEmpty())
    }

    @Test
    fun `a redirect to the CDN is not followed`() {
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "https://cdn.rebrickable.com/p.png"))
        assertEquals(403, fetch(server.url("/images/a.jpg").toString(), token = "t1"))
        assertTrue(gesehen.isEmpty())
    }

    /** The server lies behind a proxy under [basis]; the same host carries other applications. */
    private fun withBase(basis: String) = OkHttpClient.Builder()
        .addInterceptor(ImageHostGuard(
            ownServer = { it.host == server.hostName && it.port == server.port },
            basePath = { basis },
        ))
        .addInterceptor(cdnFake)
        .followRedirects(false)
        .build()

    private fun fetchWithBase(basis: String, pfad: String) = withBase(basis).newCall(
        Request.Builder().url(server.url(pfad)).header("Authorization", "Bearer GEHEIM").build()
    ).execute().use { it.code }

    @Test
    fun `a redirect out of the base path goes without a token`() {
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "/fremd/bild.png"))
        server.enqueue(MockResponse().setBody("bild"))
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "/brickfremd/bild.png"))
        server.enqueue(MockResponse().setBody("bild"))
        assertEquals(200, fetchWithBase("/brick", "/brick/api/v1/bild.png"))
        assertEquals("Bearer GEHEIM", server.takeRequest().getHeader("Authorization"))
        val fremd = server.takeRequest()
        assertEquals("/fremd/bild.png", fremd.path)
        assertNull("Der Token verliess den Basispfad", fremd.getHeader("Authorization"))
        // Segment-wise: /brick does not cover /brickfremd.
        assertEquals(200, fetchWithBase("/brick", "/brick/a.png"))
        server.takeRequest()
        val neighbor = server.takeRequest()
        assertEquals("/brickfremd/bild.png", neighbor.path)
        assertNull("Der Token ging an /brickfremd", neighbor.getHeader("Authorization"))
    }

    @Test
    fun `a redirect within the base path keeps the token`() {
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "/brick/bilder/b.png"))
        server.enqueue(MockResponse().setBody("bild"))
        assertEquals(200, fetchWithBase("/brick", "/brick/api/v1/bild.png"))
        server.takeRequest()
        val ziel = server.takeRequest()
        assertEquals("/brick/bilder/b.png", ziel.path)
        assertEquals("Bearer GEHEIM", ziel.getHeader("Authorization"))
    }

    /** The same guard as NetzModule builds it, in the release and in the debug build. */
    private fun withRule(entwicklung: Boolean) = OkHttpClient.Builder()
        .addInterceptor(ImageHostGuard { isOwnImageServer(it, "https://brick.example.org", entwicklung) })
        .addInterceptor(cdnFake)
        .followRedirects(false)
        .build()

    @Test
    fun `localhost counts as own server only in the debug build`() {
        val ziel = "http://localhost:${server.port}/images/a.jpg"
        server.enqueue(MockResponse().setBody("bild"))
        val release = withRule(entwicklung = false).newCall(Request.Builder().url(ziel).build()).execute().use { it.code }
        assertEquals("Release-Build: localhost ist ein fremder Host", 403, release)
        assertEquals(0, server.requestCount)
        val debug = withRule(entwicklung = true).newCall(Request.Builder().url(ziel).build()).execute().use { it.code }
        assertEquals(200, debug)
        assertEquals(1, server.requestCount)
        assertTrue(isOwnImageServer("https://brick.example.org/images/a.jpg".toHttpUrl(), "https://brick.example.org", false))
    }
}
