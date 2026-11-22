package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.api.AccountApi
import ch.brickinventoryapp.data.testing.testAccountRepository
import ch.brickinventoryapp.model.json.BrickJson
import ch.brickinventoryapp.network.di.AccessState
import ch.brickinventoryapp.network.di.ServerGuard
import ch.brickinventoryapp.network.util.NetworkPolicy
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.Retrofit
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * Signing out invalidates the token at the server (POST /auth/logout with the token), and
 * in a bounded way: a silent or missing server does not hold up the sign-out.
 *
 * Counter-checks:
 *   A  withTimeoutOrNull removed → red “a silent server does not hold up the
 *      sign-out” (only the client's read limit after 2 s)
 *   B  the catch branch for Exception removed → red “a missing server …”
 *      (ConnectException flies through)
 */
class LogoutAtServerTest {

    private val server = MockWebServer().apply { start() }
    private val dir = File(System.getProperty("java.io.tmpdir"), "bim-ab-${System.nanoTime()}")
    private val situation = object : AccessState {
        override fun serverUrl() = server.url("/").toString().trimEnd('/')
        override fun token() = "geheim"
        override fun tokenOrigin(): String? = NetworkPolicy.origin(serverUrl())
        override fun generation() = 0L
    }
    private val client = OkHttpClient.Builder()
        .addInterceptor(ServerGuard(situation, true, development = true, sessionExpired = {}))
        .readTimeout(2, TimeUnit.SECONDS).build()
    private val account = testAccountRepository(Retrofit.Builder().baseUrl(server.url("/")).client(client)
        .addConverterFactory(BrickJson.asConverterFactory("application/json".toMediaType()))
        .build().create(AccountApi::class.java))

    @After
    fun tearDown() {
        runCatching { server.shutdown() }
        dir.deleteRecursively()
    }

    @Test
    fun `sign-out sends the token to the server for invalidation`() {
        server.enqueue(MockResponse().setBody("""{"success":true}"""))
        assertTrue(runBlocking { account.logoutAtServer() })
        val request = server.takeRequest(1, TimeUnit.SECONDS)!!
        assertEquals("POST", request.method)
        assertEquals("/api/v1/auth/logout", request.path)
        assertEquals("Bearer geheim", request.getHeader("Authorization"))
    }

    @Test
    fun `a silent server does not hold up the sign-out`() {
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
        val begin = System.nanoTime()
        assertFalse(runBlocking { account.logoutAtServer(limitMs = 300) })
        val duration = (System.nanoTime() - begin) / 1_000_000
        assertTrue("Signing out took $duration ms", duration < 1_500)
    }

    @Test
    fun `a missing or faulty server does not hold up the sign-out`() {
        server.enqueue(MockResponse().setResponseCode(500))
        assertFalse(runBlocking { account.logoutAtServer() })
        server.shutdown()
        assertFalse(runBlocking { account.logoutAtServer() })
    }
}
