package ch.brickinventoryapp

import ch.brickinventoryapp.data.api.BrickApiService
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.model.SetsResponse
import ch.brickinventoryapp.data.repository.GALLERY_DEFAULT_SORT
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.data.repository.SetsRepository
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
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
 * Was die Galerie beim Server BESTELLT — und was davon auf der Platte landet.
 *
 * ── Warum das ein Verhaltenstest sein muss ──────────────────────────────────
 * GalleryServerFilterTest hält dieselbe Regel bisher am Quelltext fest: „steht
 * `search = ` in loadSets?", „steht `ungefiltert` im Cache-Zweig?". Das prüft,
 * dass jemand die Wörter geschrieben hat, nicht dass der Wert ankommt. Genau
 * die zwei Fehler, die hier wehtun, würden dabei durchgehen:
 *
 *   • Ein Filter, der im ViewModel gesetzt, aber in der Datenschicht nicht
 *     weitergereicht wird. Der Quelltext liest sich richtig, der Server sieht
 *     nichts, und die Galerie zeigt den vollen Bestand — für den Nutzer sieht
 *     das aus, als täte der Filter nichts.
 *   • Eine GEFILTERTE Antwort, die unter dem Schlüssel der ungefilterten Sicht
 *     abgelegt wird. Das fällt nicht sofort auf, sondern beim NÄCHSTEN Start:
 *     Die App zeigt dann eine gefilterte Liste als vollen Bestand an, ohne dass
 *     ein Filter gesetzt wäre. Der Wortlaut `ungefiltert` im Quelltext sagt
 *     darüber nichts — die Bedingung könnte falsch herum stehen.
 *
 * Beides sind Aussagen über den ABLAUF (welche Anfrage geht raus, was liegt
 * danach auf der Platte), und die zeigt nur ein Aufruf. Aufbau wie in
 * RepoCacheRueckfallTest: echter MockWebServer, echter Plattencache.
 *
 * Gegenproben (durchgeführt):
 *   a) In getSets() im gefilterten Zweig `search` durch `null` ersetzt
 *      → Teilschritt 1 rot ("search fehlt in der Anfrage").
 *   b) Die Bedingung `ungefiltert` durch `true` ersetzt, sodass auch gefilterte
 *      Abrufe über den Cache laufen → Teilschritt 3 rot: Der zweite,
 *      ungefilterte Abruf lieferte die gefilterte Liste.
 *   c) `page == 1` aus der Bedingung `ungefiltert` gestrichen → Teilschritt 4
 *      rot (Seite 2 landete im Cache der ersten Seite).
 */
class GalerieAbfrageTest {

    private lateinit var server: MockWebServer
    private lateinit var repo: SetsRepository
    private lateinit var cacheDir: File

    /** Antwort mit erkennbarem Inhalt: Die Setnummern verraten, welche Liste kam. */
    private fun antwort(vararg nummern: String) = buildString {
        append("""{"success":true,"total":${nummern.size},"themes":["Star Wars"],"sets":[""")
        append(nummern.joinToString(",") { """{"set_number":"$it","name":"T","quantity":1}""" })
        append("]}")
    }

    @Before
    fun auf() {
        server = MockWebServer()
        server.start()
        cacheDir = File(System.getProperty("java.io.tmpdir"), "bim-gal-${System.nanoTime()}")
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
        repo = SetsRepository(api, ResponseCache { cacheDir })
    }

    @After
    fun zu() {
        server.shutdown()
        cacheDir.deleteRecursively()
    }

    private fun daten(r: Result<SetsResponse>): SetsResponse {
        assert(r is Result.Success) { "Erwartet wurde ein Erfolg, kam aber: $r" }
        return (r as Result.Success).data
    }

    private fun nummern(r: Result<SetsResponse>) = daten(r).sets.map { it.setNumber }

    @Test
    fun `jeder Filter steht in der Anfrage an den Server`() = runTest {
        server.enqueue(MockResponse().setResponseCode(200).setBody(antwort("75192-1")))
        repo.getSets(accounts = "7", search = "falcon", theme = "Star Wars",
                     sort = "price_desc", page = 3)
        val pfad = server.takeRequest().path ?: ""

        // Werte einzeln, damit die Meldung sagt, WELCHER fehlt. Ein fehlender
        // Filter heisst fuer den Nutzer: die Galerie zeigt den vollen Bestand,
        // obwohl er etwas eingestellt hat.
        for ((name, erwartet) in listOf(
            "accounts" to "accounts=7",
            "search"   to "search=falcon",
            "theme"    to "theme=Star",          // die Leerstelle ist kodiert
            "sort"     to "sort=price_desc",
            "page"     to "page=3",
        )) {
            assert(pfad.contains(erwartet)) {
                "$name fehlt in der Anfrage — der Server wertet aus, was ankommt, " +
                    "nicht was im ViewModel steht. Pfad war: $pfad"
            }
        }
    }

    @Test
    fun `ein leerer Filter wird nicht als Filter gesendet`() = runTest {
        // `search=` mit leerem Wert ist etwas anderes als „kein search": Der
        // Server bekaeme einen gesetzten, leeren Suchbegriff. Deshalb das
        // ifBlank { null } in getSets().
        server.enqueue(MockResponse().setResponseCode(200).setBody(antwort("1-1")))
        repo.getSets(accounts = "7", search = "  ", theme = "")
        val pfad = server.takeRequest().path ?: ""
        assert(!pfad.contains("search=")) { "leerer Suchtext wurde mitgeschickt: $pfad" }
        assert(!pfad.contains("theme=")) { "leeres Thema wurde mitgeschickt: $pfad" }
    }

    @Test
    fun `eine gefilterte Antwort landet NICHT im Cache der vollen Sicht`() = runTest {
        // 1. Gefiltert abrufen — die Antwort enthaelt NUR das gefilterte Set.
        server.enqueue(MockResponse().setResponseCode(200).setBody(antwort("75192-1")))
        assert(nummern(repo.getSets(search = "falcon")) == listOf("75192-1"))

        // 2. Jetzt ungefiltert, aber der Server ist tot. Faellt der Cache ein,
        //    darf dort NICHTS aus Schritt 1 liegen — sonst zeigt die App nach
        //    einem Neustart eine gefilterte Liste als vollen Bestand.
        server.enqueue(MockResponse().setResponseCode(500))
        val r = repo.getSets()
        if (r is Result.Success) {
            assert(r.data.sets.isEmpty()) {
                "Die gefilterte Antwort liegt unter dem Schluessel der vollen Sicht. " +
                    "Nach dem naechsten Start zeigt die Galerie sie als Gesamtbestand an. " +
                    "Bekommen: ${r.data.sets.map { it.setNumber }}"
            }
        }
        // Ein Fehler ist der erwuenschte Ausgang: nichts Gespeichertes, also
        // nichts zurueckzufallen.
    }

    @Test
    fun `nur die erste Seite wird gespeichert`() = runTest {
        // Seite 2 unter dem Schluessel der ersten abzulegen hiesse: Nach dem
        // Neustart beginnt die Galerie mitten im Bestand, und der
        // Endlos-Scroll haengt Seite 2 noch einmal an.
        server.enqueue(MockResponse().setResponseCode(200).setBody(antwort("2-1")))
        repo.getSets(page = 2)
        server.takeRequest()

        server.enqueue(MockResponse().setResponseCode(500))
        val r = repo.getSets()
        if (r is Result.Success) {
            assert(r.data.sets.isEmpty()) {
                "Seite 2 liegt im Cache der ersten Seite. Bekommen: " +
                    "${r.data.sets.map { it.setNumber }}"
            }
        }
    }

    @Test
    fun `die volle Sicht wird gespeichert und traegt bei Serverfehler`() = runTest {
        // Das Gegenstueck: Genau EIN Fall darf auf die Platte, und der muss es
        // auch wirklich tun — sonst startet die App ohne Netz mit leerer Galerie.
        server.enqueue(MockResponse().setResponseCode(200).setBody(antwort("10-1", "11-1")))
        assert(nummern(repo.getSets()) == listOf("10-1", "11-1"))

        server.enqueue(MockResponse().setResponseCode(500))
        assert(nummern(repo.getSets()) == listOf("10-1", "11-1")) {
            "Ohne Netz muss die zuletzt gesehene volle Galerie kommen"
        }

        // Auch mit ausgeschriebener Standardsortierung ist es dieselbe Sicht —
        // loadSets() reicht sie immer mit, die Vorgabe ist also der Normalfall.
        server.enqueue(MockResponse().setResponseCode(500))
        assert(nummern(repo.getSets(sort = GALLERY_DEFAULT_SORT)) == listOf("10-1", "11-1")) {
            "Die Standardsortierung ist die volle Sicht — sonst greift der Cache nie, " +
                "weil die Galerie den Wert immer mitschickt"
        }
    }
}
