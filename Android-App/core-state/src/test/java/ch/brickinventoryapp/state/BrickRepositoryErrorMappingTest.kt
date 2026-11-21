package ch.brickinventoryapp.state

import ch.brickinventoryapp.network.util.NetworkPolicy
import ch.brickinventoryapp.testing.BrickApiService
import ch.brickinventoryapp.data.repository.AccountRepository
import ch.brickinventoryapp.data.repository.Ergebnis
import kotlinx.coroutines.test.runTest
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Before
import org.junit.Test
import retrofit2.Retrofit
import java.io.File
import java.util.concurrent.TimeUnit
import ch.brickinventoryapp.model.json.BrickJson
import ch.brickinventoryapp.network.di.ServerWaechter
import ch.brickinventoryapp.network.di.Zugangslage
import ch.brickinventoryapp.testing.testAccountRepository

/**
 * The first test in this project that runs BEHAVIOR instead of reading
 * source code.
 *
 * ── Why this wasn't possible before ──────────────────────────────
 *
 * `testImplementation(libs.junit)` was the only test dependency. Without a
 * test library for coroutines and without an HTTP fake, all that was left was
 * scanning the source code for patterns — which is why 41 of 47 test files read text.
 *
 * Here a real HTTP server now runs in the test, and what's checked is the
 * mapping: what does the repository make
 * of a response? The counter-check for that is the server itself — if it
 * answers differently, the result has to change.
 *
 * Two things were needed for this and are the actual gain:
 *  - [ResponseCache] can be built with a throwaway directory instead of
 *    a `Context`.
 *  - The mapping from cause to text lives in `fehlerTextId()` and no longer needs a
 *    `Context` (see ErrorTextsTest).
 */
class BrickRepositoryErrorMappingTest {

    private lateinit var server: MockWebServer
    private lateinit var repo: AccountRepository
    private lateinit var cacheDir: File

    /** Short timeouts: the timeout case shouldn't slow down the run. */
    private fun buildRepo(readDeadlineMs: Long = 1_000, guard: okhttp3.Interceptor? = null): AccountRepository {
        val client = OkHttpClient.Builder()
            .apply { guard?.let { addInterceptor(it) } }
            .readTimeout(readDeadlineMs, TimeUnit.MILLISECONDS)
            .connectTimeout(readDeadlineMs, TimeUnit.MILLISECONDS)
            .build()
        // The same JSON configuration as in di/AppModule — otherwise the
        // test would be checking a leniency the app doesn't have.
        val json = BrickJson
        val api = Retrofit.Builder()
            .baseUrl(server.url("/"))
            .client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(BrickApiService::class.java)
        // AccountRepository instead of BrickRepository: getMe() has lived
        // there since the split. What's checked here is the error mapping in
        // sicherAufrufen() — that lives in Abruf.kt and is the same for all five
        // sub-repositories; getMe is only the vehicle.
        return testAccountRepository(api)
    }

    @Before
    fun auf() {
        server = MockWebServer()
        server.start()
        cacheDir = File(System.getProperty("java.io.tmpdir"), "bim-test-${System.nanoTime()}")
        cacheDir.mkdirs()
        repo = buildRepo()
    }

    @After
    fun zu() {
        server.shutdown()
        cacheDir.deleteRecursively()
    }

    private fun fehler(r: Ergebnis<*>): Ergebnis.Fehler {
        assert(r is Ergebnis.Fehler) { "Erwartet wurde ein Fehler, kam aber: $r" }
        return r as Ergebnis.Fehler
    }

    @Test
    fun `error body of the server wins over the own classification`() = runTest {
        // The server knows its own cases more precisely than any enumeration in the app —
        // and answers in the account's language.
        server.enqueue(
            MockResponse().setResponseCode(409)
                .setBody("""{"success":false,"error":"Für dieses Datum gibt es schon einen Kaufpreis"}""")
        )
        val e = fehler(repo.getMe())
        assert(e.message == "Für dieses Datum gibt es schon einen Kaufpreis") {
            "Servermeldung ging verloren: '${e.message}'"
        }
        assert(e == Ergebnis.Fehler.Server(409, "Für dieses Datum gibt es schon einen Kaufpreis")) {
            "Bei vorhandener Servermeldung bleibt es ein Serverfehler mit ihrem Satz, war: $e"
        }
    }

    @Test
    fun `error code without body is classified as server error`() = runTest {
        server.enqueue(MockResponse().setResponseCode(500).setBody(""))
        val e = fehler(repo.getMe())
        assert(e is Ergebnis.Fehler.Server && e.status == 500) { "Art war $e" }
        assert(e.message.isBlank()) {
            "Die Datenschicht darf keinen Satz bauen, tat es aber: '${e.message}'"
        }
    }

    @Test
    fun `401 is reported as expired session and not as transient`() = runTest {
        // The distinction is the reason for a kind of its own: a
        // retry never fixes a 401, and cached() must not cover it up with
        // an old response from disk.
        server.enqueue(MockResponse().setResponseCode(401).setBody(""))
        val e = fehler(repo.getMe())
        assert(e is Ergebnis.Fehler.Abgewiesen) { "Art war $e" }
        assert(!e.transient) { "401 darf nicht als vorübergehend gelten" }
    }

    @Test
    fun `timeout is temporary`() = runTest {
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
        val e = fehler(buildRepo(readDeadlineMs = 300).getMe())
        assert(e.transient) { "Zeitüberschreitung muss als vorübergehend gelten" }
        assert(e == Ergebnis.Fehler.Zeitueberschreitung) { "Art war $e" }
    }

    @Test
    fun `dropped connection is a network error and temporary`() = runTest {
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START))
        val e = fehler(repo.getMe())
        assert(e is Ergebnis.Fehler.Netz && e.transient) { "Abriss muss als vorübergehend gelten, war: $e" }
        assert(e.message.isBlank()) { "Kein Satz aus der Datenschicht, war: '${e.message}'" }
    }

    /**
     * A stored http address: the release build's guard rejects it, and
     * that becomes a dedicated message with instructions instead of „no connection“.
     * Counter-check: removed the branch for PlaintextRejected in
     * sicherAufrufen() → red (Netz, vorübergehend).
     */
    @Test
    fun `a rejected http request is not a network error and not temporary`() = runTest {
        val situation = object : Zugangslage {
            override fun serverUrl() = server.url("/").toString()
            override fun token() = "geheim"
            override fun tokenOrigin(): String? = NetworkPolicy.herkunft(serverUrl())
            override fun generation() = 0L
        }
        val guard = ServerWaechter(situation, false, entwicklung = false, sitzungAbgelaufen = {})
        val e = fehler(buildRepo(guard = guard).getMe())
        assert(e == Ergebnis.Fehler.Klartext) { "Art war $e" }
        assert(!e.transient) { "Ein zweiter Versuch ginge genauso an http" }
        assert(server.requestCount == 0) { "Die Anfrage ging trotzdem hinaus" }
    }

    @Test
    fun `a valid response is a success`() = runTest {
        // Counter-check for all error cases: without it the mapping could also be
        // green if simply EVERYTHING ended up as an error.
        server.enqueue(
            MockResponse().setResponseCode(200)
                .setBody("""{"success":true,"user":{"id":1,"username":"marco"}}""")
        )
        // `when` instead of a cast: Ergebnis has exactly two variants, so it's
        // exhaustive — and the smart cast in the branch supplies the type along with it.
        when (val r = repo.getMe()) {
            is Ergebnis.Erfolg -> assert(r.data?.benutzer == "marco") { "Konto nicht gelesen: ${r.data}" }
            is Ergebnis.Fehler   -> assert(false) { "Erwartet wurde Erfolg, kam: $r" }
        }
    }
}
