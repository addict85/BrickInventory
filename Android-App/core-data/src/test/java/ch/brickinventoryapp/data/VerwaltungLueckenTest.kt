package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.api.ApiJson
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.model.data.model.JobsResponse
import ch.brickinventoryapp.data.repository.VerwaltungRepository
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.PfadServer
import ch.brickinventoryapp.testing.ResponseCache
import ch.brickinventoryapp.testing.TestApi
import ch.brickinventoryapp.testing.VerwaltungRepository

/**
 * Drei Verwalter-Handlungen, die die Webapp schon kann, auch in der App: Zeitplan eines
 * Jobs ändern (/v1/admin/job-schedule), fehlende Katalogbilder einreihen
 * (/v1/admin/catalog-images), das globale Design umstellen (/v1/settings/admin/theme).
 * `schedules` aus /api/v1/admin/jobs muss dabei auch gelesen werden, sonst erreicht der
 * Wert niemanden.
 *
 * Gegen einen Testserver; Zustand und Anzeige prüfen MonitoringNachladenTest und
 * MonitoringJobsAnzeigeTest (app).
 */
class VerwaltungLueckenTest {

    /**
     * Ausgeführt gegen einen Testserver. Gegenproben:
     *   A  `@POST("api/v1/admin/catalog-images")` auf "…/katalogbilder" → rot
     *   B  setJobSchedule wieder mit `Map<String, Any>` (Stand 8f4f9d3) → rot:
     *      Der kotlinx-Wandler kann `Any` nicht schreiben, der Zeitplan ging nie
     *      hinaus. Gefunden beim Umstellen dieses Tests auf einen Testserver.
     */
    @Test
    fun `die App ruft alle drei Adressen`() {
        val pfade = PfadServer()
        try {
            val admin = VerwaltungRepository(TestApi.fuer(pfade.server),
                ResponseCache { File(System.getProperty("java.io.tmpdir"), "bim-verwaltung") })
            runBlocking {
                admin.setJobSchedule("prices", zeit = "07:05")
                admin.queueCatalogImages()
                admin.setAppTheme("noppe")
            }
            assertEquals(listOf("POST /api/v1/admin/job-schedule", "POST /api/v1/admin/catalog-images",
                "POST /api/v1/settings/admin/theme"), pfade.anfragen.toList())
            assertTrue(pfade.koerper[0], "\"time\":\"07:05\"" in pfade.koerper[0] && "\"name\":\"prices\"" in pfade.koerper[0])
            assertEquals("""{"theme":"noppe"}""", pfade.koerper[2])
        } finally {
            pfade.server.shutdown()
        }
    }

    /** Der Server schickt den Zeitplan seit jeher mit; die App liest ihn ein. */
    @Test
    fun `der Zeitplan wird eingelesen und angezeigt`() {
        val r = ApiJson.decodeFromString(JobsResponse.serializer(),
            """{"success":true,"jobs":{},"schedules":{"prices":{"type":"daily","time":"07:05"}}}""")
        assertEquals("07:05", r.schedules["prices"]?.time)
        // In den Zustand und an die Job-Karte: MonitoringNachladenTest und MonitoringJobsAnzeigeTest (app).
    }
}
