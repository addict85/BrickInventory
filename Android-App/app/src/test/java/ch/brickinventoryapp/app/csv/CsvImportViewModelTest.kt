package ch.brickinventoryapp.app.csv

import ch.brickinventoryapp.model.ui.laeuft
import ch.brickinventoryapp.model.domain.Laufstatus
import ch.brickinventoryapp.data.CsvImportObserver
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.CsvImportSseClient
import ch.brickinventoryapp.data.CsvImportStream
import ch.brickinventoryapp.contract.CsvImportStatus
import ch.brickinventoryapp.model.domain.CsvImportStatusView
import ch.brickinventoryapp.contract.GenericAdminResponse
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.services.service.CsvImportDienst
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
import ch.brickinventoryapp.testing.TestDienste
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
 *   csv-ohne-nachladen  NACHLADEN without `sync.bestand()` → red “a running import …”
 *   csv-rueckzug-fest   the delay no longer grows → red “a broken stream …”
 *   csv-abbruch-still   cancelCsvImport() does not report an error → red “the cancellation reports …”
 *   csv-folgt-doppelt   folge() without the lock `folgt` → red “a running import …”
 *                       (two connections, service started twice)
 *   csv-abmelden-laesst-dienst  no dienst.stop() on sign-out → red “after sign-out …”
 */
@OptIn(ExperimentalCoroutinesApi::class)
class CsvImportViewModelTest {

    private val takt = StandardTestDispatcher()
    private val fake = FakeApi()
    private lateinit var t: TestDienste

    /** One sequence of events per connection; afterwards the connection stays open. */
    private class Strom(vararg folgen: List<CsvImportSseClient.Event>) : CsvImportStream {
        private val rest = ArrayDeque(folgen.toList())
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

    private class Dienst : CsvImportDienst {
        var starts = 0
        var stops = 0
        override fun start() { starts++ }
        override fun stop() { stops++ }
    }

    @Before fun auf() {
        Dispatchers.setMain(takt)
        t = TestDienste(fake.api, io = takt)
    }

    @After fun ab() {
        Dispatchers.resetMain()
    }

    private fun status(s: String, done: Int = 0) =
        CsvImportSseClient.Event.Status(CsvImportStatusView(status = Laufstatus.aus(s), total = 3, done = done))

    private lateinit var coordinator: CsvImportCoordinator

    /** Signed in, as after the app's start; the ViewModel follows the import by itself. */
    private fun withVm(strom: Strom, dienst: Dienst, block: suspend TestScope.(CsvImportViewModel) -> Unit) = runTest(takt) {
        strom.clock = { testScheduler.currentTime }
        val observer = CsvImportObserver(strom, testSetFilesRepository(fake.api))
        coordinator = CsvImportCoordinator(observer, dienst, t.sync)
        t.sitzung.angemeldet(admin = false)
        val vm = CsvImportViewModel(coordinator, observer, NumbersTexts, t.meldungen, t.sitzung)
        try {
            block(vm)
        } finally {
            vm.viewModelScope.cancel()
        }
    }

    @Test
    fun `a running import starts the service once, finished reloads and clears after five seconds`() {
        val dienst = Dienst()
        val strom = Strom(listOf(status("running", 1), status("running", 2), status("done", 3)))
        withVm(strom, dienst) { vm ->
            val vorher = fake.callsOf("getSets")
            // A second follower (say a second ViewModel) opens no second connection.
            val zweiter = backgroundScope.launch { coordinator.sequence(t.sitzung.state.map { it.isLoggedIn }) }
            runCurrent()
            assertEquals("Mehrfach gestartet: eine Verbindung", 1, strom.connections.size)
            zweiter.cancel()
            assertEquals("Der Dienst startet beim Anlaufen, nicht je Zeile", 1, dienst.starts)
            assertEquals(3, vm.csvImportState.value.done)
            assertFalse(vm.csvImportState.value.lauf.laeuft)

            advanceTimeBy(4_999)
            assertEquals("Der Balken steht noch", 3, vm.csvImportState.value.done)
            assertEquals(0, dienst.stops)
            advanceTimeBy(2)
            assertEquals(0, vm.csvImportState.value.done)
            assertEquals(1, dienst.stops)
            assertTrue("Nach dem Import holt die Ablage den Bestand", fake.callsOf("getSets") > vorher)
        }
    }

    @Test
    fun `a broken stream asks once and reconnects with growing delay`() {
        val dienst = Dienst()
        val fehler = listOf(CsvImportSseClient.Event.Failed("weg"))
        val strom = Strom(fehler, fehler, fehler)
        withVm(strom, dienst) { vm ->
            fake.antworten["getCsvImportStatus"] = CsvImportStatus(success = true, status = Laufstatus.LAEUFT, total = 5, done = 2)
            runCurrent()
            assertEquals("Nach dem Abriss eine Abfrage", 1, fake.callsOf("getCsvImportStatus"))
            assertEquals("Die Abfrage füllt den Balken", 2, vm.csvImportState.value.done)
            assertTrue(vm.csvImportState.value.lauf.laeuft)
            assertEquals(1, dienst.starts)

            advanceTimeBy(60_000)
            assertEquals("5 s, dann 10 s, dann 20 s", listOf(0L, 5_000L, 15_000L, 35_000L), strom.connections)
        }
    }

    @Test
    fun `after sign-out the bar is empty, the connection closed and the service stopped`() {
        val strom = Strom(listOf(status("running", 1)))
        val dienst = Dienst()
        withVm(strom, dienst) { vm ->
            runCurrent()
            assertTrue(vm.csvImportState.value.lauf.laeuft)
            assertEquals(1, dienst.starts)
            val vorher = strom.connections.size
            t.sitzung.abgemeldet()
            advanceUntilIdle()
            assertFalse(vm.csvImportState.value.lauf.laeuft)
            assertEquals(0, vm.csvImportState.value.done)
            assertEquals("Der Dienst läuft nicht für das abgemeldete Konto weiter", 1, dienst.stops)
            advanceTimeBy(120_000)
            assertEquals("Abgemeldet verbindet niemand neu", vorher, strom.connections.size)
        }
    }

    @Test
    fun `without sign-in nobody connects, the sign-in starts the stream`() = runTest(takt) {
        val strom = Strom(listOf(status("running", 1)))
        strom.clock = { testScheduler.currentTime }
        val observer = CsvImportObserver(strom, testSetFilesRepository(fake.api))
        val vm = CsvImportViewModel(CsvImportCoordinator(observer, Dienst(), t.sync), observer,
            NumbersTexts, t.meldungen, t.sitzung)
        try {
            advanceTimeBy(60_000)
            assertEquals("Abgemeldet öffnet das ViewModel keinen Strom", 0, strom.connections.size)
            t.sitzung.angemeldet(admin = false)
            runCurrent()
            assertEquals(1, strom.connections.size)
            assertTrue(vm.csvImportState.value.lauf.laeuft)
        } finally {
            vm.viewModelScope.cancel()
        }
    }

    @Test
    fun `the cancellation reports success and error`() {
        withVm(Strom(), Dienst()) { vm ->
            vm.cancelCsvImport()
            advanceUntilIdle()
            assertEquals("Scheitert der Abbruch, sagt es die Meldung", "fehler", t.meldungen.text)
            t.meldungen.acknowledge()
            fake.antworten["cancelCsvImport"] = GenericAdminResponse(success = true)
            vm.cancelCsvImport()
            advanceUntilIdle()
            assertEquals("t${R.string.csv_cancel_requested}", t.meldungen.text)
        }
    }
}
