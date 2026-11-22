package ch.brickinventoryapp.management

import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.MessageChannel
import ch.brickinventoryapp.management.ui.screens.jobKindText
import ch.brickinventoryapp.management.ui.viewmodel.MonitoringViewModel
import ch.brickinventoryapp.model.domain.JobStatus
import ch.brickinventoryapp.model.ui.Message
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.testing.PathServer
import ch.brickinventoryapp.testing.TestApi
import ch.brickinventoryapp.testing.testAccountRepository
import ch.brickinventoryapp.testing.testManagementRepository
import ch.brickinventoryapp.testing.text
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The background work in monitoring: load, cancel, retry — the
 * ViewModel against a test server with the job table's answers.
 *
 * Counter-checks:
 *   A  in HintergrundAnsichten `cancellable` also true for FEHLER → red “what one may
 *      do with a job is already fixed”
 *   B  in MonitoringViewModel.afterJob the reload removed → red “cancel
 *      reports success and reloads” (only one GET request)
 *   C  on Ergebnis.Fehler the success sentence instead of errorMessage → red “a 409
 *      shows the server's sentence”
 *   D  `jobProcessRunning = true` fixed → red “without a job process the warning is shown”
 * Counter-check: report()
 *   starts the action but does not put the sentence into the channel → red “an action
 *   runs in the ViewModel …”
 */
class BackgroundWorkTest {

    private val list = """{"success":true,
        "auftraege":[
          {"id":"17","type":"bilder","status":"laeuft","attempts":1,"max_attempts":5,"due_at":"2026-10-30T10:00:00Z",
           "deadline_at":null,"started_at":"2026-10-30T10:00:05Z","created_at":"2026-10-30T09:59:00Z","updated_at":null,
           "progress":{"erledigt":3,"gesamt":12,"text":"Bilder"},"error_message":null,"user_id":4,"geplant":false,"set_number":"75192-1"},
          {"id":"18","type":"preise","status":"fehler","attempts":3,"max_attempts":3,"due_at":"2026-10-30T11:00:00Z",
           "deadline_at":null,"started_at":null,"created_at":"2026-10-30T09:00:00Z","updated_at":null,
           "progress":null,"error_message":"BrickLink antwortet nicht","user_id":null,"geplant":true,"set_number":null}],
        "zusammenfassung":[{"type":"bilder","status":"laeuft","anzahl":1}],
        "pausen":[{"type":"preise","until_at":"2026-10-30T12:00:00Z","reason":"Kontingent"}],
        "bildbedarf":7,
        "job_prozess":{"lebenszeichen":null,"alter_sekunden":null,"laeuft":false}}"""

    private val paths = PathServer("/api/v1/admin/auftraege" to list)
    private val dir = File(System.getProperty("java.io.tmpdir"), "bim-hg-${System.nanoTime()}")
    private val channel = MessageChannel()
    private val vm = TestApi.forTarget(paths.server).let { api ->
        MonitoringViewModel(testManagementRepository(api), testAccountRepository(api), channel)
    }

    @After
    fun tearDown() {
        paths.server.shutdown()
        dir.deleteRecursively()
    }

    @Test
    fun `what one may do with a job is already settled`() = runBlocking {
        vm.loadBackground()
        val a = vm.background.value.view!!
        val (running, error) = a.jobs
        assertEquals(JobStatus.RUNNING, running.status)
        assertEquals("3/12 · Bilder", running.progressText)
        assertEquals(R.string.kind_images, jobKindText(running.kind))
        assertTrue(running.cancellable); assertFalse(running.retryable)
        assertFalse(error.cancellable); assertTrue(error.retryable)
        assertEquals(7, a.imageDemand)
        assertEquals("Kontingent", a.pauses.single().reason)
    }

    @Test
    fun `without a job process the warning is shown`() = runBlocking {
        vm.loadBackground()
        assertFalse(vm.background.value.view!!.jobProcessRunning)
    }

    /** The action runs in the viewModelScope; the sentence arrives via the message channel, not via the screen. */
    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun `an action runs in the ViewModel and reports via the state`() = runBlocking {
        paths.responses["/api/v1/admin/auftraege/17/abbrechen"] = """{"success":true,"id":"17","status":"abgebrochen"}"""
        Dispatchers.setMain(UnconfinedTestDispatcher())
        try {
            vm.cancelJob("17")
            withTimeout(5_000) { channel.message.first { it != null } }
            assertEquals("t${R.string.background_cancelled_ok}", channel.text)
        } finally {
            vm.viewModelScope.cancel()
            Dispatchers.resetMain()
        }
    }

    @Test
    fun `cancelling reports success and reloads`() = runBlocking {
        paths.responses["/api/v1/admin/auftraege/17/abbrechen"] = """{"success":true,"id":"17","status":"abgebrochen"}"""
        vm.loadBackground()
        val sentence = vm.requestJobCancel("17")
        assertEquals(Message.Resource(R.string.background_cancelled_ok), sentence)
        assertEquals(listOf("POST /api/v1/admin/auftraege/17/abbrechen"), paths.requestsTo("/abbrechen"))
        assertEquals(2, paths.requestsTo("GET /api/v1/admin/auftraege").size)
    }

    @Test
    fun `a 409 shows the server's sentence`() = runBlocking {
        paths.responses["/api/v1/admin/auftraege/17/wiederholen"] =
            """{"success":false,"code":"auftrag_nicht_aenderbar","error":"Der Auftrag lässt sich nicht mehr ändern."}"""
        paths.codes["/api/v1/admin/auftraege/17/wiederholen"] = 409
        val sentence = vm.repeatJob("17")
        assertEquals(Message.Text("Der Auftrag lässt sich nicht mehr ändern."), sentence)
        assertEquals("Auch nach dem Fehlschlag gilt der Stand des Servers", 1,
            paths.requestsTo("GET /api/v1/admin/auftraege").size)
    }

    @Test
    fun `clearing reports the number, starting the name`() = runBlocking {
        paths.responses["/api/v1/admin/auftraege/art/bilder"] = """{"success":true,"art":"bilder","entfernt":4}"""
        paths.responses["/api/v1/admin/auftraege/art/preise/jetzt"] = """{"success":true,"art":"preise","gestartet":false}"""
        assertEquals(Message.Quantity(R.plurals.background_emptied, 4), vm.emptyJobKind("bilder"))
        assertEquals(Message.Resource(R.string.background_nothing_started, listOf("Preise")), vm.startJobKind("preise", "Preise"))
        assertEquals(listOf("DELETE /api/v1/admin/auftraege/art/bilder"), paths.requestsTo("DELETE"))
    }
}
