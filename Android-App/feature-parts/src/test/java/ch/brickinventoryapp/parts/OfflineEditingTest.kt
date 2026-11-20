package ch.brickinventoryapp.parts

import ch.brickinventoryapp.testing.testWantedRepository
import ch.brickinventoryapp.model.domain.Zustand
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import okhttp3.MediaType.Companion.toMediaType
import ch.brickinventoryapp.data.local.Abgleich
import ch.brickinventoryapp.data.local.Abgleichsergebnis
import ch.brickinventoryapp.offline.Editing
import ch.brickinventoryapp.offline.Slots
import ch.brickinventoryapp.offline.Offlineablage
import ch.brickinventoryapp.data.local.ServerSender
import ch.brickinventoryapp.offline.StorageExit
import ch.brickinventoryapp.offline.StorageInventory
import ch.brickinventoryapp.data.repository.Ergebnis
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlinx.coroutines.flow.first
import java.io.File
import java.util.Collections
import ch.brickinventoryapp.model.json.BrickJson
import ch.brickinventoryapp.testing.BrickApiService
import java.net.ConnectException
import java.net.SocketTimeoutException
import ch.brickinventoryapp.testing.testMinifigsRepository
import ch.brickinventoryapp.testing.testSetsRepository
import ch.brickinventoryapp.testing.testPartsRepository
import ch.brickinventoryapp.testing.TestApi

/**
 * Offline bearbeiten von Anfang bis Ende: Repository, Ausgang und Sender gegen
 * einen Testserver, der die Verbindung auf Wunsch abreisst.
 *
 * Gegenproben:
 *   A  in Offlineablage.schreibe (Abruf.kt) den Zweig für transiente Fehler entfernt → rot
 *      „ohne Verbindung geht die Menge in den Ausgang“ (Ergebnis.Fehler statt gepuffert)
 *   B  in Offlineablage.schreibe (Abruf.kt) die Prüfung `ablage.wartet()` entfernt → rot
 *      „wartet etwas, geht Neues dahinter“ (die zweite Änderung ging direkt raus)
 *   C  in ServerSender für SetMenge `quantity = schritt` statt `quantityDelta` →
 *      rot „gesendet wird der Schritt“
 *   D  in Offlineablage.refreshPaged (Abruf.kt) auch bei einem Fehler die leere
 *      Liste übernommen → rot „ohne Verbindung bleibt die Liste in der Ablage“
 *   (E–I gemessen)
 *   E  in Offlineablage.schreibe (Abruf.kt) beim Puffern nach dem direkten Versuch einen neuen
 *      Schlüssel nehmen (`buffer(bearbeitung)`) → rot „… denselben Schlüssel“
 *   F  in PartsRepository.deletePart wieder direkt `sicherAufrufen` statt `schreibe` →
 *      rot „offline gelöscht …“ (Ergebnis.Fehler statt gepuffert)
 *   G  in LocalApplication bei TeilLoeschen `filterNot` → `filter` → rot „… verschwindet sofort“
 *   H  in PartsRepository.updatePart kein Schritt → rot „… als Menge und Schritt“
 *   J  gegenproben/ausgang-schritt-verloren.patch: Stueckaenderung.asRequest ohne quantity_delta → rot, derselbe Test
 *   I  in ServerSender beim Löschen `classify` statt `deleteClassify` → rot
 *      „ein schon gelöschtes Teil …“ (404 verworfen und gemeldet)
 */
class OfflineEditingTest {

    private class Server {
        @Volatile var offline = false
        /** Die nächste Anfrage kommt an, ihre Antwort geht verloren (Funkloch nach dem Senden). */
        @Volatile var responseLose = false
        val requests: MutableList<String> = Collections.synchronizedList(mutableListOf())
        /** Je Anfrage „METHODE pfad“ → Idempotency-Key, null ohne. */
        val schluessel: MutableList<Pair<String, String?>> = Collections.synchronizedList(mutableListOf())
        val codes: MutableMap<String, Pair<Int, String>> = Collections.synchronizedMap(mutableMapOf())
        val mock = MockWebServer().apply {
            dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    val pfad = request.path.orEmpty().substringBefore('?')
                    requests += "${request.method} $pfad ${request.body.readUtf8()}"
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
    /** Der Test behält den Ausgang, um nachzusehen; die Ablage zeigt ihn nicht. */
    private val ausgang = StorageExit()
    private val ablage = Offlineablage(StorageInventory(), ausgang, { "konto" })
    /** Ohne Netz: Die Verbindung kommt gar nicht erst zustande, wie im Funkloch. */
    private val api = retrofit2.Retrofit.Builder().baseUrl(s.mock.url("/"))
        .client(okhttp3.OkHttpClient.Builder().addInterceptor { kette ->
            if (s.offline) throw ConnectException("kein Netz")
            val antwort = kette.proceed(kette.request())
            if (s.responseLose) {
                s.responseLose = false
                antwort.close()
                throw SocketTimeoutException("Antwort verloren")
            }
            antwort
        }.build())
        .addConverterFactory(BrickJson.asConverterFactory("application/json".toMediaType()))
        .build().create(BrickApiService::class.java)
    private val repo = testSetsRepository(api, ablage)
    private val merkliste = testWantedRepository(api, ablage)
    private val teile = testPartsRepository(api, ablage)
    private val figuren = testMinifigsRepository(api, ablage)
    private val sync = Abgleich(ablage, ausgang, ServerSender(api, api, api))

    @After
    fun zu() {
        s.mock.shutdown()
        cacheDir.deleteRecursively()
    }

    @Test
    fun `ohne Verbindung geht die Menge in den Ausgang und gesendet wird der Schritt`() = runBlocking {
        assertTrue(repo.aktualisiereSets() is Ergebnis.Erfolg)
        s.offline = true
        val r = repo.changeQuantityUm("10001-1", 1)
        assertTrue("Erwartet: offline gespeichert, kam $r", r is Ergebnis.Erfolg && r.gepuffert)
        assertEquals(2, ablage.lies(Slots.SETS)!!.liste.single().quantity)
        assertEquals(listOf(Editing.SetMenge("10001-1", 1)), ausgang.alle("konto").map { it.bearbeitung })

        assertEquals(Abgleichsergebnis.LATER, sync.send())
        s.offline = false
        assertEquals(Abgleichsergebnis.FERTIG, sync.send())
        assertEquals(listOf("PUT /api/v1/sets/10001-1 {\"quantity_delta\":1}"), s.requests.filter { it.startsWith("PUT") })
        assertEquals(0, ausgang.alle("konto").size)
    }

    @Test
    fun `ohne Verbindung bleibt die Liste in der Ablage, samt Stand`() = runBlocking {
        repo.aktualisiereSets()
        s.offline = true
        repo.changeQuantityUm("10001-1", 1)
        val r = repo.aktualisiereSets()
        assertTrue("Erwartet: ein vorübergehender Fehler, kam $r", r is Ergebnis.Fehler && r.transient)
        val l = repo.observeSets().first()
        assertTrue("mit dem Stand der letzten Serverantwort", l.stand != null)
        assertEquals(2, l.liste.single().quantity)
    }

    @Test
    fun `wartet etwas, geht Neues dahinter`() = runBlocking {
        repo.aktualisiereSets()
        s.offline = true
        repo.changeQuantityUm("10001-1", 1)
        s.offline = false
        // Der Server ist wieder da, aber der Ausgang ist noch nicht gesendet:
        // Eine direkte Anfrage überholte die erste Änderung.
        val r = repo.changeQuantityUm("10001-1", 1)
        assertTrue(r is Ergebnis.Erfolg && r.gepuffert)
        assertEquals(emptyList<String>(), s.requests.filter { it.startsWith("PUT") })
        sync.send()
        assertEquals(2, s.requests.count { it.startsWith("PUT /api/v1/sets/10001-1") })
    }

    @Test
    fun `online geht eine Änderung direkt und steht auch lokal`() = runBlocking {
        repo.aktualisiereSets()
        val r = repo.changeQuantityUm("10001-1", 2)
        assertTrue(r is Ergebnis.Erfolg && !r.gepuffert)
        assertEquals(1, s.requests.count { it.startsWith("PUT") })
        assertEquals(3, ablage.lies(Slots.SETS)!!.liste.single().quantity)
    }

    @Test
    fun `lehnt der Server ab, wird verworfen und gemeldet`() = runBlocking {
        s.offline = true
        repo.addSet("99999-1")
        s.codes["POST /api/v1/sets"] = 404 to """{"success":false,"error":"Set unbekannt"}"""
        s.offline = false
        assertEquals(Abgleichsergebnis.FERTIG, sync.send())
        val v = sync.discarded().first().single()
        assertEquals("99999-1", v.ziel)
        assertEquals("Set unbekannt", v.meldung)
        assertEquals(0, ausgang.alle("konto").size)
    }

    @Test
    fun `ein direkter Versuch, dessen Antwort verloren geht, und seine Wiederholung tragen denselben Schlüssel`() = runBlocking {
        repo.aktualisiereSets()
        s.responseLose = true
        val r = repo.changeQuantityUm("10001-1", 1)
        assertTrue("Erwartet: gepuffert nach verlorener Antwort, kam $r", r is Ergebnis.Erfolg && r.gepuffert)
        assertEquals(Abgleichsergebnis.FERTIG, sync.send())
        val puts = s.schluessel.filter { it.first == "PUT /api/v1/sets/10001-1" }.map { it.second }
        assertEquals(2, puts.size)
        assertTrue("ohne Schlüssel: $puts", !puts[0].isNullOrBlank())
        assertEquals("der Server muss die Wiederholung erkennen können", puts[0], puts[1])
    }

    @Test
    fun `offline gelöschte Teile, Figuren und Merkposten verschwinden sofort und gehen später mit Schlüssel raus`() = runBlocking {
        teile.refreshParts(); figuren.refreshMinifigs(); merkliste.refreshWanted()
        s.offline = true
        for (r in listOf(teile.deletePart("3001", 5, owner = 7), figuren.deleteMinifig("sw0001", owner = 7),
                         merkliste.deleteWantedItem("20001-1", Zustand.NEU, 7)))
            assertTrue("Erwartet: offline gespeichert, kam $r", r is Ergebnis.Erfolg && r.gepuffert)
        assertEquals("das gelöschte Teil verschwindet sofort", listOf("3002"),
            ablage.lies(Slots.MANUELLE_TEILE)!!.liste.map { it.partNumber })
        assertEquals(emptyList<String>(), ablage.lies(Slots.MANUELLE_FIGUREN)!!.liste.map { it.figNumber })
        assertEquals(emptyList<String>(), ablage.lies(Slots.MERKLISTE)!!.liste.map { it.setNumber })
        assertEquals(listOf("3002"), teile.observeManualParts().first().liste.map { it.partNumber })

        s.offline = false
        assertEquals(Abgleichsergebnis.FERTIG, sync.send())
        val geloescht = s.schluessel.filter { it.first.startsWith("DELETE") }
        assertEquals(listOf("DELETE /api/v1/parts/3001/5", "DELETE /api/v1/minifigs/sw0001", "DELETE /api/v1/wanted/20001-1/N"),
            geloescht.map { it.first })
        assertTrue("jeder mit eigenem Schlüssel: $geloescht", geloescht.mapNotNull { it.second }.toSet().size == 3)
        assertEquals(0, ausgang.alle("konto").size)
    }

    @Test
    fun `ein schon gelöschtes Teil gilt beim Senden als gelöscht und wird nicht als verworfen gemeldet`() = runBlocking {
        teile.refreshParts()
        s.offline = true
        teile.deletePart("3001", 5)
        s.codes["DELETE /api/v1/parts/3001/5"] = 404 to """{"success":false,"error":"Teil nicht gefunden"}"""
        s.offline = false
        assertEquals(Abgleichsergebnis.FERTIG, sync.send())
        assertEquals(emptyList<String>(), sync.discarded().first().map { it.ziel })
        assertEquals(0, ausgang.alle("konto").size)
    }

    @Test
    fun `eine Mengenänderung an Teil und Figur reist als Menge und Schritt`() = runBlocking {
        teile.refreshParts(); figuren.refreshMinifigs()
        assertTrue(teile.updatePart("3001", 5, quantity = 7, unitPrice = null) is Ergebnis.Erfolg)
        assertTrue(figuren.updateMinifig("sw0001", quantity = 1, unitPrice = null) is Ergebnis.Erfolg)
        val teil = s.requests.single { it.startsWith("PUT /api/v1/parts/3001/5") }
        assertTrue(teil, "\"quantity\":7" in teil && "\"quantity_delta\":2" in teil)
        val figur = s.requests.single { it.startsWith("PUT /api/v1/minifigs/sw0001") }
        assertTrue(figur, "\"quantity\":1" in figur && "\"quantity_delta\":-1" in figur)
        assertEquals("die lokale Liste zeigt die neue Menge", 7,
            ablage.lies(Slots.MANUELLE_TEILE)!!.liste.first { it.partNumber == "3001" }.quantity)
    }
}
