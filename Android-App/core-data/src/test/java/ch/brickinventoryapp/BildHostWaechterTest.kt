package ch.brickinventoryapp

import ch.brickinventoryapp.util.BildHostWaechter
import ch.brickinventoryapp.util.istErlaubterBildHost
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
 * Der Bild-Client lädt nur vom eigenen Server und von den Bild-CDNs; Browser-Kennung
 * und Referer bekommen nur die CDNs, ein Token nur der eigene Server. Ein fremder
 * Host wird nicht angefragt, auch nicht über eine Umleitung.
 *
 * Gegenproben (02.11.2026, gemessen mit kotlinc lokal):
 *   A  in vorbereitet() `else -> null` → `else -> r` → rot „ein fremder Host wird
 *      nicht angefragt“ und „eine Umleitung zu einem fremden Host …“
 *   B  in intercept() bei fremdem Ziel `anfrage.newBuilder().url(ziel).build()`
 *      statt neuer Anfrage → rot „eine Umleitung zum CDN … ohne Token“
 *   C  istErlaubterBildHost() mit `(url.port == 443 || url.port == 80)` statt
 *      `url.isHttps && url.port == 443` → rot „nur genau diese Hosts …“
 *   D  den Zweig `eigenerServer(r.url) -> r` entfernt → rot „der eigene Server
 *      bekommt die Anfrage unveraendert“ und beide Umleitungstests
 */
class BildHostWaechterTest {

    private val server = MockWebServer().apply { start() }
    private val gesehen = mutableListOf<Request>()

    @After
    fun zu() = server.shutdown()

    /** Statt Netz: Was zum CDN ginge, wird hier festgehalten und mit 200 beantwortet. */
    private val cdnAttrappe = Interceptor { chain ->
        val r = chain.request()
        if (r.url.host == server.hostName && r.url.port == server.port) chain.proceed(r)
        else {
            gesehen += r
            Response.Builder().request(r).protocol(Protocol.HTTP_1_1).code(200).message("ok")
                .body("bild".toResponseBody(null)).build()
        }
    }

    private val client = OkHttpClient.Builder()
        .addInterceptor(BildHostWaechter { it.host == server.hostName && it.port == server.port })
        .addInterceptor(cdnAttrappe)
        .followRedirects(false)
        .build()

    private fun hole(url: String, token: String? = null) = client.newCall(
        Request.Builder().url(url).apply { token?.let { header("Authorization", "Bearer $it") } }.build()
    ).execute().use { it.code }

    @Test
    fun `ein fremder Host wird nicht angefragt`() {
        assertEquals(403, hole("https://evil.example/x.jpg"))
        assertTrue("Die Anfrage ging trotzdem hinaus", gesehen.isEmpty())
    }

    @Test
    fun `der eigene Server bekommt die Anfrage unveraendert`() {
        server.enqueue(MockResponse().setBody("bild"))
        assertEquals(200, hole(server.url("/images/a.jpg").toString(), token = "t1"))
        val r = server.takeRequest()
        assertEquals("Bearer t1", r.getHeader("Authorization"))
        assertFalse(r.getHeader("User-Agent").orEmpty().contains("Chrome"))
        assertNull(r.getHeader("Referer"))
    }

    @Test
    fun `das CDN bekommt Browser-Kennung und Referer`() {
        assertEquals(200, hole("https://cdn.rebrickable.com/sets/1.jpg"))
        val r = gesehen.single()
        assertTrue(r.header("User-Agent").orEmpty().contains("Chrome/120"))
        assertEquals("https://rebrickable.com/", r.header("Referer"))
        assertFalse(r.header("Accept").orEmpty().contains("avif"))
    }

    @Test
    fun `eine Umleitung zu einem fremden Host wird nicht verfolgt`() {
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "https://evil.example/x.jpg"))
        assertEquals(403, hole(server.url("/images/a.jpg").toString(), token = "t1"))
        assertEquals(1, server.requestCount)
        assertTrue(gesehen.isEmpty())
    }

    @Test
    fun `eine Umleitung zum CDN wird verfolgt, ohne Token`() {
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "https://cdn.rebrickable.com/p.png"))
        assertEquals(200, hole(server.url("/images/a.jpg").toString(), token = "t1"))
        val r = gesehen.single()
        assertNull("Der Token des eigenen Servers ging ans CDN", r.header("Authorization"))
        assertTrue(r.header("User-Agent").orEmpty().contains("Chrome/120"))
    }

    @Test
    fun `nur genau diese Hosts, nur ueber https auf 443`() {
        assertTrue(istErlaubterBildHost("https://img.bricklink.com/a.png".toHttpUrl()))
        assertTrue(istErlaubterBildHost("https://IMAGES.brickset.com/a.png".toHttpUrl()))
        assertFalse(istErlaubterBildHost("http://cdn.rebrickable.com/a.png".toHttpUrl()))
        assertFalse(istErlaubterBildHost("https://cdn.rebrickable.com:8443/a.png".toHttpUrl()))
        assertFalse(istErlaubterBildHost("https://x.cdn.rebrickable.com/a.png".toHttpUrl()))
        assertFalse(istErlaubterBildHost("https://cdn.rebrickable.com.evil.example/a.png".toHttpUrl()))
    }
}
