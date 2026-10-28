package ch.brickinventoryapp

import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.model.CatalogMetaResponse
import ch.brickinventoryapp.data.repository.AdminRepository
import ch.brickinventoryapp.data.repository.Fehlerart
import ch.brickinventoryapp.data.repository.Result
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Before
import org.junit.Test
import java.io.File

/**
 * Der Plattenspeicher springt NUR ein, wenn der Server nicht erreichbar ist —
 * und sagt dann, dass er es ist.
 *
 * `RepoBasis.cached()` mit echtem Server (MockWebServer) und echtem
 * Plattenspeicher; AdminRepository.getCatalogMeta() ist nur das Vehikel.
 *
 * Gegenproben (am 28.10.2026 gemessen, kotlinc gegen die Datenschicht):
 *   A  die alte Regel zurück („bei jedem Fehler ausser 401 die Platte“) →
 *      rot: „ein Serverfehler wird nicht von alten Daten verdeckt“ und
 *      „ein 404 wird nicht von alten Daten verdeckt“
 *   B  im Rückfall `stand = stand` weggelassen → rot: „ohne Verbindung kommen
 *      die gespeicherten Daten, als veraltet gekennzeichnet“
 *   C  die transient-Bedingung weggelassen (Rückfall bei jedem Fehler) →
 *      rot: „eine abgelaufene Sitzung wird nicht vom Cache verdeckt“, dazu
 *      die beiden aus A
 */
class RepoCacheRueckfallTest {

    private lateinit var server: MockWebServer
    private lateinit var repo: AdminRepository
    private lateinit var cacheDir: File

    /** Eine gueltige Katalog-Antwort mit erkennbarer Jahreszahl. */
    private fun antwort(jahr: Int) =
        """{"success":true,"themes":[],"year_min":$jahr,"year_max":$jahr,"year_counts":[]}"""

    @Before
    fun auf() {
        server = MockWebServer()
        server.start()
        cacheDir = File(System.getProperty("java.io.tmpdir"), "bim-cache-${System.nanoTime()}")
        cacheDir.mkdirs()
        repo = AdminRepository(TestApi.fuer(server), ResponseCache { cacheDir })
    }

    @After
    fun zu() {
        runCatching { server.shutdown() }
        cacheDir.deleteRecursively()
    }

    private fun erfolg(r: Result<*>): Result.Success<*> {
        assert(r is Result.Success) { "Erwartet wurde ein Erfolg, kam aber: $r" }
        return r as Result.Success<*>
    }

    private suspend fun cacheFuellen(jahr: Int = 1999) {
        server.enqueue(TestApi.antwort(antwort(jahr)))
        val frisch = erfolg(repo.getCatalogMeta())
        assert(!frisch.veraltet) { "Eine frische Antwort darf nicht als veraltet gelten: $frisch" }
    }

    @Test
    fun `ohne Verbindung kommen die gespeicherten Daten, als veraltet gekennzeichnet`() = runTest {
        val vorher = System.currentTimeMillis() - 2000
        cacheFuellen(1999)
        server.shutdown()   // Verbindung verweigert: ein echter Netzfehler

        val r = erfolg(repo.getCatalogMeta())
        assert((r.data as CatalogMetaResponse).yearMin == 1999) { "Nicht die gespeicherten Daten: $r" }
        val stand = r.stand
        assert(stand != null && r.veraltet) {
            "Der Rückfall trägt keinen Stand — die Liste sähe frisch aus: $r"
        }
        assert(stand!! in vorher..System.currentTimeMillis()) {
            "Der Stand ist nicht der Zeitpunkt der Ablage: $stand"
        }
    }

    @Test
    fun `ein Serverfehler wird nicht von alten Daten verdeckt`() = runTest {
        cacheFuellen()
        server.enqueue(MockResponse().setResponseCode(500))
        val r = repo.getCatalogMeta()
        assert(r is Result.Error && r.httpCode == 500 && r.art == Fehlerart.SERVER) {
            "Ein 500 ist eine Auskunft des Servers, kein Netzausfall — er muss " +
                "durchkommen. Bekommen: $r"
        }
    }

    @Test
    fun `ein 404 wird nicht von alten Daten verdeckt`() = runTest {
        cacheFuellen()
        server.enqueue(TestApi.antwort("""{"success":false,"error":"Nicht gefunden"}""", 404))
        val r = repo.getCatalogMeta()
        assert(r is Result.Error && r.message == "Nicht gefunden") { "Bekommen: $r" }
    }

    @Test
    fun `eine abgelaufene Sitzung wird nicht vom Cache verdeckt`() = runTest {
        cacheFuellen()
        server.enqueue(MockResponse().setResponseCode(401))
        val r = repo.getCatalogMeta()
        assert(r is Result.Error && r.unauthorized) {
            "Bei 401 darf der Cache NICHT einspringen, sonst läuft die Abmeldung ins Leere: $r"
        }
    }

    @Test
    fun `frische Daten verdraengen die gespeicherten`() = runTest {
        cacheFuellen(1999)
        server.enqueue(TestApi.antwort(antwort(2024)))
        val neu = erfolg(repo.getCatalogMeta())
        assert((neu.data as CatalogMetaResponse).yearMin == 2024 && neu.stand == null) {
            "Erst Netz, dann Platte — bekommen: $neu"
        }
    }

    @Test
    fun `ohne gespeicherte Daten bleibt ein Netzfehler ein Fehler`() = runTest {
        server.shutdown()
        val r = repo.getCatalogMeta()
        assert(r is Result.Error && r.transient) {
            "Ohne Cache-Eintrag gibt es nichts zurückzufallen. Bekommen: $r"
        }
    }
}
