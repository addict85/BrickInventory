package ch.brickinventoryapp.verwaltung

import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.testing.testAccountRepository
import ch.brickinventoryapp.testing.PfadServer
import ch.brickinventoryapp.testing.TestApi
import ch.brickinventoryapp.testing.testManagementRepository
import ch.brickinventoryapp.verwaltung.ui.viewmodel.MonitoringViewModel
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Nach einer Änderung in der Überwachung steht da, was der Server daraus gemacht hat:
 * Ein gesetzter Zeitplan wird neu geholt (der Server normalisiert „7:5“ zu „07:05“),
 * und nach dem Leeren des Caches kommen die Zahlen neu. Gegen einen Testserver.
 *
 * Gegenproben (Patches unter gegenproben/, lokal nicht übersetzbar, misst die CI):
 *   zeitplan-ohne-nachladen   loadJobs() nach setJobSchedule entfernt → rot „nach dem Setzen …“
 *   cache-leeren-ohne-zahlen  loadCacheAndLimits() nach clearCache entfernt → rot „nach dem Leeren …“
 */
class MonitoringReloadTest {

    private val paths = PfadServer(
        "/api/v1/admin/job-schedule" to """{"success":true}""",
        "/api/v1/admin/jobs" to """{"success":true,"jobs":{},"schedules":{"prices":{"type":"daily","time":"07:05"}}}""",
        "/api/v1/admin/cache-clear" to """{"success":true}""",
    )
    private val folder = File(System.getProperty("java.io.tmpdir"), "bim-mon-nach-${System.nanoTime()}").apply { mkdirs() }
    private val api = TestApi.fuer(paths.server)
    private val vm = MonitoringViewModel(testManagementRepository(api), testAccountRepository(api), MeldungsKanal())

    @After
    fun zu() {
        paths.server.shutdown()
        folder.deleteRecursively()
    }

    @Test
    fun `nach dem Setzen eines Zeitplans gilt, was der Server daraus macht`() = runTest {
        assertTrue(vm.setzeJobZeitplan("prices", "7:5", null))
        assertEquals(listOf("POST /api/v1/admin/job-schedule", "GET /api/v1/admin/jobs"), paths.requests.toList())
        assertEquals("07:05", vm.state.value.jobSchedules["prices"]?.time)
    }

    @Test
    fun `nach dem Leeren des Caches kommen die Zahlen neu`() = runTest {
        assertTrue(vm.emptyCache(alles = true))
        val danach = paths.requests.toList().drop(1)
        assertEquals("POST /api/v1/admin/cache-clear", paths.requests.first())
        assertTrue("Die Cache-Zahlen werden nicht neu geholt: $danach", "GET /api/v1/admin/cache-stats" in danach)
    }
}
