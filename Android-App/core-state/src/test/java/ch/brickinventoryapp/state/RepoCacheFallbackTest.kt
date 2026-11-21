package ch.brickinventoryapp.state

import ch.brickinventoryapp.model.domain.CatalogMetaView
import ch.brickinventoryapp.data.repository.CatalogRepository
import ch.brickinventoryapp.data.repository.Ergebnis
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Before
import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.testCatalogRepository
import ch.brickinventoryapp.testing.TestApi

/**
 * The store ONLY steps in when the server is not reachable — and then says
 * that it is.
 *
 * `Offlineablage.reconciledSingle()` (Abruf.kt) with a real server (MockWebServer) and
 * the store in memory; CatalogRepository.getCatalogMeta() is only the vehicle.
 *
 * Counter-checks (measured 28.10.2026, kotlinc against the data layer; the rule
 * used to live in the response cache, today in reconciledSingle()):
 *   A  the old rule restored („bei jedem Fehler ausser 401 die Platte“) →
 *      red: „a server error is not hidden by old data“ and
 *      „a 404 is not hidden by old data“
 *   B  in the fallback `stand = stand` left out → red: „ohne Verbindung kommen
 *      die gespeicherten Daten, als veraltet gekennzeichnet“
 *   C  the transient condition left out (fallback on every error) →
 *      red: „an expired session is not hidden by the cache“, plus
 *      the two from A
 */
class RepoCacheFallbackTest {

    private lateinit var server: MockWebServer
    private lateinit var repo: CatalogRepository
    private lateinit var cacheDir: File

    /** A valid catalog response with a recognizable year. */
    private fun antwort(jahr: Int) =
        """{"success":true,"themes":[],"year_min":$jahr,"year_max":$jahr,"year_counts":[]}"""

    @Before
    fun auf() {
        server = MockWebServer()
        server.start()
        cacheDir = File(System.getProperty("java.io.tmpdir"), "bim-cache-${System.nanoTime()}")
        cacheDir.mkdirs()
        repo = testCatalogRepository(TestApi.fuer(server))
    }

    @After
    fun zu() {
        runCatching { server.shutdown() }
        cacheDir.deleteRecursively()
    }

    private fun erfolg(r: Ergebnis<*>): Ergebnis.Erfolg<*> {
        assert(r is Ergebnis.Erfolg) { "Erwartet wurde ein Erfolg, kam aber: $r" }
        return r as Ergebnis.Erfolg<*>
    }

    private suspend fun fillCache(jahr: Int = 1999) {
        server.enqueue(TestApi.antwort(antwort(jahr)))
        val frisch = erfolg(repo.getCatalogMeta())
        assert(!frisch.veraltet) { "Eine frische Antwort darf nicht als veraltet gelten: $frisch" }
    }

    @Test
    fun `without a connection the saved data comes, marked as outdated`() = runTest {
        val vorher = System.currentTimeMillis() - 2000
        fillCache(1999)
        server.shutdown()   // Connection refused: a real network error

        val r = erfolg(repo.getCatalogMeta())
        assert((r.data as CatalogMetaView).jahrMin == 1999) { "Nicht die gespeicherten Daten: $r" }
        val stand = r.stand
        assert(stand != null && r.veraltet) {
            "Der Rückfall trägt keinen Stand — die Liste sähe frisch aus: $r"
        }
        assert(stand!! in vorher..System.currentTimeMillis()) {
            "Der Stand ist nicht der Zeitpunkt der Ablage: $stand"
        }
    }

    @Test
    fun `a server error is not hidden by old data`() = runTest {
        fillCache()
        server.enqueue(MockResponse().setResponseCode(500))
        val r = repo.getCatalogMeta()
        assert(r == Ergebnis.Fehler.Server(500)) {
            "Ein 500 ist eine Auskunft des Servers, kein Netzausfall — er muss " +
                "durchkommen. Bekommen: $r"
        }
    }

    @Test
    fun `a 404 is not hidden by old data`() = runTest {
        fillCache()
        server.enqueue(TestApi.antwort("""{"success":false,"error":"Nicht gefunden"}""", 404))
        val r = repo.getCatalogMeta()
        assert(r is Ergebnis.Fehler && r.message == "Nicht gefunden") { "Bekommen: $r" }
    }

    @Test
    fun `an expired session is not hidden by the cache`() = runTest {
        fillCache()
        server.enqueue(MockResponse().setResponseCode(401))
        val r = repo.getCatalogMeta()
        assert(r is Ergebnis.Fehler.Abgewiesen) {
            "Bei 401 darf der Cache NICHT einspringen, sonst läuft die Abmeldung ins Leere: $r"
        }
    }

    @Test
    fun `fresh data replaces the saved data`() = runTest {
        fillCache(1999)
        server.enqueue(TestApi.antwort(antwort(2024)))
        val neu = erfolg(repo.getCatalogMeta())
        assert((neu.data as CatalogMetaView).jahrMin == 2024 && neu.stand == null) {
            "Erst Netz, dann Platte — bekommen: $neu"
        }
    }

    @Test
    fun `without saved data a network error stays an error`() = runTest {
        server.shutdown()
        val r = repo.getCatalogMeta()
        assert(r is Ergebnis.Fehler && r.transient) {
            "Ohne Cache-Eintrag gibt es nichts zurückzufallen. Bekommen: $r"
        }
    }
}
