package ch.brickinventoryapp.data

import ch.brickinventoryapp.network.util.NetworkPolicy
import ch.brickinventoryapp.data.api.AccountApi
import ch.brickinventoryapp.data.repository.AccountRepository
import ch.brickinventoryapp.network.di.ServerWaechter
import ch.brickinventoryapp.network.di.Zugangslage
import ch.brickinventoryapp.security.Tresorbefund
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
 *      “a job for a different server sends nothing” (gegenproben/entwerter-ohne-herkunft.patch)
 *   F  redemptionStep(): Gesperrt gives up after the maximum attempts even with a locked device
 *      (`!deviceLocked &&` removed) → red “with a locked device the job does not give up”
 *      (gegenproben/entwertung-gibt-bei-sperre-auf.patch; CI only)
 */
class RedemptionTest {

    private val server = MockWebServer().apply { start() }
    private val dir = File(System.getProperty("java.io.tmpdir"), "bim-ew-${System.nanoTime()}")

    @After
    fun zu() {
        runCatching { server.shutdown() }
        dir.deleteRecursively()
    }

    private fun konto(): AccountRepository {
        val situation = object : Zugangslage {
            override fun serverUrl() = server.url("/").toString().trimEnd('/')
            override fun token() = "geheim"
            override fun tokenOrigin(): String? = NetworkPolicy.herkunft(serverUrl())
            override fun generation() = 0L
        }
        val client = OkHttpClient.Builder()
            .addInterceptor(ServerWaechter(situation, true, entwicklung = true, sitzungAbgelaufen = {}))
            .readTimeout(2, TimeUnit.SECONDS).build()
        return testAccountRepository(Retrofit.Builder().baseUrl(server.url("/")).client(client)
            .addConverterFactory(BrickJson.asConverterFactory("application/json".toMediaType()))
            .build().create(AccountApi::class.java))
    }

    private val job = Entwertungsauftrag("https://brick.example", "GEHEIMTEXT")

    private fun abmelden(): Pair<Abmeldeweg, List<Entwertungsauftrag>> {
        val geplant = mutableListOf<Entwertungsauftrag>()
        val weg = runBlocking { Abmeldung(konto(), { job }, { geplant += it }).atServer() }
        return weg to geplant
    }

    @Test
    fun `if the attempt succeeds, the queue stays empty`() {
        server.enqueue(MockResponse().setBody("""{"success":true}"""))
        assertEquals(Abmeldeweg.SOFORT to emptyList<Entwertungsauftrag>(), abmelden())
    }

    @Test
    fun `if the attempt fails, a job goes into the queue`() {
        server.enqueue(MockResponse().setResponseCode(503))
        assertEquals(Abmeldeweg.CAUGHT_UP to listOf(job), abmelden())
        server.shutdown()
        assertEquals("Ohne Server ebenso", Abmeldeweg.CAUGHT_UP to listOf(job), abmelden())
    }

    @Test
    fun `a token that is already no longer valid needs no job`() {
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":"x"}"""))
        assertEquals(Abmeldeweg.SOFORT to emptyList<Entwertungsauftrag>(), abmelden())
        server.enqueue(MockResponse().setResponseCode(404))
        assertEquals("Ein Server ohne Abmelde-Endpunkt wird es nie haben",
            Abmeldeweg.WITHOUT_JOB to emptyList<Entwertungsauftrag>(), abmelden())
    }

    @Test
    fun `the canceller sends exactly this token to exactly this server`() {
        val redeemer = Redeemer(OkHttpClient.Builder().readTimeout(2, TimeUnit.SECONDS).build(), entwicklung = true)
        val basis = server.url("/brick").toString().trimEnd('/')
        server.enqueue(MockResponse().setBody("""{"success":true}"""))
        assertEquals(Entwertungsergebnis.ENTWERTET, redeemer.redeem(basis, "altes-token"))
        val a = server.takeRequest(1, TimeUnit.SECONDS)!!
        assertEquals("POST", a.method)
        assertEquals("/brick/api/v1/auth/logout", a.path)
        assertEquals("Bearer altes-token", a.getHeader("Authorization"))

        server.enqueue(MockResponse().setResponseCode(401))
        assertEquals(Entwertungsergebnis.ENTWERTET, redeemer.redeem(basis, "altes-token"))
        server.enqueue(MockResponse().setResponseCode(503))
        assertEquals(Entwertungsergebnis.LATER, redeemer.redeem(basis, "altes-token"))
        server.enqueue(MockResponse().setResponseCode(307).setHeader("Location", "/andere-app/fang"))
        assertEquals("Aus dem Pfad hinaus folgt er nicht", Entwertungsergebnis.GIVE_UP, redeemer.redeem(basis, "altes-token"))
        server.takeRequest(1, TimeUnit.SECONDS); server.takeRequest(1, TimeUnit.SECONDS); server.takeRequest(1, TimeUnit.SECONDS)
        assertNull(server.takeRequest(200, TimeUnit.MILLISECONDS))

        val klartext = Redeemer(OkHttpClient(), entwicklung = false)
        assertEquals("Kein Token im Klartext, auch nicht später", Entwertungsergebnis.GIVE_UP, klartext.redeem(basis, "t"))
        server.shutdown()
        assertEquals(Entwertungsergebnis.LATER, redeemer.redeem(basis, "altes-token"))
    }

    @Test
    fun `a job for a different server sends nothing`() {
        val redeemer = Redeemer(OkHttpClient.Builder().readTimeout(2, TimeUnit.SECONDS).build(), entwicklung = true)
        val b = server.url("/").toString().trimEnd('/')
        server.enqueue(MockResponse().setResponseCode(503))
        assertEquals(Entwertungsergebnis.GIVE_UP, redeemer.redeem(b, "token-von-a", herkunft = "https://a.example"))
        assertEquals(Entwertungsergebnis.GIVE_UP, redeemer.redeem(b, "token-von-a", herkunft = null))
        assertEquals("Das Token von A ging an B", 0, server.requestCount)
        assertEquals("Ohne Angabe gehört das Token dem Server des Auftrags",
            NetworkPolicy.herkunft(b), Entwertungsauftrag(b, "x").herkunft)
    }

    @Test
    fun `a locked keystore waits, a lost key ends the job`() {
        var called = 0
        val redeem = { _: String -> called++; Entwertungsergebnis.LATER }
        assertEquals(Entwertungsschritt.AGAIN, redemptionStep(Tresorbefund.Gesperrt, 0, redeem = redeem))
        assertEquals(Entwertungsschritt.GIVEN_UP, redemptionStep(Tresorbefund.Weg, 0, redeem = redeem))
        assertEquals("Ohne Token kein Aufruf", 0, called)
        assertEquals(Entwertungsschritt.AGAIN, redemptionStep(Tresorbefund.Readable("t"), 0, redeem = redeem))
        assertEquals(Entwertungsschritt.GIVEN_UP,
            redemptionStep(Tresorbefund.Readable("t"), REDEMPTION_MAX_ATTEMPTS - 1, redeem = redeem))
        assertEquals(Entwertungsschritt.FERTIG,
            redemptionStep(Tresorbefund.Readable("t"), 3) { Entwertungsergebnis.ENTWERTET })
        assertTrue(REDEMPTION_MAX_ATTEMPTS >= 10)
    }

    /** The token's key works only unlocked: locked for days is no failure. */
    @Test
    fun `with a locked device the job does not give up`() {
        val letzter = REDEMPTION_MAX_ATTEMPTS - 1
        val redeem = { _: String -> Entwertungsergebnis.LATER }
        assertEquals(Entwertungsschritt.AGAIN,
            redemptionStep(Tresorbefund.Gesperrt, letzter, deviceLocked = true, redeem = redeem))
        assertEquals(Entwertungsschritt.AGAIN,
            redemptionStep(Tresorbefund.Gesperrt, letzter * 3, deviceLocked = true, redeem = redeem))
        assertEquals("Entsperrt und weiter gesperrt: ein anderer Fehler, der aufgibt", Entwertungsschritt.GIVEN_UP,
            redemptionStep(Tresorbefund.Gesperrt, letzter, deviceLocked = false, redeem = redeem))
    }
}
