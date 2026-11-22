package ch.brickinventoryapp.network

import ch.brickinventoryapp.network.di.AccessState
import ch.brickinventoryapp.network.di.PLACEHOLDER_BASE
import ch.brickinventoryapp.network.di.ServerGuard
import ch.brickinventoryapp.network.util.NetworkPolicy
import ch.brickinventoryapp.network.util.ownAddress
import ch.brickinventoryapp.network.util.pdfInViewer
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
 * shared reverse proxy, a different application lives under `/other-app`. One
 * test server, the app under `/brick`.
 *
 * Counter-checks:
 *   A  in the guard, `ourServer` without inBasePath() → red “a request outside
 *      the path goes without a token” (Bearer sent to /andere-app)
 *   B  in nextRedirect(), removed the path check → red “a redirect out of
 *      the path is not followed” (302 followed, token sent to /andere-app/x)
 *   C  in inBasePath(), `startsWith(basis)` instead of `"$basis/"` → red “a request outside …”
 *      (/brickfremd got the token)
 *   D  ownAddress() without inBasePath() → red “ownAddress stays under the path”
 *   E  sameServer() going only by origin → red “a different path is a different server”
 */
class BasePathTest {

    private val server = MockWebServer().apply { start() }
    private val basis = server.url("/brick").toString().trimEnd('/')

    private val situation = object : AccessState {
        override fun serverUrl() = basis
        override fun token() = "geheim"
        override fun tokenOrigin(): String? = NetworkPolicy.origin(basis)
        override fun generation() = 0L
    }
    private val client = OkHttpClient.Builder()
        .addInterceptor(ServerGuard(situation, true, development = true, sessionExpired = {}))
        .followRedirects(false).followSslRedirects(false)
        .readTimeout(2, TimeUnit.SECONDS).build()

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun fetch(url: String, withHeader: Boolean = false): Int = client.newCall(Request.Builder().url(url)
        .apply { if (withHeader) header("Authorization", "Bearer selbst-gesetzt") }.build()).execute().use { it.code }

    @Test
    fun `an API request goes under the path and with a token`() {
        server.enqueue(MockResponse().setBody("{}"))
        assertEquals(200, fetch(PLACEHOLDER_BASE + "api/v1/sets"))
        val a = server.takeRequest(1, TimeUnit.SECONDS)!!
        assertEquals("/brick/api/v1/sets", a.path)
        assertEquals("Bearer geheim", a.getHeader("Authorization"))
    }

    @Test
    fun `a request outside the path goes without a token`() {
        for (path in listOf("/andere-app/x", "/brickfremd/x", "/")) {
            server.enqueue(MockResponse().setBody("{}"))
            assertEquals(200, fetch(server.url(path).toString(), withHeader = true))
            val a = server.takeRequest(1, TimeUnit.SECONDS)!!
            assertNull("Token an $path", a.getHeader("Authorization"))
        }
        server.enqueue(MockResponse().setBody("{}"))
        fetch(server.url("/brick/uploads/a.jpg").toString())
        assertEquals("Bearer geheim", server.takeRequest(1, TimeUnit.SECONDS)!!.getHeader("Authorization"))
    }

    @Test
    fun `a redirect out of the path is not followed`() {
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "/andere-app/x"))
        server.enqueue(MockResponse().setBody("{}"))
        assertEquals(302, fetch(PLACEHOLDER_BASE + "api/v1/h"))
        server.takeRequest()
        assertEquals("only one request, none to /andere-app", 1, server.requestCount)
    }

    @Test
    fun `a redirect under the path is followed with the token`() {
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "/brick/api/v1/h2"))
        server.enqueue(MockResponse().setBody("{}"))
        assertEquals(200, fetch(PLACEHOLDER_BASE + "api/v1/h"))
        server.takeRequest()
        val second = server.takeRequest(1, TimeUnit.SECONDS)!!
        assertEquals("/brick/api/v1/h2", second.path)
        assertEquals("Bearer geheim", second.getHeader("Authorization"))
    }

    @Test
    fun `ownAddress stays under the path`() {
        val s = "https://s.example/brick"
        assertEquals("https://s.example/brick/uploads/a.pdf", ownAddress(s, "/uploads/a.pdf"))
        assertNull(ownAddress(s, "//fremd.example/x"))
        assertNull(ownAddress(s, "../andere-app/x"))
        assertNull(ownAddress(s, "%2e%2e/andere-app/x"))
        assertTrue(pdfInViewer("https://s.example/brick/api/v1/vouchers/7/pdf", s))
        assertFalse(pdfInViewer("https://s.example/andere-app/a.pdf", s))
    }

    @Test
    fun `a different path is a different server`() {
        assertTrue(NetworkPolicy.sameServer("https://s.example/brick", "https://S.example:443/brick/"))
        assertFalse(NetworkPolicy.sameServer("https://s.example/brick", "https://s.example/andere-app"))
        assertFalse(NetworkPolicy.sameServer("https://s.example/brick", "https://s.example"))
        assertTrue(NetworkPolicy.sameServer("https://s.example", "https://s.example/"))
    }
}
