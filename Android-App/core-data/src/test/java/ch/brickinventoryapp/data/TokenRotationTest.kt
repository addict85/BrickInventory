package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.account.AccountRepository
import ch.brickinventoryapp.data.api.AccountApi
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.data.testing.TestApi
import ch.brickinventoryapp.data.testing.testAccountRepository
import ch.brickinventoryapp.model.json.BrickJson
import ch.brickinventoryapp.network.di.AccessState
import ch.brickinventoryapp.network.di.PLACEHOLDER_BASE
import ch.brickinventoryapp.network.di.ServerGuard
import ch.brickinventoryapp.network.util.NetworkPolicy
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.Retrofit
import java.io.File
import java.io.IOException
import java.util.Collections
import java.util.concurrent.TimeUnit

/**
 * The swap of the token in the real network path: guard, account repository and
 * TokenSwap via one client, against a test server that rejects the old token
 * or requests the swap via header. The test server speaks http
 * on localhost; the guard therefore runs as in the debug build (entwicklung = true).
 *
 * Counter-checks:
 *   A  in ServerGuard the branch for 401 `token_rotation_noetig` removed →
 *      red “a rejected old token is swapped and the request retried”
 *      (401 instead of 200, session expired reported)
 *   B  the branch for the header removed → red “the header swaps in the
 *      background, once” (timeout, no swap)
 *   C  AccountApi.rotateToken again as `suspend` (via the dispatcher) →
 *      red “simultaneously rejected requests do not block the swap”
 *      (timeout: both slots wait for the swap, the swap for
 *      a slot)
 * Counter-checks:
 *   D  in TokenSwap the check `state() != before` before the retry
 *      removed → red “a server switch during the retry …” (LATER)
 *   E  in the guard again the old rule (header only dropped if it is the current
 *      token) → red “a self-set old token goes out … after the server switch”
 *   F  in AccountRepository.rotateToken() a fixed foreign origin instead of the
 *      request URL → red “a rejected old token is swapped …”,
 *      “simultaneously rejected …”, “the header swaps …” (nothing saved)
 */
class TokenRotationTest {

    private val server = MockWebServer()
    private val events: MutableList<String> = Collections.synchronizedList(mutableListOf())
    private val dir = File(System.getProperty("java.io.tmpdir"), "bim-rot-${System.nanoTime()}")
    @Volatile private var saved = "alt"
    @Volatile private var expired = 0
    /** Set: the swap answers like this (e.g. 503) instead of swapping. */
    @Volatile private var rotationMute: (() -> MockResponse)? = null

    /** Set after a server switch in the test; otherwise the test server. */
    @Volatile private var moved: String? = null
    private fun address() = moved ?: server.url("/").toString().trimEnd('/')
    private val situation = object : AccessState {
        override fun serverUrl() = address()
        override fun token() = saved
        override fun tokenOrigin(): String? = NetworkPolicy.origin(serverUrl())
        override fun generation() = limit.generation
    }
    private val limit = TokenLimit()
    /** Real threads: the swap runs here against a real test server. */
    private val background = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /** Like PreferencesManager.tokenStatus(): without binding the registered address counts. */
    private fun state() = TokenStatus(saved, NetworkPolicy.origin(address()), limit.generation)

    private fun swapFor(k: () -> AccountRepository, save: (String) -> Unit) = TokenSwap(
        state = { state() },
        replace = { before, newValue, h -> limit.replaceIf(before, h, { state() }) { save(newValue) } },
        rotate = { k().rotateToken(it) },
        pauses = listOf(50, 50, 50),
        background = background,
    )

    init {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path.orEmpty().substringBefore('?')
                val bearer = request.getHeader("Authorization")?.removePrefix("Bearer ")
                events += "$path $bearer"
                return when {
                    path == "/api/v1/auth/token-rotieren" && rotationMute != null -> rotationMute!!.invoke()
                    path == "/api/v1/auth/token-rotieren" -> MockResponse().setBody(
                        """{"success":true,"token":"neu","token_info":{"scope":"app","never_expires":true,
                           "rotation_faellig":false},"alt_gueltig_bis":"2026-10-30T12:05:00Z","ueberlappung_sek":300}""")
                    path == "/api/v1/sets" && bearer == "alt" ->
                        MockResponse().setResponseCode(401).setBody("""{"success":false,"code":"token_rotation_noetig"}""")
                    path == "/api/v1/parts" && bearer == "alt" ->
                        MockResponse().setHeader("X-Token-Rotation", "faellig").setBody("""{"success":true}""")
                    else -> MockResponse().setBody("""{"success":true}""")
                }
            }
        }
        server.start()
    }

    private val account: AccountRepository
    private val swapping = swapFor({ account }) { events += "speichere $it"; saved = it }
    private val client = OkHttpClient.Builder()
        .addInterceptor(ServerGuard(situation, true, development = true, sessionExpired = { expired++ }, rotation = swapping))
        .readTimeout(2, TimeUnit.SECONDS).build()

    init {
        account = testAccountRepository(Retrofit.Builder().baseUrl(PLACEHOLDER_BASE).client(client)
            .addConverterFactory(BrickJson.asConverterFactory("application/json".toMediaType()))
            .build().create(AccountApi::class.java))
    }

    @After
    fun tearDown() {
        background.cancel()
        server.shutdown()
        dir.deleteRecursively()
    }

    private fun fetch(path: String) = client.newCall(Request.Builder().url(server.url(path)).build()).execute().use { it.code }

    @Test
    fun `a rejected old token is swapped and the request retried`() {
        assertEquals(200, fetch("/api/v1/sets"))
        assertEquals(listOf("/api/v1/sets alt", "/api/v1/auth/token-rotieren alt", "speichere neu", "/api/v1/sets neu"),
            events.toList())
        assertEquals("Ein Tausch ist keine abgelaufene Sitzung", 0, expired)
    }

    /**
     * Rejected requests wait in the interceptor for the swap and occupy
     * their slots in the dispatcher meanwhile. If the swap itself needs one, it waits forever.
     */
    @Test
    fun `simultaneously rejected requests do not block the swap`() {
        val places = okhttp3.Dispatcher().apply { maxRequestsPerHost = 2 }
        lateinit var k: AccountRepository
        val t = swapFor({ k }) { saved = it }
        val c = OkHttpClient.Builder().dispatcher(places)
            .addInterceptor(ServerGuard(situation, true, development = true, sessionExpired = { expired++ }, rotation = t))
            .readTimeout(2, TimeUnit.SECONDS).build()
        k = testAccountRepository(Retrofit.Builder().baseUrl(server.url("/")).client(c)
            .addConverterFactory(BrickJson.asConverterFactory("application/json".toMediaType()))
            .build().create(AccountApi::class.java))
        val codes: MutableList<Int> = Collections.synchronizedList(mutableListOf())
        repeat(2) {
            c.newCall(Request.Builder().url(server.url("/api/v1/sets")).build()).enqueue(object : okhttp3.Callback {
                override fun onFailure(call: okhttp3.Call, e: IOException) { codes += -1 }
                override fun onResponse(call: okhttp3.Call, response: okhttp3.Response) { response.use { codes += it.code } }
            })
        }
        TestApi.pollUntil("beide Antworten") { codes.size == 2 }
        assertEquals(listOf(200, 200), codes.toList())
        assertEquals(1, events.count { it.startsWith("/api/v1/auth/token-rotieren") })
    }

    @Test
    fun `the header swaps in the background, once`() {
        assertEquals(200, fetch("/api/v1/parts"))
        assertEquals(200, fetch("/api/v1/parts"))
        TestApi.pollUntil("Tausch") { saved == "neu" }
        Thread.sleep(100)
        assertEquals(1, events.count { it.startsWith("/api/v1/auth/token-rotieren") })
        assertEquals("speichere neu", events.last { it.startsWith("speichere") })
    }

    /**
     * The response to the swap gets lost, and meanwhile the app switches the server
     * (saveServerUrl: token gone, new address). The old token must never reach the new
     * server — neither via a retry nor in the self-set header.
     */
    @Test
    fun `a server switch during the retry does not send the old token to the new server`() {
        val newer = MockWebServer()
        val there: MutableList<String?> = Collections.synchronizedList(mutableListOf())
        newer.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                there += request.getHeader("Authorization")
                return MockResponse().setResponseCode(503)
            }
        }
        newer.start()
        try {
            rotationMute = {
                kotlinx.coroutines.runBlocking {
                    limit.write { saved = ""; moved = newer.url("/").toString().trimEnd('/') }
                }
                MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AFTER_REQUEST)
            }
            val outcome = kotlinx.coroutines.runBlocking { swapping.swap("alt") }
            assertEquals(ExchangeOutcome.DISCARDED, outcome)
            assertTrue(events.any { it.startsWith("/api/v1/auth/token-rotieren alt") })
            assertEquals("Der neue Server sah: $there", 0, there.size)
            assertEquals("", saved)
        } finally {
            newer.shutdown()
        }
    }

    /** The same without the check in the swap: then the guard holds back the header. */
    @Test
    fun `a self-set old token goes out without header after the server switch`() {
        val newer = MockWebServer()
        val there: MutableList<String?> = Collections.synchronizedList(mutableListOf())
        newer.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                there += request.getHeader("Authorization")
                return MockResponse().setResponseCode(401).setBody("""{"success":false,"code":"token_ungueltig"}""")
            }
        }
        newer.start()
        try {
            saved = ""
            moved = newer.url("/").toString().trimEnd('/')
            val r = kotlinx.coroutines.runBlocking { account.rotateToken("alt") }
            assertTrue(r is Outcome.Failure)
            assertEquals(listOf<String?>(null), there.toList())
        } finally {
            newer.shutdown()
        }
    }
}
