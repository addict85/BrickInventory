package ch.brickinventoryapp

import ch.brickinventoryapp.util.BildHostWaechter
import ch.brickinventoryapp.util.istEigenerBildServer
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
 * Der Bild-Client lädt nur vom eigenen Server; ein fremder Host — auch ein Bild-CDN —
 * wird nicht angefragt, auch nicht über eine Umleitung (sec17 A-N7: Die Bilder kommen
 * über den Proxy des Servers, ein direkter Weg gäbe Dritten die IP des Geräts).
 *
 * Gegenproben:
 *   A  in vorbereitet() jede Anfrage durchgelassen → rot „ein fremder Host wird
 *      nicht angefragt“ und „eine Umleitung zu einem fremden Host …“
 *   C die CDN-Freigabe wieder eingebaut
 *      (gegenproben/bild-cdn-wieder-frei.patch) → rot „auch ein Bild-CDN …“
 *   D  den Zweig `eigenerServer(r.url) -> r` entfernt → rot „der eigene Server
 *      bekommt die Anfrage unveraendert“ und beide Umleitungstests
 *   E  istEigenerBildServer() ohne `entwicklung &&` → rot „localhost gilt nur
 *      im Debug-Build als eigener Server“ (200 statt 403)
 *   F  in intercept() naechsteUmleitung ohne basisPfad() aufgerufen (Stand vor
 *      früher genügte der gleiche Host) → rot „eine Umleitung aus dem Basispfad
 *      heraus geht ohne Token“; gegenproben/bild-umleitung-verlaesst-basispfad.patch
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
    fun `auch ein Bild-CDN wird nicht direkt angefragt`() {
        for (cdn in listOf("https://cdn.rebrickable.com/sets/1.jpg", "https://images.brickset.com/a.png",
                           "https://img.bricklink.com/a.png")) {
            assertEquals(cdn, 403, hole(cdn))
        }
        assertTrue("Ein CDN wurde direkt angefragt: $gesehen", gesehen.isEmpty())
    }

    @Test
    fun `eine Umleitung zu einem fremden Host wird nicht verfolgt`() {
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "https://evil.example/x.jpg"))
        assertEquals(403, hole(server.url("/images/a.jpg").toString(), token = "t1"))
        assertEquals(1, server.requestCount)
        assertTrue(gesehen.isEmpty())
    }

    @Test
    fun `eine Umleitung zum CDN wird nicht verfolgt`() {
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "https://cdn.rebrickable.com/p.png"))
        assertEquals(403, hole(server.url("/images/a.jpg").toString(), token = "t1"))
        assertTrue(gesehen.isEmpty())
    }

    /** Der Server liegt hinter einem Proxy unter [basis]; derselbe Host trägt andere Anwendungen. */
    private fun mitBasis(basis: String) = OkHttpClient.Builder()
        .addInterceptor(BildHostWaechter(
            eigenerServer = { it.host == server.hostName && it.port == server.port },
            basisPfad = { basis },
        ))
        .addInterceptor(cdnAttrappe)
        .followRedirects(false)
        .build()

    private fun holeMitBasis(basis: String, pfad: String) = mitBasis(basis).newCall(
        Request.Builder().url(server.url(pfad)).header("Authorization", "Bearer GEHEIM").build()
    ).execute().use { it.code }

    @Test
    fun `eine Umleitung aus dem Basispfad heraus geht ohne Token`() {
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "/fremd/bild.png"))
        server.enqueue(MockResponse().setBody("bild"))
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "/brickfremd/bild.png"))
        server.enqueue(MockResponse().setBody("bild"))
        assertEquals(200, holeMitBasis("/brick", "/brick/api/v1/bild.png"))
        assertEquals("Bearer GEHEIM", server.takeRequest().getHeader("Authorization"))
        val fremd = server.takeRequest()
        assertEquals("/fremd/bild.png", fremd.path)
        assertNull("Der Token verliess den Basispfad", fremd.getHeader("Authorization"))
        // Segmentweise: /brick deckt /brickfremd nicht.
        assertEquals(200, holeMitBasis("/brick", "/brick/a.png"))
        server.takeRequest()
        val nachbar = server.takeRequest()
        assertEquals("/brickfremd/bild.png", nachbar.path)
        assertNull("Der Token ging an /brickfremd", nachbar.getHeader("Authorization"))
    }

    @Test
    fun `eine Umleitung innerhalb des Basispfads behaelt den Token`() {
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "/brick/bilder/b.png"))
        server.enqueue(MockResponse().setBody("bild"))
        assertEquals(200, holeMitBasis("/brick", "/brick/api/v1/bild.png"))
        server.takeRequest()
        val ziel = server.takeRequest()
        assertEquals("/brick/bilder/b.png", ziel.path)
        assertEquals("Bearer GEHEIM", ziel.getHeader("Authorization"))
    }

    /** Derselbe Wächter, wie NetzModule ihn baut, im Release- und im Debug-Build. */
    private fun mitRegel(entwicklung: Boolean) = OkHttpClient.Builder()
        .addInterceptor(BildHostWaechter { istEigenerBildServer(it, "https://brick.example.org", entwicklung) })
        .addInterceptor(cdnAttrappe)
        .followRedirects(false)
        .build()

    @Test
    fun `localhost gilt nur im Debug-Build als eigener Server`() {
        val ziel = "http://localhost:${server.port}/images/a.jpg"
        server.enqueue(MockResponse().setBody("bild"))
        val release = mitRegel(entwicklung = false).newCall(Request.Builder().url(ziel).build()).execute().use { it.code }
        assertEquals("Release-Build: localhost ist ein fremder Host", 403, release)
        assertEquals(0, server.requestCount)
        val debug = mitRegel(entwicklung = true).newCall(Request.Builder().url(ziel).build()).execute().use { it.code }
        assertEquals(200, debug)
        assertEquals(1, server.requestCount)
        assertTrue(istEigenerBildServer("https://brick.example.org/images/a.jpg".toHttpUrl(), "https://brick.example.org", false))
    }
}
