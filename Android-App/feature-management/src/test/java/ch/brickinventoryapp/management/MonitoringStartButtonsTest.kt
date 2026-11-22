package ch.brickinventoryapp.management

import ch.brickinventoryapp.data.MessageChannel
import ch.brickinventoryapp.management.ui.viewmodel.Jobstart
import ch.brickinventoryapp.management.ui.viewmodel.MonitoringViewModel
import ch.brickinventoryapp.model.ui.Load
import ch.brickinventoryapp.model.ui.Message
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.testing.PathServer
import ch.brickinventoryapp.testing.testAccountRepository
import ch.brickinventoryapp.testing.testManagementRepository
import ch.brickinventoryapp.testing.text
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The start buttons and the queue run in the ViewModel: the screen only calls
 * `launch(job)`, state and message come from the ViewModel, resetting after
 * four seconds happens on the test clock.
 *
 * Counter-checks (patches under counter-checks/):
 *   startknopf-bleibt-gestartet      resetting after STARTED_MS removed → red “a start button shows …”
 *   startknopf-fehlschlag-still      failure without a message → red “a failed start reports …”
 *   warteschlange-fehler-verschluckt queue error treated as an empty list → red “a failed queue …”
 *   The cause dropped from a failure (Meldung.Resource(satz) without werte) → red “a failed start
 *   reports …”, “a failed removal names …” and “a failed save names …” (not locally runnable,
 *   to be checked in CI).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class MonitoringStartButtonsTest {

    private val paths = PathServer(
        "/api/v1/admin/trigger-price-job" to """{"success":true}""",
        "/api/v1/admin/reimport-instructions" to """{"success":true,"enqueued":3}""",
    )
    private val channel = MessageChannel()

    private fun TestScope.vm(): MonitoringViewModel {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        val api = paths.onTick()
        return MonitoringViewModel(testManagementRepository(api), testAccountRepository(api), channel)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
        paths.server.shutdown()
    }

    @Test
    fun `a start button shows starting, then started, after four seconds its label again`() = runTest {
        val vm = vm()
        vm.launch(Jobstart.PRICE_RUN)
        assertEquals(Message.Resource(R.string.monitoring_starting), vm.state.value.buttons[Jobstart.PRICE_RUN])
        runCurrent()
        assertEquals(Message.Resource(R.string.monitoring_started), vm.state.value.buttons[Jobstart.PRICE_RUN])
        vm.launch(Jobstart.PRICE_RUN)
        runCurrent()
        assertEquals("Ein zweiter Tipp startet nicht noch einmal", 1, paths.requestsTo("trigger-price-job").size)
        advanceTimeBy(4_001)
        assertEquals(emptyMap<Jobstart, Message>(), vm.state.value.buttons)
    }

    @Test
    fun `the instructions name the number of queued sets`() = runTest {
        val vm = vm()
        vm.launch(Jobstart.INSTRUCTIONS)
        runCurrent()
        assertEquals(Message.Quantity(R.plurals.monitoring_reimport_enqueued, 3), vm.state.value.buttons[Jobstart.INSTRUCTIONS])
    }

    @Test
    fun `a failed start reports and releases the button`() = runTest {
        paths.codes["/api/v1/admin/catalog-images"] = 500
        val vm = vm()
        vm.launch(Jobstart.CATALOG_IMAGES)
        runCurrent()
        assertCause(R.string.monitoring_start_error, channel.message.value)
        assertEquals(emptyMap<Jobstart, Message>(), vm.state.value.buttons)
    }

    @Test
    fun `a failed removal names the set and the cause`() = runTest {
        paths.responses["/api/v1/admin/brickset-queue"] = """{"success":true,"count":0,"entries":[]}"""
        paths.codes["/api/v1/admin/brickset-queue/75192"] = 500
        val vm = vm()
        vm.remove("75192")
        runCurrent()
        val m = channel.message.value as Message.Resource
        assertEquals(R.string.monitoring_delete_error, m.id)
        assertEquals("75192", m.values.first())
        assertTrue("Ohne Grund: ${m.values}", m.values.last() is Message)
    }

    @Test
    fun `a failed save names the cause instead of staying silent`() = runTest {
        paths.codes["/api/v1/admin/cache-ttl"] = 500
        val vm = vm()
        vm.saveCacheDuration(12)
        runCurrent()
        assertCause(R.string.monitoring_save_failed, channel.message.value)
    }

    /** The sentence [id] with exactly one value, and that value is the failure's own message. */
    private fun assertCause(id: Int, m: Message?) {
        val r = m as? Message.Resource ?: throw AssertionError("Keine Meldung: $m")
        assertEquals(id, r.id)
        assertTrue("Ohne Grund: ${r.values}", r.values.single() is Message)
    }

    @Test
    fun `a failed queue shows the error instead of an empty list`() = runTest {
        paths.codes["/api/v1/admin/brickset-queue"] = 500
        val vm = vm()
        vm.showQueue()
        runCurrent()
        assert(vm.state.value.queue is Load.Failure) { "Steht: ${vm.state.value.queue}" }
    }

    @Test
    fun `retrying reports the set number`() = runTest {
        paths.responses["/api/v1/admin/brickset-queue/75192/retry"] = """{"success":true}"""
        paths.responses["/api/v1/admin/brickset-queue"] = """{"success":true,"count":0,"entries":[]}"""
        val vm = vm()
        vm.retry("75192")
        runCurrent()
        assertEquals("t${R.string.monitoring_retry_queued}(75192)", channel.text)
    }
}
