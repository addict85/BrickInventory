package ch.brickinventoryapp.management

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.MessageChannel
import ch.brickinventoryapp.data.testing.PathServer
import ch.brickinventoryapp.data.testing.TestApi
import ch.brickinventoryapp.data.testing.testAccountRepository
import ch.brickinventoryapp.data.testing.testManagementRepository
import ch.brickinventoryapp.data.testing.text
import ch.brickinventoryapp.management.ui.screens.jobKindText
import ch.brickinventoryapp.management.ui.viewmodel.MonitoringViewModel
import ch.brickinventoryapp.model.domain.JobStatus
import ch.brickinventoryapp.model.ui.Message
import ch.brickinventoryapp.resources.R
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
        "jobs":[
          {"id":"17","type":"images","status":"running","attempts":1,"max_attempts":5,"due_at":"2026-10-30T10:00:00Z",
           "deadline_at":null,"started_at":"2026-10-30T10:00:05Z","created_at":"2026-10-30T09:59:00Z","updated_at":null,
           "progress":{"done":3,"total":12,"text":"Bilder"},"error_message":null,"user_id":4,"scheduled":false,"set_number":"75192-1"},
          {"id":"18","type":"prices","status":"error","attempts":3,"max_attempts":3,"due_at":"2026-10-30T11:00:00Z",
           "deadline_at":null,"started_at":null,"created_at":"2026-10-30T09:00:00Z","updated_at":null,
           "progress":null,"error_message":"BrickLink antwortet nicht","user_id":null,"scheduled":true,"set_number":null}],
        "summary":[{"type":"images","status":"running","count":1}],
        "pauses":[{"type":"prices","until_at":"2026-10-30T12:00:00Z","reason":"Kontingent"}],
        "image_demand":7,
        "job_process":{"heartbeat":null,"age_seconds":null,"running":false}}"""

    private val paths = PathServer("/api/v2/admin/job-queue" to list)
    private val dir = File(System.getProperty("java.io.tmpdir"), "bim-hg-${System.nanoTime()}")
    private val channel = MessageChannel()
    private val vm = TestApi.forTarget(paths.server).let { api ->
        MonitoringViewModel(testManagementRepository(api), testAccountRepository(api), channel, SavedStateHandle())
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
        paths.responses["/api/v2/admin/job-queue/17/cancel"] = """{"success":true,"id":"17","status":"cancelled"}"""
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
        paths.responses["/api/v2/admin/job-queue/17/cancel"] = """{"success":true,"id":"17","status":"cancelled"}"""
        vm.loadBackground()
        val sentence = vm.requestJobCancel("17")
        assertEquals(Message.Resource(R.string.background_cancelled_ok), sentence)
        assertEquals(listOf("POST /api/v2/admin/job-queue/17/cancel"), paths.requestsTo("/cancel"))
        assertEquals(2, paths.requestsTo("GET /api/v2/admin/job-queue").size)
    }

    @Test
    fun `a 409 shows the server's sentence`() = runBlocking {
        paths.responses["/api/v2/admin/job-queue/17/retry"] =
            """{"success":false,"code":"job_not_changeable","error":"Der Auftrag lässt sich nicht mehr ändern."}"""
        paths.codes["/api/v2/admin/job-queue/17/retry"] = 409
        val sentence = vm.repeatJob("17")
        assertEquals(Message.Text("Der Auftrag lässt sich nicht mehr ändern."), sentence)
        assertEquals("even after the failure the server's status counts", 1,
            paths.requestsTo("GET /api/v2/admin/job-queue").size)
    }

    @Test
    fun `clearing reports the number, starting the name`() = runBlocking {
        paths.responses["/api/v2/admin/job-queue/kind/images"] = """{"success":true,"kind":"images","removed":4}"""
        paths.responses["/api/v2/admin/job-queue/kind/prices/now"] = """{"success":true,"kind":"prices","started":false}"""
        assertEquals(Message.Quantity(R.plurals.background_emptied, 4), vm.emptyJobKind("images"))
        assertEquals(Message.Resource(R.string.background_nothing_started, listOf("Preise")), vm.startJobKind("prices", "Preise"))
        assertEquals(listOf("DELETE /api/v2/admin/job-queue/kind/images"), paths.requestsTo("DELETE"))
    }
}
