package ch.brickinventoryapp.network

import ch.brickinventoryapp.network.util.NetworkPolicy
import ch.brickinventoryapp.network.di.ServerWaechter
import ch.brickinventoryapp.network.di.Zugangslage
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.concurrent.TimeUnit

/**
 * Redirects on the API, SSE and PDF path (pruef6, N1). OkHttp followed a 307
 * to any host and sent method and body along — the password from
 * /auth/login, a voucher's PIN. The client therefore follows no redirect
 * (ServerClient.kt, configured the same way here); the guard only follows
 * within the same origin. Two test servers on different ports are two origins.
 *
 * Gegenproben:
 *   A  in nextRedirect(), removed the origin check → red "eine
 *      Umleitung zu einem anderen Host erreicht ihn nicht" (200 from B instead of 307)
 *   B  senden() follows no redirect (just `chain.proceed`) → red "eine
 *      Umleitung auf demselben Server behält Methode, Rumpf und Token" and
 *      "nach 303 geht es mit GET ohne Rumpf weiter" (307 resp. 303 reaches the caller)
 *   C  307/308 treated like 303 (always GET) → red "eine Umleitung auf demselben
 *      Server behält …" (GET instead of POST)
 */
class RedirectTest {

    private val a = MockWebServer().apply { start() }
    private val b = MockWebServer().apply { start() }

    private val situation = object : Zugangslage {
        override fun serverUrl() = a.url("/").toString().trimEnd('/')
        override fun token() = "geheim"
        override fun tokenOrigin(): String? = NetworkPolicy.herkunft(serverUrl())
        override fun generation() = 0L
    }
    private val client = OkHttpClient.Builder()
        .addInterceptor(ServerWaechter(situation, true, entwicklung = true, sitzungAbgelaufen = {}))
        .followRedirects(false).followSslRedirects(false)
        .readTimeout(2, TimeUnit.SECONDS).build()

    @After
    fun zu() {
        a.shutdown(); b.shutdown()
    }

    private fun anmelden(): Int = client.newCall(Request.Builder().url(a.url("/api/v1/auth/login"))
        .post("""{"password":"streng-geheim"}""".toRequestBody()).build()).execute().use { it.code }

    @Test
    fun `eine Umleitung zu einem anderen Host erreicht ihn nicht`() {
        a.enqueue(MockResponse().setResponseCode(307).setHeader("Location", b.url("/fang").toString()))
        b.enqueue(MockResponse().setBody("{}"))
        assertEquals(307, anmelden())
        assertEquals("B erhielt eine Anfrage", 0, b.requestCount)
    }

    @Test
    fun `eine Umleitung auf demselben Server behaelt Methode, Rumpf und Token`() {
        a.enqueue(MockResponse().setResponseCode(307).setHeader("Location", "/api/v1/auth/login2"))
        a.enqueue(MockResponse().setBody("{}"))
        assertEquals(200, anmelden())
        a.takeRequest()
        val zweite = a.takeRequest(1, TimeUnit.SECONDS)!!
        assertEquals("/api/v1/auth/login2", zweite.path)
        assertEquals("POST", zweite.method)
        assertEquals("""{"password":"streng-geheim"}""", zweite.body.readUtf8())
        assertEquals("Bearer geheim", zweite.getHeader("Authorization"))
    }

    @Test
    fun `nach 303 geht es mit GET ohne Rumpf weiter`() {
        a.enqueue(MockResponse().setResponseCode(303).setHeader("Location", "/api/v1/ergebnis"))
        a.enqueue(MockResponse().setBody("{}"))
        assertEquals(200, anmelden())
        a.takeRequest()
        val zweite = a.takeRequest(1, TimeUnit.SECONDS)!!
        assertEquals("GET", zweite.method)
        assertEquals(0L, zweite.bodySize)
        assertNull(zweite.getHeader("Content-Type"))
    }
}
