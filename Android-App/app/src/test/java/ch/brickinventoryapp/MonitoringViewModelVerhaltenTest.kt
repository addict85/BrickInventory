package ch.brickinventoryapp

import ch.brickinventoryapp.data.api.BrickApiService
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.repository.AdminRepository
import ch.brickinventoryapp.data.repository.BrickRepository
import ch.brickinventoryapp.data.repository.FinanzenRepository
import ch.brickinventoryapp.data.repository.HaushaltRepository
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.data.repository.TeileRepository
import ch.brickinventoryapp.ui.viewmodel.MonitoringViewModel
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
 * Das Monitoring-ViewModel, AUSGEFÜHRT statt gelesen.
 *
 * ── Warum dieser Test die Ausnahme ist, und warum das ein Problem war ──────
 * Von 63 Testdateien der App führte genau EINE echtes Verhalten aus
 * (BrickRepositoryErrorMappingTest); die übrigen 62 vergleichen Zeichenketten
 * gegen den Quelltext. Das hat einen guten Grund — ohne Android-SDK ging lange
 * nichts anderes — und zwei schlechte Folgen:
 *
 *   1. Ein Anker veraltet stillschweigend. In dieser Reihe sind vier Tests an
 *      einer Umbenennung oder einer Typannotation zerbrochen, einer davon
 *      OHNE zu melden, dass er nichts mehr fand.
 *   2. Ein `!contains("alterName")` bleibt nach einer Umbenennung für immer
 *      grün und prüft in Wahrheit gar nichts mehr. Das ist die schlimmere
 *      Richtung, weil niemand hinsieht.
 *
 * Möglich wurde dieser Test durch die Aufteilung: MonitoringViewModel nimmt
 * genau ein BrickRepository entgegen und ist eine gewöhnliche Klasse — keine
 * Compose-Laufzeit, kein Android. Vorher standen dieselben Abläufe in Lambdas
 * innerhalb eines `items {}`-Blocks und liefen ohne Gerät gar nicht erst an.
 *
 * ── Was hier geprüft wird ─────────────────────────────────────────────────
 * Die zwei Zusagen, die beim Umbau als „konnte niemand nachfahren" benannt
 * wurden — beide Male ein vorweggenommener Zustand mit Rücknahme bei
 * Fehlschlag. Genau die Sorte Ablauf, die man beim Lesen für richtig hält.
 *
 * MockWebServer liefert der Reihe nach, unabhängig vom Pfad; die Tests legen
 * deshalb genau so viele Antworten hin, wie das ViewModel Abrufe macht.
 */
class MonitoringViewModelVerhaltenTest {

    private lateinit var server: MockWebServer
    private lateinit var cacheDir: File
    private lateinit var vm: MonitoringViewModel

    private fun antwort(rumpf: String, code: Int = 200) =
        MockResponse().setResponseCode(code)
            .setHeader("Content-Type", "application/json").setBody(rumpf)

    @Before
    fun auf() {
        server = MockWebServer()
        server.start()
        cacheDir = File(System.getProperty("java.io.tmpdir"), "bim-mon-${System.nanoTime()}")
        cacheDir.mkdirs()

        val client = OkHttpClient.Builder()
            .readTimeout(2, TimeUnit.SECONDS).connectTimeout(2, TimeUnit.SECONDS).build()
        // Dieselbe Json-Konfiguration wie in di/AppModule — sonst prüfte der
        // Test eine Nachsicht, die es in der App nicht gibt.
        val json = Json {
            ignoreUnknownKeys = true; isLenient = true
            encodeDefaults = true; coerceInputValues = true
        }
        val api = Retrofit.Builder()
            .baseUrl(server.url("/"))
            .client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(BrickApiService::class.java)
        val cache = ResponseCache { cacheDir }
        vm = MonitoringViewModel(BrickRepository(
            SetsRepository(api, cache), TeileRepository(api, cache),
            FinanzenRepository(api, cache), HaushaltRepository(api, cache),
            AdminRepository(api, cache), cache,
        ))
    }

    @After
    fun zu() {
        server.shutdown()
        cacheDir.deleteRecursively()
    }

    // ── Die Warteschlange ────────────────────────────────────────────────────

    @Test
    fun `geloeschter Eintrag verschwindet sofort und bleibt weg, wenn der Server zustimmt`() = runTest {
        server.enqueue(antwort("""{"success":true,"count":2,"entries":[
            {"set_number":"75192","attempts":1},{"set_number":"10294","attempts":3}]}"""))
        vm.ladeWarteschlange()
        assert(vm.state.value.queue.size == 2) { "Vorbedingung: zwei Einträge erwartet" }

        // Nur EINE Antwort: Bei Erfolg wird bewusst NICHT neu geladen — der
        // vorweggenommene Zustand ist dann schon der richtige, und ein zweiter
        // Abruf je Löschung wäre pure Last.
        server.enqueue(antwort("""{"success":true}"""))
        val ok = vm.entferneEintrag("75192")

        assert(ok) { "Der Server hat zugestimmt, das Ergebnis müsste true sein" }
        assert(server.requestCount == 2) {
            "Erwartet: Laden + Löschen. Es waren ${server.requestCount} Abrufe — " +
                "wird bei Erfolg unnötig neu geladen?"
        }
        assert(vm.state.value.queue.map { it.setNumber } == listOf("10294")) {
            "Nach dem Löschen steht: ${vm.state.value.queue.map { it.setNumber }}"
        }
    }

    @Test
    fun `scheitert das Loeschen, wird die Liste WIEDERHERGESTELLT`() = runTest {
        server.enqueue(antwort("""{"success":true,"count":2,"entries":[
            {"set_number":"75192","attempts":1},{"set_number":"10294","attempts":3}]}"""))
        vm.ladeWarteschlange()

        // Der Löschversuch scheitert. Danach fragt das ViewModel neu — und
        // bekommt beide Einträge zurück, denn gelöscht wurde nichts.
        server.enqueue(antwort("""{"error":"kaputt"}""", 500))
        server.enqueue(antwort("""{"success":true,"count":2,"entries":[
            {"set_number":"75192","attempts":1},{"set_number":"10294","attempts":3}]}"""))
        val ok = vm.entferneEintrag("75192")

        assert(!ok) { "Ein 500 darf nicht als Erfolg zurückkommen" }
        // DAS ist die Zusage: Der vorweggenommene Zustand wurde zurückgenommen.
        assert(vm.state.value.queue.map { it.setNumber } == listOf("75192", "10294")) {
            "Der Eintrag bleibt verschwunden, obwohl der Server abgelehnt hat: " +
                "${vm.state.value.queue.map { it.setNumber }}"
        }
    }

    @Test
    fun `nach dem Fehlschlag wird NEU GELADEN, nicht die alte Kopie zurueckgeschrieben`() = runTest {
        server.enqueue(antwort("""{"success":true,"count":1,"entries":[{"set_number":"75192","attempts":1}]}"""))
        vm.ladeWarteschlange()

        // Fehlschlag — und inzwischen ist am Server ein ANDERER Eintrag
        // dazugekommen. Eine zurückgeschriebene Kopie zeigte ihn nicht.
        server.enqueue(antwort("""{"error":"kaputt"}""", 500))
        server.enqueue(antwort("""{"success":true,"count":2,"entries":[
            {"set_number":"75192","attempts":1},{"set_number":"42100","attempts":1}]}"""))
        vm.entferneEintrag("75192")

        assert(vm.state.value.queue.map { it.setNumber } == listOf("75192", "42100")) {
            "Der zwischenzeitlich hinzugekommene Eintrag fehlt — es wurde eine " +
                "alte Kopie zurückgeschrieben statt neu geladen: " +
                "${vm.state.value.queue.map { it.setNumber }}"
        }
    }

    // ── Der Vorgabe-Zustand ──────────────────────────────────────────────────

    @Test
    fun `der Vorgabe-Zustand springt sofort um und bleibt, wenn der Server zustimmt`() = runTest {
        server.enqueue(antwort("""{"success":true}"""))
        val ok = vm.setzeVorgabeZustand("U")
        assert(ok)
        assert(vm.state.value.vorgabeZustand == "U") { "Steht: ${vm.state.value.vorgabeZustand}" }
    }

    @Test
    fun `scheitert das Setzen, faellt der Vorgabe-Zustand ZURUECK`() = runTest {
        val vorher = vm.state.value.vorgabeZustand
        server.enqueue(antwort("""{"error":"kaputt"}""", 500))
        val ok = vm.setzeVorgabeZustand("U")

        assert(!ok) { "Ein 500 darf nicht als Erfolg zurückkommen" }
        assert(vm.state.value.vorgabeZustand == vorher) {
            "Die Oberfläche behauptet dauerhaft '${vm.state.value.vorgabeZustand}', " +
                "obwohl nie etwas gespeichert wurde"
        }
    }

    // ── Laden ────────────────────────────────────────────────────────────────

    @Test
    fun `ein Fehler beim Job-Abruf loescht die bereits gezeigten Jobs NICHT`() = runTest {
        server.enqueue(antwort("""{"success":true,"jobs":{"priceJob":{"status":"idle","label":"Preise"}}}"""))
        vm.ladeJobs()
        assert(vm.state.value.jobs.keys == setOf("priceJob")) { "Vorbedingung: ein Job erwartet" }

        server.enqueue(antwort("""{"error":"kaputt"}""", 500))
        vm.ladeJobs()

        assert(vm.state.value.jobs.keys == setOf("priceJob")) {
            "Ein einzelner fehlgeschlagener Abruf hat die Anzeige geleert — die " +
                "Seite fragt alle fünf Sekunden, das flackerte bei jedem Aussetzer"
        }
        assert(!vm.state.value.aktualisiert) {
            "Der Ladekringel bleibt nach einem Fehler stehen"
        }
    }

    @Test
    fun `ladeCacheUndGrenzen fuellt alle vier Felder aus vier Abrufen`() = runTest {
        server.enqueue(antwort("""{"success":true,"prices":7,"price_stale":1,"subsets":2,"catalog":3}"""))
        server.enqueue(antwort("""{"success":true,"limits":{"rebrickable":100,"bricklink":200,"brickset":300}}"""))
        server.enqueue(antwort("""{"success":true,"ttl":"48"}"""))
        server.enqueue(antwort("""{"success":true,"condition":"U"}"""))

        vm.ladeCacheUndGrenzen()

        val s = vm.state.value
        assert(s.cacheStats?.prices == 7) { "Cache-Zahlen fehlen: ${s.cacheStats}" }
        assert(s.apiLimits?.brickset == 300) { "Grenzwerte fehlen: ${s.apiLimits}" }
        assert(s.cacheTtl == "48") { "Cache-Dauer steht auf ${s.cacheTtl}" }
        assert(s.vorgabeZustand == "U") { "Vorgabe-Zustand steht auf ${s.vorgabeZustand}" }
        assert(server.requestCount == 4) {
            "Erwartet waren vier Abrufe, es waren ${server.requestCount}"
        }
    }
}
