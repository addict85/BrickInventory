package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.model.json.BrickJson
import ch.brickinventoryapp.contract.JobsResponse
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import ch.brickinventoryapp.testing.PathServer
import ch.brickinventoryapp.testing.TestApi
import ch.brickinventoryapp.testing.testManagementRepository

/**
 * Three admin actions the web app can already do, in the app too: change the schedule
 * of a job (/v1/admin/job-schedule), queue missing catalog images
 * (/v1/admin/catalog-images), switch the global design (/v1/settings/admin/theme).
 * `schedules` from /api/v1/admin/jobs must be read in as well, otherwise the
 * value reaches nobody.
 *
 * Against a test server; state and display are checked by MonitoringReloadTest and
 * MonitoringJobsDisplayTest (app).
 */
class ManagementGapsTest {

    /**
     * Executed against a test server. Counter-checks:
     *   A  `@POST("api/v1/admin/catalog-images")` to "…/katalogbilder" → red
     *   B  setJobSchedule again with `Map<String, Any>` (state 8f4f9d3) → red:
     *      the kotlinx converter cannot write `Any`, the schedule never went
     *      out. Found while switching this test to a test server.
     */
    @Test
    fun `the app calls all three addresses`() {
        val paths = PathServer()
        try {
            val admin = testManagementRepository(TestApi.forTarget(paths.server))
            runBlocking {
                admin.setJobSchedule("prices", time = "07:05")
                admin.queueCatalogImages()
                admin.setAppTheme(Design.STUD)
            }
            assertEquals(listOf("POST /api/v1/admin/job-schedule", "POST /api/v1/admin/catalog-images",
                "POST /api/v1/settings/admin/theme"), paths.requests.toList())
            assertTrue(paths.bodyBytes[0], "\"time\":\"07:05\"" in paths.bodyBytes[0] && "\"name\":\"prices\"" in paths.bodyBytes[0])
            assertEquals("""{"theme":"noppe"}""", paths.bodyBytes[2])
        } finally {
            paths.server.shutdown()
        }
    }

    /** The server has always sent the schedule along; the app reads it in. */
    @Test
    fun `the schedule is read in and shown`() {
        val r = BrickJson.decodeFromString(JobsResponse.serializer(),
            """{"success":true,"jobs":{},"schedules":{"prices":{"type":"daily","time":"07:05"}}}""")
        assertEquals("07:05", r.schedules["prices"]?.time)
        // Into the state and onto the job card: MonitoringReloadTest and MonitoringJobsDisplayTest (app).
    }
}
