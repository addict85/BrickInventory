package ch.brickinventoryapp.state

import ch.brickinventoryapp.data.catalog.CatalogRepository
import ch.brickinventoryapp.data.testing.TestApi
import ch.brickinventoryapp.data.testing.testCatalogRepository
import ch.brickinventoryapp.model.domain.CatalogMetaView
import ch.brickinventoryapp.model.outcome.Outcome
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Before
import org.junit.Test
import java.io.File

/**
 * The store ONLY steps in when the server is not reachable — and then says
 * that it is.
 *
 * `OfflineStore.reconciledSingle()` (Fetch.kt) with a real server (MockWebServer) and
 * the store in memory; CatalogRepository.getCatalogMeta() is only the vehicle.
 *
 * Counter-checks (measured 28.10.2026, kotlinc against the data layer; the rule
 * used to live in the response cache, today in reconciledSingle()):
 *   A  the old rule restored („bei jedem Fehler ausser 401 die Platte“) →
 *      red: „a server error is not hidden by old data“ and
 *      „a 404 is not hidden by old data“
 *   B  in the fallback `state = state` left out → red: „ohne Verbindung kommen die gespeicherten Daten, als veraltet gekennzeichnet“
 *   C  the transient condition left out (fallback on every error) →
 *      red: „an expired session is not hidden by the cache“, plus
 *      the two from A
 */
class RepoCacheFallbackTest {

    private lateinit var server: MockWebServer
    private lateinit var repo: CatalogRepository
    private lateinit var cacheDir: File

    /** A valid catalog response with a recognizable year. */
    private fun response(year: Int) =
        """{"success":true,"themes":[],"year_min":$year,"year_max":$year,"year_counts":[]}"""

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        cacheDir = File(System.getProperty("java.io.tmpdir"), "bim-cache-${System.nanoTime()}")
        cacheDir.mkdirs()
        repo = testCatalogRepository(TestApi.forTarget(server))
    }

    @After
    fun tearDown() {
        runCatching { server.shutdown() }
        cacheDir.deleteRecursively()
    }

    private fun success(r: Outcome<*>): Outcome.Success<*> {
        assert(r is Outcome.Success) { "expected a success, but got: $r" }
        return r as Outcome.Success<*>
    }

    private suspend fun fillCache(year: Int = 1999) {
        server.enqueue(TestApi.response(response(year)))
        val fresh = success(repo.getCatalogMeta())
        assert(!fresh.stale) { "a fresh answer must not count as stale: $fresh" }
    }

    @Test
    fun `without a connection the saved data comes, marked as outdated`() = runTest {
        val before = System.currentTimeMillis() - 2000
        fillCache(1999)
        server.shutdown()   // Connection refused: a real network error

        val r = success(repo.getCatalogMeta())
        assert((r.data as CatalogMetaView).yearMin == 1999) { "not the stored data: $r" }
        val state = r.state
        assert(state != null && r.stale) {
            "the fallback carries no timestamp — the list would look fresh: $r"
        }
        assert(state!! in before..System.currentTimeMillis()) {
            "the timestamp is not the time of storing: $state"
        }
    }

    @Test
    fun `a server error is not hidden by old data`() = runTest {
        fillCache()
        server.enqueue(MockResponse().setResponseCode(500))
        val r = repo.getCatalogMeta()
        assert(r == Outcome.Failure.Server(500)) {
            "A 500 is information from the server, not a network outage — it must " +
                "durchkommen. Bekommen: $r"
        }
    }

    @Test
    fun `a 404 is not hidden by old data`() = runTest {
        fillCache()
        server.enqueue(TestApi.response("""{"success":false,"error":"Nicht gefunden"}""", 404))
        val r = repo.getCatalogMeta()
        assert(r is Outcome.Failure && r.message == "Nicht gefunden") { "Bekommen: $r" }
    }

    @Test
    fun `an expired session is not hidden by the cache`() = runTest {
        fillCache()
        server.enqueue(MockResponse().setResponseCode(401))
        val r = repo.getCatalogMeta()
        assert(r is Outcome.Failure.Rejected) {
            "On 401 the cache must NOT step in, otherwise the sign-out comes to nothing: $r"
        }
    }

    @Test
    fun `fresh data replaces the saved data`() = runTest {
        fillCache(1999)
        server.enqueue(TestApi.response(response(2024)))
        val newValue = success(repo.getCatalogMeta())
        assert((newValue.data as CatalogMetaView).yearMin == 2024 && newValue.state == null) {
            "network first, then disk — got: $newValue"
        }
    }

    @Test
    fun `without saved data a network error stays an error`() = runTest {
        server.shutdown()
        val r = repo.getCatalogMeta()
        assert(r is Outcome.Failure && r.transient) {
            "without a cache entry there is nothing to fall back to. Got: $r"
        }
    }
}
