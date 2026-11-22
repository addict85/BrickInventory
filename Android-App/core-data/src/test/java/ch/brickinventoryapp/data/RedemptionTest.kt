package ch.brickinventoryapp.data

import ch.brickinventoryapp.network.util.NetworkPolicy
import ch.brickinventoryapp.data.api.AccountApi
import ch.brickinventoryapp.data.repository.AccountRepository
import ch.brickinventoryapp.network.di.ServerGuard
import ch.brickinventoryapp.network.di.AccessState
import ch.brickinventoryapp.security.VaultFinding
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.Retrofit
import java.io.File
import java.util.concurrent.TimeUnit
import ch.brickinventoryapp.model.json.BrickJson
import ch.brickinventoryapp.testing.testAccountRepository

/**
 * Signing out without network does not leave the token valid at the server: if
 * the short attempt fails, a job goes into the queue that retries until the
 * server confirms. The worker itself (WorkManager) runs only on the device;
 * checked are sign-out, canceller and the decision per run.
 *
 * Counter-checks:
 *   A  Abmeldung.atServer() without planer.plane() → red “if the attempt fails, a
 *      job goes into the queue”
 *   B  classifyRedemption(): 401 as LATER → red “a token that is already no
 *      longer valid needs no job” and “the canceller …” (401 case)
 *   C  canceller without its own guard (basis unchanged) → red “the canceller
 *      sends exactly this token …” (no Authorization header)
 *   D  redemptionStep(): Gesperrt → GIVEN_UP → red “a locked keystore
 *      waits …”
 *   E in entwerte() the check of the origin removed → red
 *      “a job for a different server sends nothing” (counter-checks/entwerter-ohne-herkunft.patch)
 *   F  redemptionStep(): Gesperrt gives up after the maximum attempts even with a locked device
 *      (`!deviceLocked &&` removed) → red “with a locked device the job does not give up”
 *      (counter-checks/entwertung-gibt-bei-sperre-auf.patch; CI only)
 */
class RedemptionTest {

    private val server = MockWebServer().apply { start() }
    private val dir = File(System.getProperty("java.io.tmpdir"), "bim-ew-${System.nanoTime()}")

    @After
    fun tearDown() {
        runCatching { server.shutdown() }
        dir.deleteRecursively()
    }

    private fun account(): AccountRepository {
        val situation = object : AccessState {
            override fun serverUrl() = server.url("/").toString().trimEnd('/')
            override fun token() = "geheim"
            override fun tokenOrigin(): String? = NetworkPolicy.origin(serverUrl())
            override fun generation() = 0L
        }
        val client = OkHttpClient.Builder()
            .addInterceptor(ServerGuard(situation, true, development = true, sessionExpired = {}))
            .readTimeout(2, TimeUnit.SECONDS).build()
        return testAccountRepository(Retrofit.Builder().baseUrl(server.url("/")).client(client)
            .addConverterFactory(BrickJson.asConverterFactory("application/json".toMediaType()))
            .build().create(AccountApi::class.java))
    }

    private val job = RedemptionJob("https://brick.example", "GEHEIMTEXT")

    private fun logout(): Pair<LogoutPath, List<RedemptionJob>> {
        val scheduled = mutableListOf<RedemptionJob>()
        val gone = runBlocking { LogoutState(account(), { job }, { scheduled += it }).atServer() }
        return gone to scheduled
    }

    @Test
    fun `if the attempt succeeds, the queue stays empty`() {
        server.enqueue(MockResponse().setBody("""{"success":true}"""))
        assertEquals(LogoutPath.IMMEDIATE to emptyList<RedemptionJob>(), logout())
    }

    @Test
    fun `if the attempt fails, a job goes into the queue`() {
        server.enqueue(MockResponse().setResponseCode(503))
        assertEquals(LogoutPath.CAUGHT_UP to listOf(job), logout())
        server.shutdown()
        assertEquals("Ohne Server ebenso", LogoutPath.CAUGHT_UP to listOf(job), logout())
    }

    @Test
    fun `a token that is already no longer valid needs no job`() {
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":"x"}"""))
        assertEquals(LogoutPath.IMMEDIATE to emptyList<RedemptionJob>(), logout())
        server.enqueue(MockResponse().setResponseCode(404))
        assertEquals("Ein Server ohne Abmelde-Endpunkt wird es nie haben",
            LogoutPath.WITHOUT_JOB to emptyList<RedemptionJob>(), logout())
    }

    @Test
    fun `the canceller sends exactly this token to exactly this server`() {
        val redeemer = Redeemer(OkHttpClient.Builder().readTimeout(2, TimeUnit.SECONDS).build(), development = true)
        val basis = server.url("/brick").toString().trimEnd('/')
        server.enqueue(MockResponse().setBody("""{"success":true}"""))
        assertEquals(RedemptionOutcome.REDEEMED, redeemer.redeem(basis, "altes-token"))
        val a = server.takeRequest(1, TimeUnit.SECONDS)!!
        assertEquals("POST", a.method)
        assertEquals("/brick/api/v1/auth/logout", a.path)
        assertEquals("Bearer altes-token", a.getHeader("Authorization"))

        server.enqueue(MockResponse().setResponseCode(401))
        assertEquals(RedemptionOutcome.REDEEMED, redeemer.redeem(basis, "altes-token"))
        server.enqueue(MockResponse().setResponseCode(503))
        assertEquals(RedemptionOutcome.LATER, redeemer.redeem(basis, "altes-token"))
        server.enqueue(MockResponse().setResponseCode(307).setHeader("Location", "/andere-app/fang"))
        assertEquals("Aus dem Pfad hinaus folgt er nicht", RedemptionOutcome.GIVE_UP, redeemer.redeem(basis, "altes-token"))
        server.takeRequest(1, TimeUnit.SECONDS); server.takeRequest(1, TimeUnit.SECONDS); server.takeRequest(1, TimeUnit.SECONDS)
        assertNull(server.takeRequest(200, TimeUnit.MILLISECONDS))

        val plaintext = Redeemer(OkHttpClient(), development = false)
        assertEquals("Kein Token im Klartext, auch nicht später", RedemptionOutcome.GIVE_UP, plaintext.redeem(basis, "t"))
        server.shutdown()
        assertEquals(RedemptionOutcome.LATER, redeemer.redeem(basis, "altes-token"))
    }

    @Test
    fun `a job for a different server sends nothing`() {
        val redeemer = Redeemer(OkHttpClient.Builder().readTimeout(2, TimeUnit.SECONDS).build(), development = true)
        val b = server.url("/").toString().trimEnd('/')
        server.enqueue(MockResponse().setResponseCode(503))
        assertEquals(RedemptionOutcome.GIVE_UP, redeemer.redeem(b, "token-von-a", origin = "https://a.example"))
        assertEquals(RedemptionOutcome.GIVE_UP, redeemer.redeem(b, "token-von-a", origin = null))
        assertEquals("Das Token von A ging an B", 0, server.requestCount)
        assertEquals("Ohne Angabe gehört das Token dem Server des Auftrags",
            NetworkPolicy.origin(b), RedemptionJob(b, "x").origin)
    }

    @Test
    fun `a locked keystore waits, a lost key ends the job`() {
        var called = 0
        val redeem = { _: String -> called++; RedemptionOutcome.LATER }
        assertEquals(RedemptionStep.AGAIN, redemptionStep(VaultFinding.LockedState, 0, redeem = redeem))
        assertEquals(RedemptionStep.GIVEN_UP, redemptionStep(VaultFinding.Gone, 0, redeem = redeem))
        assertEquals("Ohne Token kein Aufruf", 0, called)
        assertEquals(RedemptionStep.AGAIN, redemptionStep(VaultFinding.Readable("t"), 0, redeem = redeem))
        assertEquals(RedemptionStep.GIVEN_UP,
            redemptionStep(VaultFinding.Readable("t"), REDEMPTION_MAX_ATTEMPTS - 1, redeem = redeem))
        assertEquals(RedemptionStep.DONE,
            redemptionStep(VaultFinding.Readable("t"), 3) { RedemptionOutcome.REDEEMED })
        assertTrue(REDEMPTION_MAX_ATTEMPTS >= 10)
    }

    /** The token's key works only unlocked: locked for days is no failure. */
    @Test
    fun `with a locked device the job does not give up`() {
        val last = REDEMPTION_MAX_ATTEMPTS - 1
        val redeem = { _: String -> RedemptionOutcome.LATER }
        assertEquals(RedemptionStep.AGAIN,
            redemptionStep(VaultFinding.LockedState, last, deviceLocked = true, redeem = redeem))
        assertEquals(RedemptionStep.AGAIN,
            redemptionStep(VaultFinding.LockedState, last * 3, deviceLocked = true, redeem = redeem))
        assertEquals("Entsperrt und weiter gesperrt: ein anderer Fehler, der aufgibt", RedemptionStep.GIVEN_UP,
            redemptionStep(VaultFinding.LockedState, last, deviceLocked = false, redeem = redeem))
    }
}
