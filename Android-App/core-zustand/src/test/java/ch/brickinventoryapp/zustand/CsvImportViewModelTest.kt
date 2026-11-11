package ch.brickinventoryapp.zustand

import ch.brickinventoryapp.model.fach.Laufstatus
import ch.brickinventoryapp.data.CsvImportBeobachter
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.CsvImportSseClient
import ch.brickinventoryapp.data.CsvImportStrom
import ch.brickinventoryapp.data.Zugangsdaten
import ch.brickinventoryapp.model.data.model.CsvImportStatus
import ch.brickinventoryapp.model.data.model.GenericAdminResponse
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.dienste.service.CsvImportDienst
import ch.brickinventoryapp.zustand.ui.Aenderung
import ch.brickinventoryapp.zustand.ui.viewmodel.CsvImportViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
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
import ch.brickinventoryapp.testing.NummernTexte
import ch.brickinventoryapp.testing.SetsRepository
import ch.brickinventoryapp.testing.TestDienste

/**
 * Der Balken des CSV-Imports ausgeführt: Strom, Vordergrund-Dienst und Ablage im
 * Speicher, Api ohne Netz, Zeit virtuell. So sind die fünf Sekunden „Balken bleibt
 * stehen“ und der wachsende Abstand der Wiederverbindung ohne Warten prüfbar.
 *
 * Gegenproben:
 *   csv-zustand-zuerst  entschieden mit dem schon neuen Zustand → rot „ein laufender Import …“
 *   csv-ohne-nachladen  finishCsvImport() ohne `bestand.melde` → rot „ein laufender Import …“
 *   csv-rueckzug-fest   der Abstand wächst nicht mehr → rot „ein abgerissener Strom …“
 *   csv-abbruch-still   cancelCsvImport() meldet einen Fehler nicht → rot „der Abbruch meldet …“
 */
@OptIn(ExperimentalCoroutinesApi::class)
class CsvImportViewModelTest {

    private val takt = StandardTestDispatcher()
    private val fake = FakeApi()
    private lateinit var t: TestDienste

    /** Je Verbindung eine Folge von Ereignissen; danach bleibt die Verbindung offen. */
    private class Strom(vararg folgen: List<CsvImportSseClient.Event>) : CsvImportStrom {
        private val rest = ArrayDeque(folgen.toList())
        val verbindungen = mutableListOf<Long>()
        var uhr: () -> Long = { 0L }
        override fun stream(): Flow<CsvImportSseClient.Event> = flow {
            verbindungen += uhr()
            val folge = rest.removeFirstOrNull() ?: awaitCancellation()
            folge.forEach { emit(it) }
        }
    }

    private class Dienst : CsvImportDienst {
        var starts = 0
        var stops = 0
        override fun start() { starts++ }
        override fun stop() { stops++ }
    }

    private val zugang = object : Zugangsdaten {
        override suspend fun serverUrlJetzt() = "https://brick.example"
        override suspend fun tokenJetzt() = "token"
    }

    @Before fun auf() {
        Dispatchers.setMain(takt)
        t = TestDienste(fake.api, io = takt)
    }

    @After fun ab() {
        Dispatchers.resetMain()
        t.cacheDir.deleteRecursively()
    }

    private fun status(s: String, done: Int = 0) =
        CsvImportSseClient.Event.Status(CsvImportStatus(success = true, status = Laufstatus.aus(s), total = 3, done = done))

    private fun mitVm(strom: Strom, dienst: Dienst, block: suspend TestScope.(CsvImportViewModel) -> Unit) = runTest(takt) {
        strom.uhr = { testScheduler.currentTime }
        val vm = CsvImportViewModel(CsvImportBeobachter(strom, SetsRepository(fake.api, t.cache), zugang), dienst, NummernTexte,
            t.bestand, t.meldungen, t.sitzung)
        try {
            block(vm)
        } finally {
            vm.viewModelScope.cancel()
        }
    }

    @Test
    fun `ein laufender Import startet den Dienst einmal, fertig laedt nach und raeumt nach fuenf Sekunden ab`() {
        val dienst = Dienst()
        val strom = Strom(listOf(status("running", 1), status("running", 2), status("done", 3)))
        mitVm(strom, dienst) { vm ->
            val gemeldet = mutableListOf<Aenderung>()
            val sammler = backgroundScope.launch { t.bestand.aenderungen.collect { gemeldet += it } }
            runCurrent()
            vm.startCsvImportWatcher()
            vm.startCsvImportWatcher()
            runCurrent()
            assertEquals("Mehrfach gestartet: eine Verbindung", 1, strom.verbindungen.size)
            assertEquals("Der Dienst startet beim Anlaufen, nicht je Zeile", 1, dienst.starts)
            assertEquals(3, vm.csvImportState.value.done)
            assertFalse(vm.csvImportState.value.running)

            advanceTimeBy(4_999)
            assertEquals("Der Balken steht noch", 3, vm.csvImportState.value.done)
            assertEquals(0, dienst.stops)
            advanceTimeBy(2)
            assertEquals(0, vm.csvImportState.value.done)
            assertEquals(1, dienst.stops)
            assertTrue("Nach dem Import lädt die Galerie nach", Aenderung.Sets in gemeldet)
            sammler.cancel()
        }
    }

    @Test
    fun `ein abgerissener Strom fragt einmal nach und verbindet mit wachsendem Abstand neu`() {
        val dienst = Dienst()
        val fehler = listOf(CsvImportSseClient.Event.Failed("weg"))
        val strom = Strom(fehler, fehler, fehler)
        mitVm(strom, dienst) { vm ->
            fake.antworten["getCsvImportStatusDirect"] = CsvImportStatus(success = true, status = Laufstatus.LAEUFT, total = 5, done = 2)
            vm.startCsvImportWatcher()
            runCurrent()
            assertEquals("Nach dem Abriss eine Abfrage", 1, fake.aufrufeVon("getCsvImportStatusDirect"))
            assertEquals("Die Abfrage füllt den Balken", 2, vm.csvImportState.value.done)
            assertTrue(vm.csvImportState.value.running)
            assertEquals(1, dienst.starts)

            advanceTimeBy(60_000)
            assertEquals("5 s, dann 10 s, dann 20 s", listOf(0L, 5_000L, 15_000L, 35_000L), strom.verbindungen)
        }
    }

    @Test
    fun `nach dem Abmelden ist der Balken leer und die Verbindung zu`() {
        val strom = Strom(listOf(status("running", 1)))
        mitVm(strom, Dienst()) { vm ->
            vm.startCsvImportWatcher()
            runCurrent()
            assertTrue(vm.csvImportState.value.running)
            val vorher = strom.verbindungen.size
            t.sitzung.abgemeldet()
            advanceUntilIdle()
            assertFalse(vm.csvImportState.value.running)
            assertEquals(0, vm.csvImportState.value.done)
            advanceTimeBy(120_000)
            assertEquals("Abgemeldet verbindet niemand neu", vorher, strom.verbindungen.size)
        }
    }

    @Test
    fun `der Abbruch meldet Erfolg und Fehler`() {
        mitVm(Strom(), Dienst()) { vm ->
            vm.cancelCsvImport()
            advanceUntilIdle()
            assertEquals("Scheitert der Abbruch, sagt es die Meldung", "fehler", t.meldungen.meldung.value)
            t.meldungen.quittiere()
            fake.antworten["cancelCsvImport"] = GenericAdminResponse(success = true)
            vm.cancelCsvImport()
            advanceUntilIdle()
            assertEquals("t${R.string.csv_cancel_requested}", t.meldungen.meldung.value)
        }
    }
}
