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
 * Drei Verwalter-Handlungen, die nur die Webapp konnte.
 *
 * ── Woher dieser Test kommt (Nachtrag 137) ──────────────────────────────────
 *
 * Aus derselben Messung wie die Nachtraege davor — Server-Adressen beider
 * Clients gegeneinander. Uebrig blieben drei, die zu Bildschirmen gehoeren,
 * die die App laengst hat:
 *
 *   /v1/admin/job-schedule    Zeitplan eines Jobs aendern
 *   /v1/admin/catalog-images  fehlende KATALOGbilder einreihen
 *   /v1/settings/admin/theme  das globale Design umstellen
 *
 * Beim Zeitplan war der Befund besonders deutlich: `/api/v1/admin/jobs`
 * SCHICKT `schedules` seit jeher mit, und die App hat das Feld nie eingelesen.
 * Ein Wert, der ueber die Leitung kommt und niemanden erreicht — dieselbe Sorte
 * Fund wie „geschrieben und nie gelesen", nur von der anderen Seite.
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
