package ch.brickinventoryapp.management

import ch.brickinventoryapp.data.MessageChannel
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.data.testing.BrickApiService
import ch.brickinventoryapp.data.testing.testAccountRepository
import ch.brickinventoryapp.data.testing.testManagementRepository
import ch.brickinventoryapp.management.ui.viewmodel.MonitoringViewModel
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.json.BrickJson
import ch.brickinventoryapp.model.ui.dataOrNull
import ch.brickinventoryapp.model.ui.errorMessage
import ch.brickinventoryapp.model.ui.loading
import ch.brickinventoryapp.model.ui.theme.Design
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

/**
 * The monitoring ViewModel against a MockWebServer: anticipated states with
 * a rollback on failure, the poll clock, theme and log. MockWebServer delivers in
 * order, independent of the path; each test lays down as many answers as the
 * ViewModel makes fetches.
 *
 * Counter-checks: in loadJobs() `accessRevoked` not
 * set → red “a 403 only_admins ends the polling …”;
 * counter-checks/monitoring-interval-endless.patch (holdCurrent() with `while (true)`)
 * → red “the clock polls jobs and background …” (runs until the time limit).
 */
class MonitoringViewModelBehaviorTest {

    private lateinit var server: MockWebServer
    private lateinit var cacheDir: File
    private lateinit var vm: MonitoringViewModel

    private fun response(body: String, code: Int = 200) =
        MockResponse().setResponseCode(code)
            .setHeader("Content-Type", "application/json").setBody(body)

    @Before
    fun setUp() {
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
        vm = MonitoringViewModel(testManagementRepository(api), testAccountRepository(api), MessageChannel())
    }

    @After
    fun tearDown() {
        server.shutdown()
        cacheDir.deleteRecursively()
    }

    @Test
    fun `a 403 only_admins ends the polling, another error does not`() = runTest {
        server.enqueue(response("""{"success":false,"error":"Serverfehler"}""", 500))
        vm.loadJobs()
        assert(!vm.state.value.accessRevoked) { "a 500 is no withdrawal of rights" }
        server.enqueue(response("""{"success":false,"code":"admins_only","error":"Nur für Admins"}""", 403))
        vm.loadJobs()
        assert(vm.state.value.accessRevoked) { "after nur_admins the loop should end" }
        server.enqueue(response("""{"success":true,"jobs":{}}"""))
        vm.loadJobs()
        assert(vm.state.value.accessRevoked) { "the withdrawal stays until the page is left" }
    }

    @Test
    fun `the tick polls jobs and background until access is revoked`() = runTest {
        server.enqueue(response("""{"success":true,"jobs":{}}"""))
        server.enqueue(response("""{"success":false,"error":"weg"}""", 404))
        server.enqueue(response("""{"success":false,"code":"admins_only","error":"Nur für Admins"}""", 403))
        server.enqueue(response("""{"success":false,"code":"admins_only","error":"Nur für Admins"}""", 403))
        vm.holdCurrent()
        assert(vm.state.value.accessRevoked) { "the loop only ends with the withdrawal" }
        assert(server.requestCount == 4) { "two ticks of two fetches each expected, were ${server.requestCount}" }
    }

    // ── Die Warteschlange ────────────────────────────────────────────────────

    @Test
    fun `a deleted entry disappears immediately and stays gone if the server agrees`() = runTest {
        server.enqueue(response("""{"success":true,"count":2,"entries":[
            {"set_number":"75192","attempts":1},{"set_number":"10294","attempts":3}]}"""))
        vm.loadQueue()
        assert(vm.state.value.queue.dataOrNull()?.size == 2) { "precondition: two entries expected" }

        // Only ONE answer: on success it is deliberately NOT reloaded — the
        // anticipated state is then already the correct one, and a second
        // fetch per deletion would be pure load.
        server.enqueue(response("""{"success":true}"""))
        val ok = vm.removeEntry("75192") is Outcome.Success

        assert(ok) { "the server agreed, the result should be true" }
        assert(server.requestCount == 2) {
            "Expected: load + delete. There were ${server.requestCount} fetches — " +
                "is it reloaded needlessly on success?"
        }
        assert(vm.state.value.queue.dataOrNull()?.map { it.setNumber } == listOf("10294")) {
            "after deleting it shows: ${vm.state.value.queue.dataOrNull()?.map { it.setNumber }}"
        }
    }

    @Test
    fun `if deleting fails, the list is RESTORED`() = runTest {
        server.enqueue(response("""{"success":true,"count":2,"entries":[
            {"set_number":"75192","attempts":1},{"set_number":"10294","attempts":3}]}"""))
        vm.loadQueue()

        // The delete attempt fails. After that the ViewModel asks again — and
        // gets both entries back, because nothing was deleted.
        server.enqueue(response("""{"error":"kaputt"}""", 500))
        server.enqueue(response("""{"success":true,"count":2,"entries":[
            {"set_number":"75192","attempts":1},{"set_number":"10294","attempts":3}]}"""))
        val ok = vm.removeEntry("75192") is Outcome.Success

        assert(!ok) { "a 500 must not come back as success" }
        // THIS is the proof: the anticipated state was rolled back.
        assert(vm.state.value.queue.dataOrNull()?.map { it.setNumber } == listOf("75192", "10294")) {
            "The entry stays gone although the server refused: " +
                "${vm.state.value.queue.dataOrNull()?.map { it.setNumber }}"
        }
    }

    @Test
    fun `after the failure it RELOADS, it does not write back the old copy`() = runTest {
        server.enqueue(response("""{"success":true,"count":1,"entries":[{"set_number":"75192","attempts":1}]}"""))
        vm.loadQueue()

        // Failure — and in the meantime a DIFFERENT entry has been
        // added on the server. A written-back copy would not show it.
        server.enqueue(response("""{"error":"kaputt"}""", 500))
        server.enqueue(response("""{"success":true,"count":2,"entries":[
            {"set_number":"75192","attempts":1},{"set_number":"42100","attempts":1}]}"""))
        vm.removeEntry("75192")

        assert(vm.state.value.queue.dataOrNull()?.map { it.setNumber } == listOf("75192", "42100")) {
            "The entry added in the meantime is missing — an " +
                "old copy was written back instead of reloaded: " +
                "${vm.state.value.queue.dataOrNull()?.map { it.setNumber }}"
        }
    }

    // ── The default theme ───────────────────────────────────────────────
    //
    // Counter-checks (measured 30.10.2026):
    //   A  loadDesignDefault() takes r.data.theme instead of the default → red “the
    //      selection shows the default, not the own theme”
    //   B  setDesign() does not take over the value → red “a set theme
    //      is immediately the default …”

    @Test
    fun `the selection shows the default, not the own design`() = runTest {
        server.enqueue(response("""{"success":true,"theme":"werkbank","preset":"noppe","own":"werkbank"}"""))
        vm.loadDesignDefault()
        assert(vm.state.value.defaultDesign == Design.STUD) { "shows: ${vm.state.value.defaultDesign}" }
        assert(server.takeRequest().path == "/api/v2/settings/theme")
    }

    @Test
    fun `a set design is immediately the default, a rejected one is not`() = runTest {
        server.enqueue(response("""{"success":true,"theme":"noppe","preset":"noppe"}"""))
        vm.loadDesignDefault()
        server.enqueue(response("""{"success":true}"""))
        assert(vm.setDesign(Design.BRICK) is Outcome.Success)
        assert(vm.state.value.defaultDesign == Design.BRICK) { "shows: ${vm.state.value.defaultDesign}" }
        server.enqueue(response("""{"error":"kaputt"}""", 500))
        assert(vm.setDesign(Design.GLOSSY) is Outcome.Failure)
        assert(vm.state.value.defaultDesign == Design.BRICK) { "shows: ${vm.state.value.defaultDesign}" }
    }

    // ── Der Vorgabe-Zustand ──────────────────────────────────────────────────

    @Test
    fun `the default state switches immediately and stays if the server agrees`() = runTest {
        server.enqueue(response("""{"success":true}"""))
        val ok = vm.setDefaultState(Condition.USED) is Outcome.Success
        assert(ok)
        assert(vm.state.value.defaultState == Condition.USED) { "shows: ${vm.state.value.defaultState}" }
    }

    @Test
    fun `if setting fails, the default state falls BACK`() = runTest {
        val before = vm.state.value.defaultState
        server.enqueue(response("""{"error":"kaputt"}""", 500))
        val ok = vm.setDefaultState(Condition.USED) is Outcome.Success

        assert(!ok) { "a 500 must not come back as success" }
        assert(vm.state.value.defaultState == before) {
            "The UI permanently claims '${vm.state.value.defaultState}', " +
                "although nothing was ever saved"
        }
    }

    // ── Laden ────────────────────────────────────────────────────────────────

    @Test
    fun `an error when fetching jobs does NOT delete the jobs already shown`() = runTest {
        server.enqueue(response("""{"success":true,"jobs":{"priceJob":{"status":"idle","label":"Preise"}}}"""))
        vm.loadJobs()
        assert(vm.state.value.jobs.keys == setOf("priceJob")) { "precondition: one job expected" }

        server.enqueue(response("""{"error":"kaputt"}""", 500))
        vm.loadJobs()

        assert(vm.state.value.jobs.keys == setOf("priceJob")) {
            "A single failed fetch emptied the display — the " +
                "page asks every five seconds, that flickered on every dropout"
        }
        assert(!vm.state.value.updated) {
            "the spinner stays after an error"
        }
    }

    @Test
    fun `loadCacheAndLimits fills all four fields from four fetches`() = runTest {
        server.enqueue(response("""{"success":true,"prices":7,"price_stale":1,"subsets":2,"catalog":3}"""))
        server.enqueue(response("""{"success":true,"limits":{"rebrickable":100,"bricklink":200,"brickset":300}}"""))
        server.enqueue(response("""{"success":true,"ttl":"48"}"""))
        server.enqueue(response("""{"success":true,"condition":"U"}"""))

        vm.loadCacheAndLimits()

        val s = vm.state.value
        assert(s.cacheStats?.prices == 7) { "cache figures missing: ${s.cacheStats}" }
        assert(s.apiLimits?.brickset == 300) { "limits missing: ${s.apiLimits}" }
        assert(s.cacheTtl == "48") { "cache duration shows ${s.cacheTtl}" }
        assert(s.defaultState == Condition.USED) { "default state shows ${s.defaultState}" }
        assert(server.requestCount == 4) {
            "four fetches were expected, there were ${server.requestCount}"
        }
    }

    // ── The server log (moved here from MainViewModel) ────────────
    //
    // Counter-check: in loadLog() the error branch without `fetch =
    // ladefehler(r)` → “an error in the log ends the loading" red.

    @Test
    fun `the log comes with the chosen period`() = runTest {
        server.enqueue(response("""{"success":true,"logs":[{"id":1,"level":"warn","message":"Probe","logged_at":"2026-10-27T10:00:00Z"}]}"""))
        vm.loadLog(30)
        val v = vm.managementState.value
        assert(v.log.size == 1 && v.log[0].message == "Probe") { "log: ${v.log}" }
        assert(v.logMinutes == 30 && !v.fetch.loading)
        assert(server.takeRequest().path?.contains("30") == true) { "the period did not go along" }
    }

    @Test
    fun `an error in the log ends the loading`() = runTest {
        server.enqueue(response("""{"error":"kaputt"}""", 500))
        vm.loadLog(15)
        val v = vm.managementState.value
        assert(!v.fetch.loading) { "the spinner stays after an error" }
        assert(v.fetch.errorMessage != null) { "the error is not shown" }
    }
}
