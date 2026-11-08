package ch.brickinventoryapp.verwaltung

import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.testing.KontoRepository
import ch.brickinventoryapp.testing.NummernTexte
import ch.brickinventoryapp.testing.PfadServer
import ch.brickinventoryapp.testing.ResponseCache
import ch.brickinventoryapp.testing.TestApi
import ch.brickinventoryapp.testing.VerwaltungRepository
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
 *   zeitplan-ohne-nachladen   ladeJobs() nach setJobSchedule entfernt → rot „nach dem Setzen …“
 *   cache-leeren-ohne-zahlen  ladeCacheUndGrenzen() nach clearCache entfernt → rot „nach dem Leeren …“
 */
class MonitoringNachladenTest {

    private val pfade = PfadServer(
        "/api/v1/admin/job-schedule" to """{"success":true}""",
        "/api/v1/admin/jobs" to """{"success":true,"jobs":{},"schedules":{"prices":{"type":"daily","time":"07:05"}}}""",
        "/api/v1/admin/cache-clear" to """{"success":true}""",
    )
    private val ordner = File(System.getProperty("java.io.tmpdir"), "bim-mon-nach-${System.nanoTime()}").apply { mkdirs() }
    private val api = TestApi.fuer(pfade.server)
    private val cache = ResponseCache { ordner }
    private val vm = MonitoringViewModel(VerwaltungRepository(api, cache), KontoRepository(api, cache), NummernTexte, MeldungsKanal())

    @After
    fun zu() {
        pfade.server.shutdown()
        ordner.deleteRecursively()
    }

    @Test
    fun `nach dem Setzen eines Zeitplans gilt, was der Server daraus macht`() = runTest {
        assertTrue(vm.setzeJobZeitplan("prices", "7:5", null))
        assertEquals(listOf("POST /api/v1/admin/job-schedule", "GET /api/v1/admin/jobs"), pfade.anfragen.toList())
        assertEquals("07:05", vm.state.value.jobSchedules["prices"]?.time)
    }

    @Test
    fun `nach dem Leeren des Caches kommen die Zahlen neu`() = runTest {
        assertTrue(vm.leereCache(alles = true))
        val danach = pfade.anfragen.toList().drop(1)
        assertEquals("POST /api/v1/admin/cache-clear", pfade.anfragen.first())
        assertTrue("Die Cache-Zahlen werden nicht neu geholt: $danach", "GET /api/v1/admin/cache-stats" in danach)
    }
}
