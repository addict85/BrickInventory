package ch.brickinventoryapp.app.csv

import ch.brickinventoryapp.model.ui.running
import ch.brickinventoryapp.model.domain.RunStatus
import ch.brickinventoryapp.data.CsvImportObserver
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.CsvImportSseClient
import ch.brickinventoryapp.data.CsvImportStream
import ch.brickinventoryapp.contract.CsvImportStatus
import ch.brickinventoryapp.model.domain.CsvImportStatusView
import ch.brickinventoryapp.contract.GenericAdminResponse
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.services.service.CsvImportRunner
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import ch.brickinventoryapp.testing.FakeApi
import ch.brickinventoryapp.testing.NumbersTexts
import ch.brickinventoryapp.testing.testSetFilesRepository
import ch.brickinventoryapp.testing.TestServices
import ch.brickinventoryapp.testing.text

/**
 * The CSV import bar executed, ViewModel including coordinator: stream,
 * foreground service and store in memory, API without network, time virtual. That way
 * the five seconds „bar stays“ and the growing delay of the
 * reconnection can be checked without waiting. The ViewModel starts the stream itself
 * as soon as the session is signed in; no screen triggers it.
 *
 * Counter-checks:
 *   csv-zustand-zuerst  decided with the already new state → red “a running import …”
 *   csv-ohne-nachladen  NACHLADEN without `sync.stock()` → red “a running import …”
 *   csv-rueckzug-fest   the delay no longer grows → red “a broken stream …”
 *   csv-abbruch-still   cancelCsvImport() does not report an error → red “the cancellation reports …”
 *   csv-folgt-doppelt   folge() without the lock `follows` → red “a running import …”
 *                       (two connections, service started twice)
 *   csv-abmelden-laesst-dienst  no dienst.stop() on sign-out → red “after sign-out …”
 */
@OptIn(ExperimentalCoroutinesApi::class)
class CsvImportViewModelTest {

    private val tick = StandardTestDispatcher()
    private val fake = FakeApi()
    private lateinit var t: TestServices

    /** One sequence of events per connection; afterwards the connection stays open. */
    private class Stream(vararg follow: List<CsvImportSseClient.Event>) : CsvImportStream {
        private val rest = ArrayDeque(follow.toList())
        val connections = mutableListOf<Long>()
        var clock: () -> Long = { 0L }
        override fun stream(): Flow<CsvImportSseClient.Event> = flow {
            connections += clock()
            val sequence = rest.removeFirstOrNull() ?: awaitCancellation()
            sequence.forEach { emit(it) }
            // Like CsvImportSseClient: it ends only with Failed. A clean end would mean
            // „reconnect immediately“ for the observer and count one connection too many.
            if (sequence.lastOrNull() !is CsvImportSseClient.Event.Failed) awaitCancellation()
        }
    }

    private class Service : CsvImportRunner {
        var starts = 0
        var stops = 0
        override fun start() { starts++ }
        override fun stop() { stops++ }
    }

    @Before fun setUp() {
        Dispatchers.setMain(tick)
        t = TestServices(fake.api, io = tick)
    }

    @After fun ab() {
        Dispatchers.resetMain()
    }

    private fun status(s: String, done: Int = 0) =
        CsvImportSseClient.Event.Status(CsvImportStatusView(status = RunStatus.from(s), total = 3, done = done))

    private lateinit var coordinator: CsvImportCoordinator

    /** Signed in, as after the app's start; the ViewModel follows the import by itself. */
    private fun withVm(stream: Stream, service: Service, block: suspend TestScope.(CsvImportViewModel) -> Unit) = runTest(tick) {
        stream.clock = { testScheduler.currentTime }
        val observer = CsvImportObserver(stream, testSetFilesRepository(fake.api))
        coordinator = CsvImportCoordinator(observer, service, t.sync)
        t.session.loggedIn(admin = false)
        val vm = CsvImportViewModel(coordinator, observer, NumbersTexts, t.messages, t.session)
        try {
            block(vm)
        } finally {
            vm.viewModelScope.cancel()
        }
    }

    @Test
    fun `a running import starts the service once, finished reloads and clears after five seconds`() {
        val service = Service()
        val stream = Stream(listOf(status("running", 1), status("running", 2), status("done", 3)))
        withVm(stream, service) { vm ->
            val before = fake.callsOf("getSets")
            // A second follower (say a second ViewModel) opens no second connection.
            val second = backgroundScope.launch { coordinator.sequence(t.session.state.map { it.isLoggedIn }) }
            runCurrent()
            assertEquals("Mehrfach gestartet: eine Verbindung", 1, stream.connections.size)
            second.cancel()
            assertEquals("Der Dienst startet beim Anlaufen, nicht je Zeile", 1, service.starts)
            assertEquals(3, vm.csvImportState.value.done)
            assertFalse(vm.csvImportState.value.jobRun.running)

            advanceTimeBy(4_999)
            assertEquals("Der Balken steht noch", 3, vm.csvImportState.value.done)
            assertEquals(0, service.stops)
            advanceTimeBy(2)
            assertEquals(0, vm.csvImportState.value.done)
            assertEquals(1, service.stops)
            assertTrue("Nach dem Import holt die Ablage den Bestand", fake.callsOf("getSets") > before)
        }
    }

    @Test
    fun `a broken stream asks once and reconnects with growing delay`() {
        val service = Service()
        val error = listOf(CsvImportSseClient.Event.Failed("weg"))
        val stream = Stream(error, error, error)
        withVm(stream, service) { vm ->
            fake.responses["getCsvImportStatus"] = CsvImportStatus(success = true, status = RunStatus.RUNNING, total = 5, done = 2)
            runCurrent()
            assertEquals("Nach dem Abriss eine Abfrage", 1, fake.callsOf("getCsvImportStatus"))
            assertEquals("Die Abfrage füllt den Balken", 2, vm.csvImportState.value.done)
            assertTrue(vm.csvImportState.value.jobRun.running)
            assertEquals(1, service.starts)

            advanceTimeBy(60_000)
            assertEquals("5 s, dann 10 s, dann 20 s", listOf(0L, 5_000L, 15_000L, 35_000L), stream.connections)
        }
    }

    @Test
    fun `after sign-out the bar is empty, the connection closed and the service stopped`() {
        val stream = Stream(listOf(status("running", 1)))
        val service = Service()
        withVm(stream, service) { vm ->
            runCurrent()
            assertTrue(vm.csvImportState.value.jobRun.running)
            assertEquals(1, service.starts)
            val before = stream.connections.size
            t.session.loggedOut()
            advanceUntilIdle()
            assertFalse(vm.csvImportState.value.jobRun.running)
            assertEquals(0, vm.csvImportState.value.done)
            assertEquals("Der Dienst läuft nicht für das abgemeldete Konto weiter", 1, service.stops)
            advanceTimeBy(120_000)
            assertEquals("Abgemeldet verbindet niemand neu", before, stream.connections.size)
        }
    }

    @Test
    fun `without sign-in nobody connects, the sign-in starts the stream`() = runTest(tick) {
        val stream = Stream(listOf(status("running", 1)))
        stream.clock = { testScheduler.currentTime }
        val observer = CsvImportObserver(stream, testSetFilesRepository(fake.api))
        val vm = CsvImportViewModel(CsvImportCoordinator(observer, Service(), t.sync), observer,
            NumbersTexts, t.messages, t.session)
        try {
            advanceTimeBy(60_000)
            assertEquals("Abgemeldet öffnet das ViewModel keinen Strom", 0, stream.connections.size)
            t.session.loggedIn(admin = false)
            runCurrent()
            assertEquals(1, stream.connections.size)
            assertTrue(vm.csvImportState.value.jobRun.running)
        } finally {
            vm.viewModelScope.cancel()
        }
    }

    @Test
    fun `the cancellation reports success and error`() {
        withVm(Stream(), Service()) { vm ->
            vm.cancelCsvImport()
            advanceUntilIdle()
            assertEquals("Scheitert der Abbruch, sagt es die Meldung", "fehler", t.messages.text)
            t.messages.acknowledge()
            fake.responses["cancelCsvImport"] = GenericAdminResponse(success = true)
            vm.cancelCsvImport()
            advanceUntilIdle()
            assertEquals("t${R.string.csv_cancel_requested}", t.messages.text)
        }
    }
}
