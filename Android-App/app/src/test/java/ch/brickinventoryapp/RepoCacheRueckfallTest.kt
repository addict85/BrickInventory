package ch.brickinventoryapp

import ch.brickinventoryapp.data.api.BrickApiService
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.repository.AdminRepository
import ch.brickinventoryapp.data.repository.Result
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Before
import org.junit.Test
import retrofit2.Retrofit
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * Der Plattencache springt ein — ausser bei einer abgelaufenen Sitzung.
 *
 * ── Was hier geprueft wird und warum es fehlte ──────────────────────────────
 * `RepoBasis.cached()` traegt drei Regeln, und keine davon war bisher durch
 * einen Test gedeckt: BrickRepositoryErrorMappingTest prueft die Nachbarmethode
 * `safeCall()` (sechs Faelle), `cached()` gar nicht.
 *
 *   1. Ein erfolgreicher Abruf fuellt den Cache und gewinnt immer.
 *   2. Scheitert der Abruf, springt der Cache ein — nach einem Neustart ohne
 *      Netz ist die App dadurch gefuellt statt leer.
 *   3. Bei 401 NICHT. Diese Ausnahme ist die eigentliche Aussage: Sonst saehe
 *      der Nutzer eine scheinbar normale Galerie aus bis zu sieben Tage alten
 *      Plattendaten, obwohl seine Sitzung laengst abgelaufen ist — und der
 *      Abmelde-Weg ueber SessionExpiredSignal liefe ins Leere.
 *
 * Regel 3 laesst sich am Quelltext nicht sinnvoll pruefen: Sie ist eine
 * Reihenfolge zwischen drei Zweigen, und ob sie stimmt, zeigt sich erst beim
 * Ausfuehren. Genau deshalb ist das hier ein Verhaltenstest mit echtem Server
 * und echtem Plattencache, kein Mustervergleich.
 *
 * Aufbau wie in BrickRepositoryErrorMappingTest: MockWebServer als Gegenstelle,
 * ResponseCache auf einem Wegwerf-Verzeichnis. AdminRepository ist nur das
 * Vehikel — `cached()` steht in RepoBasis und gilt fuer alle fuenf Teil-Repos.
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
        val client = OkHttpClient.Builder()
            .readTimeout(1, TimeUnit.SECONDS).connectTimeout(1, TimeUnit.SECONDS).build()
        val json = Json {
            ignoreUnknownKeys = true; isLenient = true
            encodeDefaults = true; coerceInputValues = true
        }
        val api = Retrofit.Builder()
            .baseUrl(server.url("/")).client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build().create(BrickApiService::class.java)
        repo = AdminRepository(api, ResponseCache { cacheDir })
    }

    @After
    fun zu() {
        server.shutdown()
        cacheDir.deleteRecursively()
    }

    private fun erfolg(r: Result<*>): Result.Success<*> {
        assert(r is Result.Success) { "Erwartet wurde ein Erfolg, kam aber: $r" }
        return r as Result.Success<*>
    }

    @Test
    fun `ein erfolgreicher Abruf fuellt den Cache`() = runTest {
        server.enqueue(MockResponse().setResponseCode(200).setBody(antwort(1999)))
        val ersteAntwort = erfolg(repo.getCatalogMeta())
        assert((ersteAntwort.data as ch.brickinventoryapp.data.model.CatalogMetaResponse).yearMin == 1999)

        // Zweiter Abruf: Der Server ist kaputt, der Cache traegt.
        server.enqueue(MockResponse().setResponseCode(500))
        val zweiteAntwort = erfolg(repo.getCatalogMeta())
        val daten = zweiteAntwort.data as ch.brickinventoryapp.data.model.CatalogMetaResponse
        assert(daten.yearMin == 1999) {
            "Nach einem Serverfehler muessen die gespeicherten Daten kommen, kam aber: $daten"
        }
        assert(server.requestCount == 2) {
            "Der Cache darf den Abruf nicht ERSETZEN — der Server bleibt die Wahrheit, " +
                "die Platte ist nur die Rueckfallebene. Anfragen: ${server.requestCount}"
        }
    }

    @Test
    fun `frische Daten verdraengen die gespeicherten`() = runTest {
        server.enqueue(MockResponse().setResponseCode(200).setBody(antwort(1999)))
        erfolg(repo.getCatalogMeta())
        server.enqueue(MockResponse().setResponseCode(200).setBody(antwort(2024)))
        val neu = erfolg(repo.getCatalogMeta()).data as ch.brickinventoryapp.data.model.CatalogMetaResponse
        assert(neu.yearMin == 2024) {
            "Der Cache hat die frische Antwort verdraengt — die Reihenfolge ist " +
                "„erst Netz, dann Platte\", nicht umgekehrt. Bekommen: ${neu.yearMin}"
        }
    }

    @Test
    fun `eine abgelaufene Sitzung wird NICHT vom Cache verdeckt`() = runTest {
        // Cache fuellen …
        server.enqueue(MockResponse().setResponseCode(200).setBody(antwort(1999)))
        erfolg(repo.getCatalogMeta())

        // … dann laeuft die Sitzung ab.
        server.enqueue(MockResponse().setResponseCode(401))
        val r = repo.getCatalogMeta()

        assert(r is Result.Error) {
            "Bei 401 darf der Cache NICHT einspringen. Sonst sieht der Nutzer eine " +
                "scheinbar normale Ansicht aus alten Plattendaten, obwohl seine Sitzung " +
                "abgelaufen ist — und der Abmelde-Weg ueber SessionExpiredSignal laeuft " +
                "ins Leere. Bekommen: $r"
        }
        assert((r as Result.Error).unauthorized) {
            "Der Fehler muss als `unauthorized` durchkommen — daran haengt die " +
                "Abmeldung. Bekommen: $r"
        }
    }

    @Test
    fun `ohne gespeicherte Daten bleibt ein Fehler ein Fehler`() = runTest {
        server.enqueue(MockResponse().setResponseCode(500))
        val r = repo.getCatalogMeta()
        assert(r is Result.Error) {
            "Ohne Cache-Eintrag gibt es nichts zurueckzufallen — der Fehler muss " +
                "durchkommen statt in einem leeren Erfolg zu verschwinden. Bekommen: $r"
        }
    }
}
