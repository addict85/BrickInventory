package ch.brickinventoryapp.management

import ch.brickinventoryapp.data.MessageChannel
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.data.testing.PathServer
import ch.brickinventoryapp.data.testing.TestApi
import ch.brickinventoryapp.data.testing.testAccountRepository
import ch.brickinventoryapp.data.testing.testManagementRepository
import ch.brickinventoryapp.management.ui.viewmodel.MonitoringViewModel
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * After a change in monitoring, what the server made of it is shown:
 * a set schedule is fetched anew (the server normalizes "7:5" to "07:05"),
 * and after clearing the cache the numbers come anew. Against a test server.
 *
 * Counter-checks (patches under counter-checks/, not compilable locally, measured by CI):
 *   zeitplan-ohne-nachladen   loadJobs() removed after setJobSchedule → red “after setting …”
 *   cache-leeren-ohne-zahlen  loadCacheAndLimits() removed after clearCache → red “after clearing …”
 */
class MonitoringReloadTest {

    private val paths = PathServer(
        "/api/v1/admin/job-schedule" to """{"success":true}""",
        "/api/v1/admin/jobs" to """{"success":true,"jobs":{},"schedules":{"prices":{"type":"daily","time":"07:05"}}}""",
        "/api/v1/admin/cache-clear" to """{"success":true}""",
    )
    private val folder = File(System.getProperty("java.io.tmpdir"), "bim-mon-nach-${System.nanoTime()}").apply { mkdirs() }
    private val api = TestApi.forTarget(paths.server)
    private val vm = MonitoringViewModel(testManagementRepository(api), testAccountRepository(api), MessageChannel())

    @After
    fun tearDown() {
        paths.server.shutdown()
        folder.deleteRecursively()
    }

    @Test
    fun `after setting a schedule what the server makes of it applies`() = runTest {
        assertTrue(vm.setJobSchedule("prices", "7:5", null) is Outcome.Success)
        assertEquals(listOf("POST /api/v1/admin/job-schedule", "GET /api/v1/admin/jobs"), paths.requests.toList())
        assertEquals("07:05", vm.state.value.jobSchedules["prices"]?.time)
    }

    @Test
    fun `after clearing the cache the numbers come anew`() = runTest {
        assertTrue(vm.emptyCache(everything = true) is Outcome.Success)
        val after = paths.requests.toList().drop(1)
        assertEquals("POST /api/v1/admin/cache-clear", paths.requests.first())
        assertTrue("Die Cache-Zahlen werden nicht neu geholt: $after", "GET /api/v1/admin/cache-stats" in after)
    }
}
