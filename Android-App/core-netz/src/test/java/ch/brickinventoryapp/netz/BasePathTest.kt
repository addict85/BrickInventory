package ch.brickinventoryapp.netz

import ch.brickinventoryapp.netz.di.PLACEHOLDER_BASE
import ch.brickinventoryapp.netz.di.ServerWaechter
import ch.brickinventoryapp.netz.di.Zugangslage
import ch.brickinventoryapp.netz.util.NetworkPolicy
import ch.brickinventoryapp.netz.util.ownAddress
import ch.brickinventoryapp.netz.util.pdfInViewer
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
import java.util.concurrent.TimeUnit

/**
 * The token belongs to the server under its path, not the whole host: behind a
 * shared reverse proxy, a different application lives under `/andere-app`. One
 * test server, the app under `/brick`.
 *
 * Gegenproben:
 *   A  in the guard, `ourServer` without inBasePath() → red "eine Anfrage ausserhalb
 *      des Pfads geht ohne Token" (Bearer sent to /andere-app)
 *   B  in nextRedirect(), removed the path check → red "eine Umleitung aus
 *      dem Pfad hinaus wird nicht verfolgt" (302 followed, token sent to /andere-app/x)
 *   C  in inBasePath(), `startsWith(basis)` instead of `"$basis/"` → red "ausserhalb …"
 *      (/brickfremd got the token)
 *   D  ownAddress() without inBasePath() → red "ownAddress bleibt unter dem Pfad"
 *   E  sameServer() going only by origin → red "ein anderer Pfad ist ein anderer Server"
 */
class BasePathTest {

    private val server = MockWebServer().apply { start() }
    private val basis = server.url("/brick").toString().trimEnd('/')

    private val situation = object : Zugangslage {
        override fun serverUrl() = basis
        override fun token() = "geheim"
        override fun tokenOrigin(): String? = NetworkPolicy.herkunft(basis)
        override fun generation() = 0L
    }
    private val client = OkHttpClient.Builder()
        .addInterceptor(ServerWaechter(situation, true, entwicklung = true, sitzungAbgelaufen = {}))
        .followRedirects(false).followSslRedirects(false)
        .readTimeout(2, TimeUnit.SECONDS).build()

    @After
    fun zu() {
        server.shutdown()
    }

    private fun fetch(url: String, withHeader: Boolean = false): Int = client.newCall(Request.Builder().url(url)
        .apply { if (withHeader) header("Authorization", "Bearer selbst-gesetzt") }.build()).execute().use { it.code }

    @Test
    fun `eine API-Anfrage geht unter den Pfad und mit Token`() {
        server.enqueue(MockResponse().setBody("{}"))
        assertEquals(200, fetch(PLACEHOLDER_BASE + "api/v1/sets"))
        val a = server.takeRequest(1, TimeUnit.SECONDS)!!
        assertEquals("/brick/api/v1/sets", a.path)
        assertEquals("Bearer geheim", a.getHeader("Authorization"))
    }

    @Test
    fun `eine Anfrage ausserhalb des Pfads geht ohne Token`() {
        for (pfad in listOf("/andere-app/x", "/brickfremd/x", "/")) {
            server.enqueue(MockResponse().setBody("{}"))
            assertEquals(200, fetch(server.url(pfad).toString(), withHeader = true))
            val a = server.takeRequest(1, TimeUnit.SECONDS)!!
            assertNull("Token an $pfad", a.getHeader("Authorization"))
        }
        server.enqueue(MockResponse().setBody("{}"))
        fetch(server.url("/brick/uploads/a.jpg").toString())
        assertEquals("Bearer geheim", server.takeRequest(1, TimeUnit.SECONDS)!!.getHeader("Authorization"))
    }

    @Test
    fun `eine Umleitung aus dem Pfad hinaus wird nicht verfolgt`() {
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "/andere-app/x"))
        server.enqueue(MockResponse().setBody("{}"))
        assertEquals(302, fetch(PLACEHOLDER_BASE + "api/v1/h"))
        server.takeRequest()
        assertEquals("Nur eine Anfrage, keine an /andere-app", 1, server.requestCount)
    }

    @Test
    fun `eine Umleitung unter dem Pfad wird mit Token verfolgt`() {
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "/brick/api/v1/h2"))
        server.enqueue(MockResponse().setBody("{}"))
        assertEquals(200, fetch(PLACEHOLDER_BASE + "api/v1/h"))
        server.takeRequest()
        val zweite = server.takeRequest(1, TimeUnit.SECONDS)!!
        assertEquals("/brick/api/v1/h2", zweite.path)
        assertEquals("Bearer geheim", zweite.getHeader("Authorization"))
    }

    @Test
    fun `eigeneAdresse bleibt unter dem Pfad`() {
        val s = "https://s.example/brick"
        assertEquals("https://s.example/brick/uploads/a.pdf", ownAddress(s, "/uploads/a.pdf"))
        assertNull(ownAddress(s, "//fremd.example/x"))
        assertNull(ownAddress(s, "../andere-app/x"))
        assertNull(ownAddress(s, "%2e%2e/andere-app/x"))
        assertTrue(pdfInViewer("https://s.example/brick/api/v1/vouchers/7/pdf", s))
        assertFalse(pdfInViewer("https://s.example/andere-app/a.pdf", s))
    }

    @Test
    fun `ein anderer Pfad ist ein anderer Server`() {
        assertTrue(NetworkPolicy.sameServer("https://s.example/brick", "https://S.example:443/brick/"))
        assertFalse(NetworkPolicy.sameServer("https://s.example/brick", "https://s.example/andere-app"))
        assertFalse(NetworkPolicy.sameServer("https://s.example/brick", "https://s.example"))
        assertTrue(NetworkPolicy.sameServer("https://s.example", "https://s.example/"))
    }
}
