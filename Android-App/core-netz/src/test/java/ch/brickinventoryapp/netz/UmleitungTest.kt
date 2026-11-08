package ch.brickinventoryapp.netz

import ch.brickinventoryapp.netz.util.NetworkPolicy
import ch.brickinventoryapp.netz.di.ServerWaechter
import ch.brickinventoryapp.netz.di.Zugangslage
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
 * Umleitungen im API-, SSE- und PDF-Weg (pruef6, N1). OkHttp folgte einem 307
 * zu jedem Host und schickte Methode und Rumpf mit — das Passwort von
 * /auth/login, die PIN eines Gutscheins. Der Client folgt darum keiner
 * Umleitung (ServerClient.kt, hier ebenso eingestellt); der Wächter folgt nur
 * innerhalb derselben Herkunft. Zwei Testserver auf verschiedenen Ports sind
 * zwei Herkünfte.
 *
 * Gegenproben:
 *   A  in naechsteUmleitung() die Prüfung der Herkunft entfernt → rot „eine
 *      Umleitung zu einem anderen Host erreicht ihn nicht“ (200 von B statt 307)
 *   B  senden() folgt keiner Umleitung (nur `chain.proceed`) → rot „eine
 *      Umleitung auf demselben Server behält Methode, Rumpf und Token“ und
 *      „nach 303 geht es mit GET ohne Rumpf weiter“ (307 bzw. 303 beim Aufrufer)
 *   C  307/308 wie 303 behandelt (immer GET) → rot „eine Umleitung auf demselben
 *      Server behält …“ (GET statt POST)
 */
class UmleitungTest {

    private val a = MockWebServer().apply { start() }
    private val b = MockWebServer().apply { start() }

    private val lage = object : Zugangslage {
        override fun serverUrl() = a.url("/").toString().trimEnd('/')
        override fun token() = "geheim"
        override fun tokenHerkunft(): String? = NetworkPolicy.herkunft(serverUrl())
        override fun generation() = 0L
    }
    private val client = OkHttpClient.Builder()
        .addInterceptor(ServerWaechter(lage, true, entwicklung = true, sitzungAbgelaufen = {}))
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
