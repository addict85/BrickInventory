package ch.brickinventoryapp.management

import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.testing.BrickApiService
import ch.brickinventoryapp.testing.testAccountRepository
import ch.brickinventoryapp.testing.testManagementRepository
import ch.brickinventoryapp.management.ui.viewmodel.MonitoringViewModel
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import kotlinx.coroutines.test.runTest
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
import ch.brickinventoryapp.model.json.BrickJson
import ch.brickinventoryapp.model.ui.dataOrNull
import ch.brickinventoryapp.model.ui.errorMessage
import ch.brickinventoryapp.model.ui.laedt

/**
 * The monitoring ViewModel against a MockWebServer: anticipated states with
 * a rollback on failure, the poll clock, theme and log. MockWebServer delivers in
 * order, independent of the path; each test lays down as many answers as the
 * ViewModel makes fetches.
 *
 * Counter-checks: in loadJobs() `accessRevoked` not
 * set → red “a 403 nur_admins ends the polling …”;
 * gegenproben/monitoring-takt-ohne-ende.patch (haltAktuell() with `while (true)`)
 * → red “the clock polls jobs and background …” (runs until the time limit).
 */
class MonitoringViewModelBehaviorTest {

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
        // The same JSON config as in di/AppModule — otherwise the
        // test would check a leniency the app does not have.
        val json = BrickJson
        val api = Retrofit.Builder()
            .baseUrl(server.url("/"))
            .client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(BrickApiService::class.java)
        vm = MonitoringViewModel(testManagementRepository(api), testAccountRepository(api), MeldungsKanal())
    }

    @After
    fun zu() {
        server.shutdown()
        cacheDir.deleteRecursively()
    }

    @Test
    fun `a 403 nur_admins ends the polling, another error does not`() = runTest {
        server.enqueue(antwort("""{"success":false,"error":"Serverfehler"}""", 500))
        vm.loadJobs()
        assert(!vm.state.value.accessRevoked) { "Ein 500 ist kein Rechteentzug" }
        server.enqueue(antwort("""{"success":false,"code":"nur_admins","error":"Nur für Admins"}""", 403))
        vm.loadJobs()
        assert(vm.state.value.accessRevoked) { "Nach nur_admins soll die Schleife enden" }
        server.enqueue(antwort("""{"success":true,"jobs":{}}"""))
        vm.loadJobs()
        assert(vm.state.value.accessRevoked) { "Der Entzug bleibt, bis die Seite verlassen wird" }
    }

    @Test
    fun `the tick polls jobs and background until access is revoked`() = runTest {
        server.enqueue(antwort("""{"success":true,"jobs":{}}"""))
        server.enqueue(antwort("""{"success":false,"error":"weg"}""", 404))
        server.enqueue(antwort("""{"success":false,"code":"nur_admins","error":"Nur für Admins"}""", 403))
        server.enqueue(antwort("""{"success":false,"code":"nur_admins","error":"Nur für Admins"}""", 403))
        vm.haltAktuell()
        assert(vm.state.value.accessRevoked) { "Die Schleife endet erst mit dem Entzug" }
        assert(server.requestCount == 4) { "Zwei Takte zu je zwei Abrufen erwartet, waren ${server.requestCount}" }
    }

    // ── Die Warteschlange ────────────────────────────────────────────────────

    @Test
    fun `a deleted entry disappears immediately and stays gone if the server agrees`() = runTest {
        server.enqueue(antwort("""{"success":true,"count":2,"entries":[
            {"set_number":"75192","attempts":1},{"set_number":"10294","attempts":3}]}"""))
        vm.loadQueue()
        assert(vm.state.value.queue.dataOrNull()?.size == 2) { "Vorbedingung: zwei Einträge erwartet" }

        // Only ONE answer: on success it is deliberately NOT reloaded — the
        // anticipated state is then already the correct one, and a second
        // fetch per deletion would be pure load.
        server.enqueue(antwort("""{"success":true}"""))
        val ok = vm.removeEntry("75192")

        assert(ok) { "Der Server hat zugestimmt, das Ergebnis müsste true sein" }
        assert(server.requestCount == 2) {
            "Erwartet: Laden + Löschen. Es waren ${server.requestCount} Abrufe — " +
                "wird bei Erfolg unnötig neu geladen?"
        }
        assert(vm.state.value.queue.dataOrNull()?.map { it.setNumber } == listOf("10294")) {
            "Nach dem Löschen steht: ${vm.state.value.queue.dataOrNull()?.map { it.setNumber }}"
        }
    }

    @Test
    fun `if deleting fails, the list is RESTORED`() = runTest {
        server.enqueue(antwort("""{"success":true,"count":2,"entries":[
            {"set_number":"75192","attempts":1},{"set_number":"10294","attempts":3}]}"""))
        vm.loadQueue()

        // The delete attempt fails. After that the ViewModel asks again — and
        // gets both entries back, because nothing was deleted.
        server.enqueue(antwort("""{"error":"kaputt"}""", 500))
        server.enqueue(antwort("""{"success":true,"count":2,"entries":[
            {"set_number":"75192","attempts":1},{"set_number":"10294","attempts":3}]}"""))
        val ok = vm.removeEntry("75192")

        assert(!ok) { "Ein 500 darf nicht als Erfolg zurückkommen" }
        // THIS is the proof: the anticipated state was rolled back.
        assert(vm.state.value.queue.dataOrNull()?.map { it.setNumber } == listOf("75192", "10294")) {
            "Der Eintrag bleibt verschwunden, obwohl der Server abgelehnt hat: " +
                "${vm.state.value.queue.dataOrNull()?.map { it.setNumber }}"
        }
    }

    @Test
    fun `after the failure it RELOADS, it does not write back the old copy`() = runTest {
        server.enqueue(antwort("""{"success":true,"count":1,"entries":[{"set_number":"75192","attempts":1}]}"""))
        vm.loadQueue()

        // Failure — and in the meantime a DIFFERENT entry has been
        // added on the server. A written-back copy would not show it.
        server.enqueue(antwort("""{"error":"kaputt"}""", 500))
        server.enqueue(antwort("""{"success":true,"count":2,"entries":[
            {"set_number":"75192","attempts":1},{"set_number":"42100","attempts":1}]}"""))
        vm.removeEntry("75192")

        assert(vm.state.value.queue.dataOrNull()?.map { it.setNumber } == listOf("75192", "42100")) {
            "Der zwischenzeitlich hinzugekommene Eintrag fehlt — es wurde eine " +
                "alte Kopie zurückgeschrieben statt neu geladen: " +
                "${vm.state.value.queue.dataOrNull()?.map { it.setNumber }}"
        }
    }

    // ── The default theme ───────────────────────────────────────────────
    //
    // Counter-checks (measured 30.10.2026):
    //   A  loadDesignDefault() takes r.data.theme instead of vorgabe → red “the
    //      selection shows the default, not the own theme”
    //   B  setzeDesign() does not take over the value → red “a set theme
    //      is immediately the default …”

    @Test
    fun `the selection shows the default, not the own design`() = runTest {
        server.enqueue(antwort("""{"success":true,"theme":"werkbank","vorgabe":"noppe","eigenes":"werkbank"}"""))
        vm.loadDesignDefault()
        assert(vm.state.value.defaultDesign == Design.NOPPE) { "Steht: ${vm.state.value.defaultDesign}" }
        assert(server.takeRequest().path == "/api/v1/settings/theme")
    }

    @Test
    fun `a set design is immediately the default, a rejected one is not`() = runTest {
        server.enqueue(antwort("""{"success":true,"theme":"noppe","vorgabe":"noppe"}"""))
        vm.loadDesignDefault()
        server.enqueue(antwort("""{"success":true}"""))
        assert(vm.setzeDesign(Design.BRICK))
        assert(vm.state.value.defaultDesign == Design.BRICK) { "Steht: ${vm.state.value.defaultDesign}" }
        server.enqueue(antwort("""{"error":"kaputt"}""", 500))
        assert(!vm.setzeDesign(Design.HOCHGLANZ))
        assert(vm.state.value.defaultDesign == Design.BRICK) { "Steht: ${vm.state.value.defaultDesign}" }
    }

    // ── Der Vorgabe-Zustand ──────────────────────────────────────────────────

    @Test
    fun `the default state switches immediately and stays if the server agrees`() = runTest {
        server.enqueue(antwort("""{"success":true}"""))
        val ok = vm.setDefaultState(Zustand.GEBRAUCHT)
        assert(ok)
        assert(vm.state.value.defaultState == Zustand.GEBRAUCHT) { "Steht: ${vm.state.value.defaultState}" }
    }

    @Test
    fun `if setting fails, the default state falls BACK`() = runTest {
        val vorher = vm.state.value.defaultState
        server.enqueue(antwort("""{"error":"kaputt"}""", 500))
        val ok = vm.setDefaultState(Zustand.GEBRAUCHT)

        assert(!ok) { "Ein 500 darf nicht als Erfolg zurückkommen" }
        assert(vm.state.value.defaultState == vorher) {
            "Die Oberfläche behauptet dauerhaft '${vm.state.value.defaultState}', " +
                "obwohl nie etwas gespeichert wurde"
        }
    }

    // ── Laden ────────────────────────────────────────────────────────────────

    @Test
    fun `an error when fetching jobs does NOT delete the jobs already shown`() = runTest {
        server.enqueue(antwort("""{"success":true,"jobs":{"priceJob":{"status":"idle","label":"Preise"}}}"""))
        vm.loadJobs()
        assert(vm.state.value.jobs.keys == setOf("priceJob")) { "Vorbedingung: ein Job erwartet" }

        server.enqueue(antwort("""{"error":"kaputt"}""", 500))
        vm.loadJobs()

        assert(vm.state.value.jobs.keys == setOf("priceJob")) {
            "Ein einzelner fehlgeschlagener Abruf hat die Anzeige geleert — die " +
                "Seite fragt alle fünf Sekunden, das flackerte bei jedem Aussetzer"
        }
        assert(!vm.state.value.aktualisiert) {
            "Der Ladekringel bleibt nach einem Fehler stehen"
        }
    }

    @Test
    fun `ladeCacheUndGrenzen fills all four fields from four fetches`() = runTest {
        server.enqueue(antwort("""{"success":true,"prices":7,"price_stale":1,"subsets":2,"catalog":3}"""))
        server.enqueue(antwort("""{"success":true,"limits":{"rebrickable":100,"bricklink":200,"brickset":300}}"""))
        server.enqueue(antwort("""{"success":true,"ttl":"48"}"""))
        server.enqueue(antwort("""{"success":true,"condition":"U"}"""))

        vm.loadCacheAndLimits()

        val s = vm.state.value
        assert(s.cacheStats?.prices == 7) { "Cache-Zahlen fehlen: ${s.cacheStats}" }
        assert(s.apiLimits?.brickset == 300) { "Grenzwerte fehlen: ${s.apiLimits}" }
        assert(s.cacheTtl == "48") { "Cache-Dauer steht auf ${s.cacheTtl}" }
        assert(s.defaultState == Zustand.GEBRAUCHT) { "Vorgabe-Zustand steht auf ${s.defaultState}" }
        assert(server.requestCount == 4) {
            "Erwartet waren vier Abrufe, es waren ${server.requestCount}"
        }
    }

    // ── The server log (moved here from MainViewModel) ────────────
    //
    // Counter-check: in loadLog() the error branch without `abruf =
    // ladefehler(r)` → “an error in the log ends the loading" red.

    @Test
    fun `the log comes with the chosen period`() = runTest {
        server.enqueue(antwort("""{"success":true,"logs":[{"id":1,"level":"warn","message":"Probe","logged_at":"2026-10-27T10:00:00Z"}]}"""))
        vm.loadLog(30)
        val v = vm.managementState.value
        assert(v.protokoll.size == 1 && v.protokoll[0].message == "Probe") { "Protokoll: ${v.protokoll}" }
        assert(v.logMinutes == 30 && !v.abruf.laedt)
        assert(server.takeRequest().path?.contains("30") == true) { "Der Zeitraum ging nicht mit" }
    }

    @Test
    fun `an error in the log ends the loading`() = runTest {
        server.enqueue(antwort("""{"error":"kaputt"}""", 500))
        vm.loadLog(15)
        val v = vm.managementState.value
        assert(!v.abruf.laedt) { "Der Kreisel bleibt nach einem Fehler stehen" }
        assert(v.abruf.errorMessage != null) { "Der Fehler wird nicht gezeigt" }
    }
}
