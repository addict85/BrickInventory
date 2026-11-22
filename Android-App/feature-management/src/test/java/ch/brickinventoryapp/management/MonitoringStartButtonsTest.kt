package ch.brickinventoryapp.management

import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.testing.PfadServer
import ch.brickinventoryapp.testing.testAccountRepository
import ch.brickinventoryapp.testing.testManagementRepository
import ch.brickinventoryapp.testing.text
import ch.brickinventoryapp.management.ui.viewmodel.Jobstart
import ch.brickinventoryapp.management.ui.viewmodel.MonitoringViewModel
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
import org.junit.Test

/**
 * The start buttons and the queue run in the ViewModel: the screen only calls
 * `starte(job)`, state and message come from the ViewModel, resetting after
 * four seconds happens on the test clock.
 *
 * Counter-checks (patches under gegenproben/):
 *   startknopf-bleibt-gestartet      resetting after STARTED_MS removed → red “a start button shows …”
 *   startknopf-fehlschlag-still      failure without a message → red “a failed start reports …”
 *   warteschlange-fehler-verschluckt queue error treated as an empty list → red “a failed queue …”
 */
@OptIn(ExperimentalCoroutinesApi::class)
class MonitoringStartButtonsTest {

    private val paths = PfadServer(
        "/api/v1/admin/trigger-price-job" to """{"success":true}""",
        "/api/v1/admin/reimport-instructions" to """{"success":true,"enqueued":3}""",
    )
    private val kanal = MeldungsKanal()

    private fun TestScope.vm(): MonitoringViewModel {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        val api = paths.imTakt()
        return MonitoringViewModel(testManagementRepository(api), testAccountRepository(api), kanal)
    }

    @After
    fun zu() {
        Dispatchers.resetMain()
        paths.server.shutdown()
    }

    @Test
    fun `a start button shows starting, then started, after four seconds its label again`() = runTest {
        val vm = vm()
        vm.starte(Jobstart.PREISLAUF)
        assertEquals(Meldung.Resource(R.string.monitoring_starting), vm.state.value.buttons[Jobstart.PREISLAUF])
        runCurrent()
        assertEquals(Meldung.Resource(R.string.monitoring_started), vm.state.value.buttons[Jobstart.PREISLAUF])
        vm.starte(Jobstart.PREISLAUF)
        runCurrent()
        assertEquals("Ein zweiter Tipp startet nicht noch einmal", 1, paths.requestsAn("trigger-price-job").size)
        advanceTimeBy(4_001)
        assertEquals(emptyMap<Jobstart, Meldung>(), vm.state.value.buttons)
    }

    @Test
    fun `the instructions name the number of queued sets`() = runTest {
        val vm = vm()
        vm.starte(Jobstart.INSTRUCTIONS)
        runCurrent()
        assertEquals(Meldung.Menge(R.plurals.monitoring_reimport_enqueued, 3), vm.state.value.buttons[Jobstart.INSTRUCTIONS])
    }

    @Test
    fun `a failed start reports and releases the button`() = runTest {
        paths.codes["/api/v1/admin/catalog-images"] = 500
        val vm = vm()
        vm.starte(Jobstart.KATALOGBILDER)
        runCurrent()
        assertEquals("t${R.string.monitoring_start_error}", kanal.text)
        assertEquals(emptyMap<Jobstart, Meldung>(), vm.state.value.buttons)
    }

    @Test
    fun `a failed queue shows the error instead of an empty list`() = runTest {
        paths.codes["/api/v1/admin/brickset-queue"] = 500
        val vm = vm()
        vm.showQueue()
        runCurrent()
        assert(vm.state.value.queue is Laden.Fehler) { "Steht: ${vm.state.value.queue}" }
    }

    @Test
    fun `retrying reports the set number`() = runTest {
        paths.antworten["/api/v1/admin/brickset-queue/75192/retry"] = """{"success":true}"""
        paths.antworten["/api/v1/admin/brickset-queue"] = """{"success":true,"count":0,"entries":[]}"""
        val vm = vm()
        vm.wiederhole("75192")
        runCurrent()
        assertEquals("t${R.string.monitoring_retry_queued}(75192)", kanal.text)
    }
}
