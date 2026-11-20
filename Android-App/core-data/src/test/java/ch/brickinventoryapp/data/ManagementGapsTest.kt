package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.model.json.BrickJson
import ch.brickinventoryapp.vertrag.JobsResponse
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import ch.brickinventoryapp.testing.PfadServer
import ch.brickinventoryapp.testing.TestApi
import ch.brickinventoryapp.testing.testManagementRepository

/**
 * Drei Verwalter-Handlungen, die die Webapp schon kann, auch in der App: Zeitplan eines
 * Jobs ändern (/v1/admin/job-schedule), fehlende Katalogbilder einreihen
 * (/v1/admin/catalog-images), das globale Design umstellen (/v1/settings/admin/theme).
 * `schedules` aus /api/v1/admin/jobs muss dabei auch gelesen werden, sonst erreicht der
 * Wert niemanden.
 *
 * Gegen einen Testserver; Zustand und Anzeige prüfen MonitoringReloadTest und
 * MonitoringJobsDisplayTest (app).
 */
class ManagementGapsTest {

    /**
     * Ausgeführt gegen einen Testserver. Gegenproben:
     *   A  `@POST("api/v1/admin/catalog-images")` auf "…/katalogbilder" → rot
     *   B  setJobSchedule wieder mit `Map<String, Any>` (Stand 8f4f9d3) → rot:
     *      Der kotlinx-Wandler kann `Any` nicht schreiben, der Zeitplan ging nie
     *      hinaus. Gefunden beim Umstellen dieses Tests auf einen Testserver.
     */
    @Test
    fun `die App ruft alle drei Adressen`() {
        val paths = PfadServer()
        try {
            val admin = testManagementRepository(TestApi.fuer(paths.server))
            runBlocking {
                admin.setJobSchedule("prices", zeit = "07:05")
                admin.queueCatalogImages()
                admin.setAppTheme(Design.NOPPE)
            }
            assertEquals(listOf("POST /api/v1/admin/job-schedule", "POST /api/v1/admin/catalog-images",
                "POST /api/v1/settings/admin/theme"), paths.requests.toList())
            assertTrue(paths.koerper[0], "\"time\":\"07:05\"" in paths.koerper[0] && "\"name\":\"prices\"" in paths.koerper[0])
            assertEquals("""{"theme":"noppe"}""", paths.koerper[2])
        } finally {
            paths.server.shutdown()
        }
    }

    /** Der Server schickt den Zeitplan seit jeher mit; die App liest ihn ein. */
    @Test
    fun `der Zeitplan wird eingelesen und angezeigt`() {
        val r = BrickJson.decodeFromString(JobsResponse.serializer(),
            """{"success":true,"jobs":{},"schedules":{"prices":{"type":"daily","time":"07:05"}}}""")
        assertEquals("07:05", r.schedules["prices"]?.time)
        // In den Zustand und an die Job-Karte: MonitoringReloadTest und MonitoringJobsDisplayTest (app).
    }
}
