package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.network.di.AccessState
import ch.brickinventoryapp.network.di.RotationReason
import ch.brickinventoryapp.network.di.ServerGuard
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

/**
 * A server switch while a request hangs at the old server: the old one (A)
 *
 * Counter-checks:
 *   A  in ServerGuard.tokenFor() the binding left out (`matches` only
 *      `token.isNotBlank()`) → red “a request without a token does not reach for the
 *      new server's token after the switch” (A received Bearer B)
 *   B  TokenSwap.needed() again without origin and generation AND in the guard
 *      `.takeIf { sameSession() }` removed → red “a swap after the
 *      switch does not send the new server's token to the old one”
 *   C  in the guard `sameSession()` removed from the report of 401/403 →
 *      red “a 401 or 403 of the old server does not end the new session”
 *   D  in tokenFor() the generation not read anew (always the one from sending) →
 *      red “after signing in to the same server a request without a token
 *      still reaches for it” (the report of the real 401 would not happen)
 */
class ServerSwitchTest {

    private val a = MockWebServer()
    private val b = MockWebServer()
    private val anA = Collections.synchronizedList(mutableListOf<String?>())
    private val approval = CountDownLatch(1)
    private val arrived = CountDownLatch(1)
    private val expired = AtomicInteger()
    private val revoked = AtomicInteger()

    /** How A answers the held-back request. */
    @Volatile private var lateResponse: () -> MockResponse = { MockResponse().setResponseCode(401).setBody("{}") }

    private val limit = TokenLimit()
    @Volatile private var url = ""
    @Volatile private var token = ""
    @Volatile private var origin: String? = null

    private val situation = object : AccessState {
        override fun serverUrl() = url
        override fun token() = token
        override fun tokenOrigin() = origin
        override fun generation() = limit.generation
    }

    private fun address(s: MockWebServer) = s.url("/").toString().trimEnd('/')

    init {
        a.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                anA += request.getHeader("Authorization")
                // Only the first request is held back; everything after that answers immediately.
                if (anA.size == 1) {
                    arrived.countDown()
                    approval.await(10, TimeUnit.SECONDS)
                    return lateResponse()
                }
                return MockResponse().setResponseCode(401).setBody("{}")
            }
        }
        b.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest) = MockResponse().setBody("""{"success":true}""")
        }
        a.start(); b.start()
        url = address(a)
    }

    @After
    fun tearDown() {
        a.shutdown(); b.shutdown()
    }

    /** Like saveServerUrl() with a different origin and then saveAuthToken(). */
    private fun switchAndLogIn(target: MockWebServer, newToken: String) = runBlocking {
        limit.write { url = address(target); token = ""; origin = null }
        limit.write { origin = NetworkPolicy.origin(address(target)); token = newToken }
    }

    private fun client(rotation: RotationReason? = null) = OkHttpClient.Builder()
        .addInterceptor(ServerGuard(situation, true, development = true, sessionExpired = { expired.incrementAndGet() },
            rotation = rotation, rightsRevoked = { revoked.incrementAndGet() }))
        .readTimeout(10, TimeUnit.SECONDS).build()

    /** Sends [request] to A, switches meanwhile and returns the status. */
    private fun duringOfSwitch(c: OkHttpClient, request: Request, switch: () -> Unit): Int {
        val pool = Executors.newSingleThreadExecutor()
        try {
            val f = pool.submit<Int> { c.newCall(request).execute().use { it.code } }
            assertTrue("A did not receive the request", arrived.await(5, TimeUnit.SECONDS))
            switch()
            approval.countDown()
            return f.get(10, TimeUnit.SECONDS)
        } finally {
            pool.shutdownNow()
        }
    }

    @Test
    fun `a request without a token does not reach for the new server's token after the switch`() {
        val status = duringOfSwitch(client(), Request.Builder().url(a.url("/api/v2/settings/theme")).build()) {
            switchAndLogIn(b, "TOKEN-VON-B")
        }
        assertEquals(401, status)
        assertFalse("A received B's token: $anA", anA.any { it?.contains("TOKEN-VON-B") == true })
        assertEquals("A 401 without a token does not sign out", 0, expired.get())
    }

    @Test
    fun `a swap after the switch does not send the new server's token to the old one`() {
        token = "TOKEN-VON-A"; origin = NetworkPolicy.origin(address(a))
        lateResponse = { MockResponse().setResponseCode(401).setBody("""{"code":"token_rotation_required"}""") }
        val swapping = TokenSwap(
            state = { TokenStatus(token, origin, limit.generation) },
            replace = { _, _, _ -> false },
            rotate = { Outcome.Failure.Server(500) },
            pauses = emptyList(),
            // The test waits for needed(); due() would not need an own scope.
            background = CoroutineScope(Job()),
        )
        val status = duringOfSwitch(client(swapping), Request.Builder().url(a.url("/api/v2/sets"))
            .post("geheim".toRequestBody()).build()) {
            switchAndLogIn(b, "TOKEN-VON-B")
        }
        assertEquals(401, status)
        assertEquals("A erhielt: $anA", listOf("Bearer TOKEN-VON-A"), anA.toList())
    }

    @Test
    fun `a 401 or 403 of the old server does not end the new session`() {
        token = "TOKEN-VON-A"; origin = NetworkPolicy.origin(address(a))
        lateResponse = { MockResponse().setResponseCode(401).setBody("""{"code":"token_invalid"}""") }
        duringOfSwitch(client(), Request.Builder().url(a.url("/api/v2/sets")).build()) {
            switchAndLogIn(b, "TOKEN-VON-B")
        }
        assertEquals("A ended the session at B", 0, expired.get())

        // Counterpart without switch: the same 401 signs out, a 403 only_admins pulls rights along.
        token = "TOKEN-VON-B"
        b.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest) = if (request.path.orEmpty().startsWith("/api/v2/admin"))
                MockResponse().setResponseCode(403).setBody("""{"code":"admins_only"}""")
            else MockResponse().setResponseCode(401).setBody("""{"code":"token_invalid"}""")
        }
        client().newCall(Request.Builder().url(b.url("/api/v2/sets")).build()).execute().close()
        client().newCall(Request.Builder().url(b.url("/api/v2/admin/x")).build()).execute().close()
        assertEquals(1, expired.get())
        assertEquals(1, revoked.get())
    }

    @Test
    fun `a 403 only_admins of the old server takes no rights from the new session`() {
        token = "TOKEN-VON-A"; origin = NetworkPolicy.origin(address(a))
        lateResponse = { MockResponse().setResponseCode(403).setBody("""{"code":"admins_only"}""") }
        duringOfSwitch(client(), Request.Builder().url(a.url("/api/v2/admin/x")).build()) {
            switchAndLogIn(b, "TOKEN-VON-B")
        }
        assertEquals(0, revoked.get())
    }

    @Test
    fun `after signing in to the same server a request without a token still reaches for it`() {
        // The race the reaching-for exists for: the same origin, new generation.
        val status = duringOfSwitch(client(), Request.Builder().url(a.url("/api/v2/settings/theme")).build()) {
            runBlocking { limit.write { origin = NetworkPolicy.origin(address(a)); token = "TOKEN-VON-A" } }
        }
        assertEquals(listOf(null, "Bearer TOKEN-VON-A"), anA.toList())
        assertEquals(401, status)
        assertEquals("Rejected with a token, the 401 is real", 1, expired.get())
    }
}
