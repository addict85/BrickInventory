package ch.brickinventoryapp.teile

import ch.brickinventoryapp.data.cache.ResponseCache
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import okhttp3.MediaType.Companion.toMediaType
import ch.brickinventoryapp.data.lokal.Abgleich
import ch.brickinventoryapp.offline.Abgleichsereignis
import ch.brickinventoryapp.data.lokal.Abgleichsergebnis
import ch.brickinventoryapp.offline.Bearbeitung
import ch.brickinventoryapp.offline.Faecher
import ch.brickinventoryapp.offline.Offlineablage
import ch.brickinventoryapp.data.lokal.ServerSender
import ch.brickinventoryapp.offline.SpeicherAusgang
import ch.brickinventoryapp.offline.SpeicherBestand
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.FigurenRepository
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.data.repository.TeileRepository
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
import ch.brickinventoryapp.data.api.ApiJson
import ch.brickinventoryapp.data.api.BrickApiService
import java.net.ConnectException
import java.net.SocketTimeoutException
import ch.brickinventoryapp.testing.FigurenRepository
import ch.brickinventoryapp.testing.ResponseCache
import ch.brickinventoryapp.testing.SetsRepository
import ch.brickinventoryapp.testing.TeileRepository
import ch.brickinventoryapp.testing.TestApi

/**
 * Offline bearbeiten von Anfang bis Ende: Repository, Ausgang und Sender gegen
 * einen Testserver, der die Verbindung auf Wunsch abreisst.
 *
 * Gegenproben:
 *   A  in RepoBasis.schreibe den Zweig für transiente Fehler entfernt → rot
 *      „ohne Verbindung geht die Menge in den Ausgang“ (Ergebnis.Error statt gepuffert)
 *   B  in RepoBasis.schreibe die Prüfung `ablage.wartet()` entfernt → rot
 *      „wartet etwas, geht Neues dahinter“ (die zweite Änderung ging direkt raus)
 *   C  in ServerSender für SetMenge `quantity = schritt` statt `quantityDelta` →
 *      rot „gesendet wird der Schritt“
 *   D  in RepoBasis.abgeglichen den Rückfall auf die Ablage entfernt → rot
 *      „ohne Verbindung kommt die Liste aus der Ablage“
 *   (E–I gemessen)
 *   E  in RepoBasis.schreibe beim Puffern nach dem direkten Versuch einen neuen
 *      Schlüssel nehmen (`puffere(bearbeitung)`) → rot „… denselben Schlüssel“
 *   F  in TeileRepository.deletePart wieder direkt `safeCall` statt `schreibe` →
 *      rot „offline gelöscht …“ (Ergebnis.Error statt gepuffert)
 *   G  in LokaleAnwendung bei TeilLoeschen `filterNot` → `filter` → rot „… verschwindet sofort“
 *   H  in TeileRepository.updatePart `quantityDelta = null` → rot „… als Menge und Schritt“
 *   I  in ServerSender beim Löschen `einordnen` statt `einordnenLoeschen` → rot
 *      „ein schon gelöschtes Teil …“ (404 verworfen und gemeldet)
 */
class OfflineBearbeitungTest {

    private class Server {
        @Volatile var offline = false
        /** Die nächste Anfrage kommt an, ihre Antwort geht verloren (Funkloch nach dem Senden). */
        @Volatile var antwortVerlieren = false
        val anfragen: MutableList<String> = Collections.synchronizedList(mutableListOf())
        /** Je Anfrage „METHODE pfad“ → Idempotency-Key, null ohne. */
        val schluessel: MutableList<Pair<String, String?>> = Collections.synchronizedList(mutableListOf())
        val codes: MutableMap<String, Pair<Int, String>> = Collections.synchronizedMap(mutableMapOf())
        val mock = MockWebServer().apply {
            dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    val pfad = request.path.orEmpty().substringBefore('?')
                    anfragen += "${request.method} $pfad ${request.body.readUtf8()}"
                    schluessel += "${request.method} $pfad" to request.getHeader("Idempotency-Key")
                    codes["${request.method} $pfad"]?.let { (c, r) -> return TestApi.antwort(r, c) }
                    return when {
                        request.method == "GET" && pfad == "/api/v1/sets" -> TestApi.antwort(
                            """{"success":true,"count":1,"total":1,"themes":[],"sets":[{"set_number":"10001-1","name":"Haus","quantity":1}]}""")
                        request.method == "GET" && pfad == "/api/v1/parts/manual" -> TestApi.antwort(
                            """{"success":true,"parts":[{"part_number":"3001","color_id":5,"quantity":5,"user_id":7},
                               {"part_number":"3002","color_id":1,"quantity":1,"user_id":7}]}""")
                        request.method == "GET" && pfad == "/api/v1/minifigs/manual" -> TestApi.antwort(
                            """{"success":true,"figs":[{"fig_number":"sw0001","quantity":2,"user_id":7}]}""")
                        request.method == "GET" && pfad == "/api/v1/wanted" -> TestApi.antwort(
                            """{"success":true,"merkposten":[{"set_number":"20001-1","condition":"N","user_id":7}]}""")
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
    private val api = retrofit2.Retrofit.Builder().baseUrl(s.mock.url("/"))
        .client(okhttp3.OkHttpClient.Builder().addInterceptor { kette ->
            if (s.offline) throw ConnectException("kein Netz")
            val antwort = kette.proceed(kette.request())
            if (s.antwortVerlieren) {
                s.antwortVerlieren = false
                antwort.close()
                throw SocketTimeoutException("Antwort verloren")
            }
            antwort
        }.build())
        .addConverterFactory(ApiJson.asConverterFactory("application/json".toMediaType()))
        .build().create(BrickApiService::class.java)
    private val repo = SetsRepository(api, ResponseCache { cacheDir }, ablage)
    private val teile = TeileRepository(api, ResponseCache { cacheDir }, ablage)
    private val figuren = FigurenRepository(api, ResponseCache { cacheDir }, ablage)
    private val abgleich = Abgleich(ablage, ServerSender(api, api, api))

    @After
    fun zu() {
        s.mock.shutdown()
        cacheDir.deleteRecursively()
    }

    @Test
    fun `ohne Verbindung geht die Menge in den Ausgang und gesendet wird der Schritt`() = runBlocking {
        assertTrue(repo.getSets() is Ergebnis.Success)
        s.offline = true
        val r = repo.aendereMengeUm("10001-1", 1)
        assertTrue("Erwartet: offline gespeichert, kam $r", r is Ergebnis.Success && r.gepuffert)
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
        assertTrue("Erwartet: Erfolg aus der Ablage, kam $r", r is Ergebnis.Success && r.veraltet)
        assertEquals(2, (r as Ergebnis.Success).data.sets.single().quantity)
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
        assertTrue(r is Ergebnis.Success && r.gepuffert)
        assertEquals(emptyList<String>(), s.anfragen.filter { it.startsWith("PUT") })
        abgleich.sende()
        assertEquals(2, s.anfragen.count { it.startsWith("PUT /api/v1/sets/10001-1") })
    }

    @Test
    fun `online geht eine Änderung direkt und steht auch lokal`() = runBlocking {
        repo.getSets()
        val r = repo.aendereMengeUm("10001-1", 2)
        assertTrue(r is Ergebnis.Success && !r.gepuffert)
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

    @Test
    fun `ein direkter Versuch, dessen Antwort verloren geht, und seine Wiederholung tragen denselben Schlüssel`() = runBlocking {
        repo.getSets()
        s.antwortVerlieren = true
        val r = repo.aendereMengeUm("10001-1", 1)
        assertTrue("Erwartet: gepuffert nach verlorener Antwort, kam $r", r is Ergebnis.Success && r.gepuffert)
        assertEquals(Abgleichsergebnis.FERTIG, abgleich.sende())
        val puts = s.schluessel.filter { it.first == "PUT /api/v1/sets/10001-1" }.map { it.second }
        assertEquals(2, puts.size)
        assertTrue("ohne Schlüssel: $puts", !puts[0].isNullOrBlank())
        assertEquals("der Server muss die Wiederholung erkennen können", puts[0], puts[1])
    }

    @Test
    fun `offline gelöschte Teile, Figuren und Merkposten verschwinden sofort und gehen später mit Schlüssel raus`() = runBlocking {
        teile.getManualParts(); figuren.getManualMinifigs(); repo.getMerkliste()
        s.offline = true
        for (r in listOf(teile.deletePart("3001", 5, owner = 7), figuren.deleteMinifig("sw0001", owner = 7),
                         repo.loescheMerkposten("20001-1", "N", 7)))
            assertTrue("Erwartet: offline gespeichert, kam $r", r is Ergebnis.Success && r.gepuffert)
        assertEquals("das gelöschte Teil verschwindet sofort", listOf("3002"),
            ablage.lies(Faecher.MANUELLE_TEILE)!!.liste.map { it.partNumber })
        assertEquals(emptyList<String>(), ablage.lies(Faecher.MANUELLE_FIGUREN)!!.liste.map { it.figNumber })
        assertEquals(emptyList<String>(), ablage.lies(Faecher.MERKLISTE)!!.liste.map { it.setNumber })
        val offline = teile.getManualParts()
        assertTrue(offline is Ergebnis.Success && offline.data.parts.map { it.partNumber } == listOf("3002"))

        s.offline = false
        assertEquals(Abgleichsergebnis.FERTIG, abgleich.sende())
        val geloescht = s.schluessel.filter { it.first.startsWith("DELETE") }
        assertEquals(listOf("DELETE /api/v1/parts/3001/5", "DELETE /api/v1/minifigs/sw0001", "DELETE /api/v1/wanted/20001-1/N"),
            geloescht.map { it.first })
        assertTrue("jeder mit eigenem Schlüssel: $geloescht", geloescht.mapNotNull { it.second }.toSet().size == 3)
        assertEquals(0, ablage.ausgang.alle("konto").size)
    }

    @Test
    fun `ein schon gelöschtes Teil gilt beim Senden als gelöscht und wird nicht als verworfen gemeldet`() = runBlocking {
        teile.getManualParts()
        s.offline = true
        teile.deletePart("3001", 5)
        s.codes["DELETE /api/v1/parts/3001/5"] = 404 to """{"success":false,"error":"Teil nicht gefunden"}"""
        s.offline = false
        val ereignisse = mutableListOf<Abgleichsereignis>()
        val sammler = launch { ablage.ereignisse.collect { ereignisse += it } }
        yield()
        assertEquals(Abgleichsergebnis.FERTIG, abgleich.sende())
        yield()
        sammler.cancel()
        assertEquals(emptyList<Abgleichsereignis>(), ereignisse.filterIsInstance<Abgleichsereignis.Verworfen>())
        assertEquals(0, ablage.ausgang.alle("konto").size)
    }

    @Test
    fun `eine Mengenänderung an Teil und Figur reist als Menge und Schritt`() = runBlocking {
        teile.getManualParts(); figuren.getManualMinifigs()
        assertTrue(teile.updatePart("3001", 5, quantity = 7, unitPrice = null) is Ergebnis.Success)
        assertTrue(figuren.updateMinifig("sw0001", quantity = 1, unitPrice = null) is Ergebnis.Success)
        val teil = s.anfragen.single { it.startsWith("PUT /api/v1/parts/3001/5") }
        assertTrue(teil, "\"quantity\":7" in teil && "\"quantity_delta\":2" in teil)
        val figur = s.anfragen.single { it.startsWith("PUT /api/v1/minifigs/sw0001") }
        assertTrue(figur, "\"quantity\":1" in figur && "\"quantity_delta\":-1" in figur)
        assertEquals("die lokale Liste zeigt die neue Menge", 7,
            ablage.lies(Faecher.MANUELLE_TEILE)!!.liste.first { it.partNumber == "3001" }.quantity)
    }
}
