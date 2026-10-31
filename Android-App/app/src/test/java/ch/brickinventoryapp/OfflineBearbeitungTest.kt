package ch.brickinventoryapp

import ch.brickinventoryapp.data.cache.ResponseCache
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import okhttp3.MediaType.Companion.toMediaType
import ch.brickinventoryapp.data.lokal.Abgleich
import ch.brickinventoryapp.data.lokal.Abgleichsereignis
import ch.brickinventoryapp.data.lokal.Abgleichsergebnis
import ch.brickinventoryapp.data.lokal.Bearbeitung
import ch.brickinventoryapp.data.lokal.Faecher
import ch.brickinventoryapp.data.lokal.Offlineablage
import ch.brickinventoryapp.data.lokal.ServerSender
import ch.brickinventoryapp.data.lokal.SpeicherAusgang
import ch.brickinventoryapp.data.lokal.SpeicherBestand
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.data.repository.SetsRepository
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.util.Collections

/**
 * Offline bearbeiten von Anfang bis Ende: Repository, Ausgang und Sender gegen
 * einen Testserver, der die Verbindung auf Wunsch abreisst.
 *
 * Gegenproben (30.10.2026, gemessen):
 *   A  in RepoBasis.schreibe den Zweig für transiente Fehler entfernt → rot
 *      „ohne Verbindung geht die Menge in den Ausgang“ (Result.Error statt gepuffert)
 *   B  in RepoBasis.schreibe die Prüfung `ablage.wartet()` entfernt → rot
 *      „wartet etwas, geht Neues dahinter“ (die zweite Änderung ging direkt raus)
 *   C  in ServerSender für SetMenge `quantity = schritt` statt `quantityDelta` →
 *      rot „gesendet wird der Schritt“
 *   D  in RepoBasis.abgeglichen den Rückfall auf die Ablage entfernt → rot
 *      „ohne Verbindung kommt die Liste aus der Ablage“
 */
class OfflineBearbeitungTest {

    private class Server {
        @Volatile var offline = false
        val anfragen: MutableList<String> = Collections.synchronizedList(mutableListOf())
        val codes: MutableMap<String, Pair<Int, String>> = Collections.synchronizedMap(mutableMapOf())
        val server = MockWebServer().apply {
            dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    val pfad = request.path.orEmpty().substringBefore('?')
                    anfragen += "${request.method} $pfad ${request.body.readUtf8()}"
                    codes["${request.method} $pfad"]?.let { (c, r) -> return TestApi.antwort(r, c) }
                    return when {
                        request.method == "GET" && pfad == "/api/v1/sets" -> TestApi.antwort(
                            """{"success":true,"count":1,"total":1,"themes":[],"sets":[{"set_number":"10001-1","name":"Haus","quantity":1}]}""")
                        else -> TestApi.antwort("""{"success":true}""")
                    }
                }
            }
            start()
        }
    }

    private val s = Server()
    private val cacheDir = File(System.getProperty("java.io.tmpdir"), "bim-offline-${System.nanoTime()}")
    private val ablage = Offlineablage(SpeicherBestand(), SpeicherAusgang(), { "konto" })
    /** Ohne Netz: Die Verbindung kommt gar nicht erst zustande, wie im Funkloch. */
    private val api = retrofit2.Retrofit.Builder().baseUrl(s.server.url("/"))
        .client(okhttp3.OkHttpClient.Builder().addInterceptor { kette ->
            if (s.offline) throw java.net.ConnectException("kein Netz") else kette.proceed(kette.request())
        }.build())
        .addConverterFactory(ch.brickinventoryapp.data.api.ApiJson.asConverterFactory("application/json".toMediaType()))
        .build().create(ch.brickinventoryapp.data.api.BrickApiService::class.java)
    private val repo = SetsRepository(api, ResponseCache { cacheDir }, ablage)
    private val abgleich = Abgleich(ablage, ServerSender(api, api, api))

    @After
    fun zu() {
        s.server.shutdown()
        cacheDir.deleteRecursively()
    }

    @Test
    fun `ohne Verbindung geht die Menge in den Ausgang und gesendet wird der Schritt`() = runBlocking {
        assertTrue(repo.getSets() is Result.Success)
        s.offline = true
        val r = repo.aendereMengeUm("10001-1", 1)
        assertTrue("Erwartet: offline gespeichert, kam $r", r is Result.Success && r.gepuffert)
        assertEquals(2, ablage.lies(Faecher.SETS)!!.liste.single().quantity)
        assertEquals(listOf(Bearbeitung.SetMenge("10001-1", 1)), ablage.ausgang.alle("konto").map { it.bearbeitung })

        assertEquals(Abgleichsergebnis.SPAETER, abgleich.sende())
        s.offline = false
        assertEquals(Abgleichsergebnis.FERTIG, abgleich.sende())
        assertEquals(listOf("PUT /api/v1/sets/10001-1 {\"quantity_delta\":1}"), s.anfragen.filter { it.startsWith("PUT") })
        assertEquals(0, ablage.ausgang.alle("konto").size)
    }

    @Test
    fun `ohne Verbindung kommt die Liste aus der Ablage, samt Stand`() = runBlocking {
        repo.getSets()
        s.offline = true
        repo.aendereMengeUm("10001-1", 1)
        val r = repo.getSets()
        assertTrue("Erwartet: Erfolg aus der Ablage, kam $r", r is Result.Success && r.veraltet)
        assertEquals(2, (r as Result.Success).data.sets.single().quantity)
    }

    @Test
    fun `wartet etwas, geht Neues dahinter`() = runBlocking {
        repo.getSets()
        s.offline = true
        repo.aendereMengeUm("10001-1", 1)
        s.offline = false
        // Der Server ist wieder da, aber der Ausgang ist noch nicht gesendet:
        // Eine direkte Anfrage überholte die erste Änderung.
        val r = repo.aendereMengeUm("10001-1", 1)
        assertTrue(r is Result.Success && r.gepuffert)
        assertEquals(emptyList<String>(), s.anfragen.filter { it.startsWith("PUT") })
        abgleich.sende()
        assertEquals(2, s.anfragen.count { it.startsWith("PUT /api/v1/sets/10001-1") })
    }

    @Test
    fun `online geht eine Änderung direkt und steht auch lokal`() = runBlocking {
        repo.getSets()
        val r = repo.aendereMengeUm("10001-1", 2)
        assertTrue(r is Result.Success && !r.gepuffert)
        assertEquals(1, s.anfragen.count { it.startsWith("PUT") })
        assertEquals(3, ablage.lies(Faecher.SETS)!!.liste.single().quantity)
    }

    @Test
    fun `lehnt der Server ab, wird verworfen und gemeldet`() = runBlocking {
        s.offline = true
        repo.addSet("99999-1")
        s.codes["POST /api/v1/sets"] = 404 to """{"success":false,"error":"Set unbekannt"}"""
        s.offline = false
        val ereignisse = mutableListOf<Abgleichsereignis>()
        val sammler = launch { ablage.ereignisse.collect { ereignisse += it } }
        yield()
        assertEquals(Abgleichsergebnis.FERTIG, abgleich.sende())
        yield()
        sammler.cancel()
        val v = ereignisse.filterIsInstance<Abgleichsereignis.Verworfen>().single()
        assertEquals("99999-1", v.bearbeitung.ziel)
        assertEquals("Set unbekannt", v.meldung)
        assertEquals(0, ablage.ausgang.alle("konto").size)
    }
}
