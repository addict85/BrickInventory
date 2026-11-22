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
 *      (counter-checks/bild-cdn-wieder-frei.patch) → red “an image CDN …”
 *   D  removed the `ownServer(r.url) -> r` branch → red “the own server
 *      gets the request unchanged” and both redirect tests
 *   E  isOwnImageServer() without `development &&` → red “localhost counts as own server
 *      only in the debug build” (200 instead of 403)
 *   F  in intercept(), nextRedirect called without basePath() (the state before
 *      the same host used to be enough) → red “a redirect out of the base path
 *      goes without a token”; counter-checks/bild-umleitung-verlaesst-basispfad.patch
 */
class ImageHostGuardTest {

    private val server = MockWebServer().apply { start() }
    private val seen = mutableListOf<Request>()

    @After
    fun tearDown() = server.shutdown()

    /** Instead of the network: what would go to the CDN is recorded here and answered with 200. */
    private val cdnFake = Interceptor { chain ->
        val r = chain.request()
        if (r.url.host == server.hostName && r.url.port == server.port) chain.proceed(r)
        else {
            seen += r
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
        assertTrue("Die Anfrage ging trotzdem hinaus", seen.isEmpty())
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
        assertTrue("Ein CDN wurde direkt angefragt: $seen", seen.isEmpty())
    }

    @Test
    fun `a redirect to a foreign host is not followed`() {
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "https://evil.example/x.jpg"))
        assertEquals(403, fetch(server.url("/images/a.jpg").toString(), token = "t1"))
        assertEquals(1, server.requestCount)
        assertTrue(seen.isEmpty())
    }

    @Test
    fun `a redirect to the CDN is not followed`() {
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "https://cdn.rebrickable.com/p.png"))
        assertEquals(403, fetch(server.url("/images/a.jpg").toString(), token = "t1"))
        assertTrue(seen.isEmpty())
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

    private fun fetchWithBase(basis: String, path: String) = withBase(basis).newCall(
        Request.Builder().url(server.url(path)).header("Authorization", "Bearer GEHEIM").build()
    ).execute().use { it.code }

    @Test
    fun `a redirect out of the base path goes without a token`() {
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "/fremd/bild.png"))
        server.enqueue(MockResponse().setBody("bild"))
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "/brickfremd/bild.png"))
        server.enqueue(MockResponse().setBody("bild"))
        assertEquals(200, fetchWithBase("/brick", "/brick/api/v1/bild.png"))
        assertEquals("Bearer GEHEIM", server.takeRequest().getHeader("Authorization"))
        val foreign = server.takeRequest()
        assertEquals("/fremd/bild.png", foreign.path)
        assertNull("Der Token verliess den Basispfad", foreign.getHeader("Authorization"))
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
        val target = server.takeRequest()
        assertEquals("/brick/bilder/b.png", target.path)
        assertEquals("Bearer GEHEIM", target.getHeader("Authorization"))
    }

    /** The same guard as NetworkModule builds it, in the release and in the debug build. */
    private fun withRule(development: Boolean) = OkHttpClient.Builder()
        .addInterceptor(ImageHostGuard { isOwnImageServer(it, "https://brick.example.org", development) })
        .addInterceptor(cdnFake)
        .followRedirects(false)
        .build()

    @Test
    fun `localhost counts as own server only in the debug build`() {
        val target = "http://localhost:${server.port}/images/a.jpg"
        server.enqueue(MockResponse().setBody("bild"))
        val release = withRule(development = false).newCall(Request.Builder().url(target).build()).execute().use { it.code }
        assertEquals("Release-Build: localhost ist ein fremder Host", 403, release)
        assertEquals(0, server.requestCount)
        val debug = withRule(development = true).newCall(Request.Builder().url(target).build()).execute().use { it.code }
        assertEquals(200, debug)
        assertEquals(1, server.requestCount)
        assertTrue(isOwnImageServer("https://brick.example.org/images/a.jpg".toHttpUrl(), "https://brick.example.org", false))
    }
}
