package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.network.di.ServerWaechter
import ch.brickinventoryapp.network.di.Zugangslage
import ch.brickinventoryapp.network.util.NetworkPolicy
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import ch.brickinventoryapp.network.di.Rotationsanlass

/**
 * A server switch while a request hangs at the old server: the old one (A)
 *
 * Counter-checks:
 *   A  in ServerWaechter.tokenFor() the binding left out (`passt` only
 *      `token.isNotBlank()`) → red “a request without a token does not reach for the
 *      new server's token after the switch” (A received Bearer B)
 *   B  TokenSwap.noetig() again without origin and generation AND in the guard
 *      `.takeIf { sameSession() }` removed → red “a swap after the
 *      switch does not send the new server's token to the old one”
 *   C  in the guard `sameSession()` removed from the report of 401/403 →
 *      red “a 401 or 403 of the old server does not end the new session”
 *   D  in tokenFor() the generation not read anew (always the one from sending) →
 *      red “after signing in to the same server a request without a token
 *      still reaches for it” (the report of the real 401 would not happen)
 */
class ServerwechselTest {

    private val a = MockWebServer()
    private val b = MockWebServer()
    private val anA = Collections.synchronizedList(mutableListOf<String?>())
    private val freigabe = CountDownLatch(1)
    private val angekommen = CountDownLatch(1)
    private val abgelaufen = AtomicInteger()
    private val entzogen = AtomicInteger()

    /** How A answers the held-back request. */
    @Volatile private var lateResponse: () -> MockResponse = { MockResponse().setResponseCode(401).setBody("{}") }

    private val limit = TokenLimit()
    @Volatile private var url = ""
    @Volatile private var token = ""
    @Volatile private var herkunft: String? = null

    private val situation = object : Zugangslage {
        override fun serverUrl() = url
        override fun token() = token
        override fun tokenOrigin() = herkunft
        override fun generation() = limit.generation
    }

    private fun adresse(s: MockWebServer) = s.url("/").toString().trimEnd('/')

    init {
        a.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                anA += request.getHeader("Authorization")
                // Only the first request is held back; everything after that answers immediately.
                if (anA.size == 1) {
                    angekommen.countDown()
                    freigabe.await(10, TimeUnit.SECONDS)
                    return lateResponse()
                }
                return MockResponse().setResponseCode(401).setBody("{}")
            }
        }
        b.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest) = MockResponse().setBody("""{"success":true}""")
        }
        a.start(); b.start()
        url = adresse(a)
    }

    @After
    fun zu() {
        a.shutdown(); b.shutdown()
    }

    /** Like saveServerUrl() with a different origin and then saveAuthToken(). */
    private fun switchAndReportAn(ziel: MockWebServer, newToken: String) = runBlocking {
        limit.schreibe { url = adresse(ziel); token = ""; herkunft = null }
        limit.schreibe { herkunft = NetworkPolicy.herkunft(adresse(ziel)); token = newToken }
    }

    private fun client(rotation: Rotationsanlass? = null) = OkHttpClient.Builder()
        .addInterceptor(ServerWaechter(situation, true, entwicklung = true, sitzungAbgelaufen = { abgelaufen.incrementAndGet() },
            rotation = rotation, rightsRevoked = { entzogen.incrementAndGet() }))
        .readTimeout(10, TimeUnit.SECONDS).build()

    /** Sends [anfrage] to A, switches meanwhile and returns the status. */
    private fun duringOfSwitch(c: OkHttpClient, anfrage: Request, switch: () -> Unit): Int {
        val pool = Executors.newSingleThreadExecutor()
        try {
            val f = pool.submit<Int> { c.newCall(anfrage).execute().use { it.code } }
            assertTrue("A hat die Anfrage nicht erhalten", angekommen.await(5, TimeUnit.SECONDS))
            switch()
            freigabe.countDown()
            return f.get(10, TimeUnit.SECONDS)
        } finally {
            pool.shutdownNow()
        }
    }

    @Test
    fun `a request without a token does not reach for the new server's token after the switch`() {
        val status = duringOfSwitch(client(), Request.Builder().url(a.url("/api/v1/settings/theme")).build()) {
            switchAndReportAn(b, "TOKEN-VON-B")
        }
        assertEquals(401, status)
        assertFalse("A erhielt den Token von B: $anA", anA.any { it?.contains("TOKEN-VON-B") == true })
        assertEquals("Ein 401 ohne Token meldet nicht ab", 0, abgelaufen.get())
    }

    @Test
    fun `a swap after the switch does not send the new server's token to the old one`() {
        token = "TOKEN-VON-A"; herkunft = NetworkPolicy.herkunft(adresse(a))
        lateResponse = { MockResponse().setResponseCode(401).setBody("""{"code":"token_rotation_noetig"}""") }
        val tausch = TokenSwap(
            stand = { TokenStatus(token, herkunft, limit.generation) },
            ersetze = { _, _, _ -> false },
            rotiere = { Ergebnis.Fehler.Server(500) },
            pausen = emptyList(),
            // The test waits for noetig(); faellig() would not need an own scope.
            hintergrund = CoroutineScope(Job()),
        )
        val status = duringOfSwitch(client(tausch), Request.Builder().url(a.url("/api/v1/sets"))
            .post("geheim".toRequestBody()).build()) {
            switchAndReportAn(b, "TOKEN-VON-B")
        }
        assertEquals(401, status)
        assertEquals("A erhielt: $anA", listOf("Bearer TOKEN-VON-A"), anA.toList())
    }

    @Test
    fun `a 401 or 403 of the old server does not end the new session`() {
        token = "TOKEN-VON-A"; herkunft = NetworkPolicy.herkunft(adresse(a))
        lateResponse = { MockResponse().setResponseCode(401).setBody("""{"code":"token_ungueltig"}""") }
        duringOfSwitch(client(), Request.Builder().url(a.url("/api/v1/sets")).build()) {
            switchAndReportAn(b, "TOKEN-VON-B")
        }
        assertEquals("A hat die Sitzung bei B beendet", 0, abgelaufen.get())

        // Counterpart without switch: the same 401 signs out, a 403 nur_admins pulls rights along.
        token = "TOKEN-VON-B"
        b.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest) = if (request.path.orEmpty().startsWith("/api/v1/admin"))
                MockResponse().setResponseCode(403).setBody("""{"code":"nur_admins"}""")
            else MockResponse().setResponseCode(401).setBody("""{"code":"token_ungueltig"}""")
        }
        client().newCall(Request.Builder().url(b.url("/api/v1/sets")).build()).execute().close()
        client().newCall(Request.Builder().url(b.url("/api/v1/admin/x")).build()).execute().close()
        assertEquals(1, abgelaufen.get())
        assertEquals(1, entzogen.get())
    }

    @Test
    fun `a 403 nur_admins of the old server takes no rights from the new session`() {
        token = "TOKEN-VON-A"; herkunft = NetworkPolicy.herkunft(adresse(a))
        lateResponse = { MockResponse().setResponseCode(403).setBody("""{"code":"nur_admins"}""") }
        duringOfSwitch(client(), Request.Builder().url(a.url("/api/v1/admin/x")).build()) {
            switchAndReportAn(b, "TOKEN-VON-B")
        }
        assertEquals(0, entzogen.get())
    }

    @Test
    fun `after signing in to the same server a request without a token still reaches for it`() {
        // The race the reaching-for exists for: the same origin, new generation.
        val status = duringOfSwitch(client(), Request.Builder().url(a.url("/api/v1/settings/theme")).build()) {
            runBlocking { limit.schreibe { herkunft = NetworkPolicy.herkunft(adresse(a)); token = "TOKEN-VON-A" } }
        }
        assertEquals(listOf(null, "Bearer TOKEN-VON-A"), anA.toList())
        assertEquals(401, status)
        assertEquals("Mit Token abgewiesen ist der 401 echt", 1, abgelaufen.get())
    }
}
