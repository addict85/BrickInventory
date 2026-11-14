package ch.brickinventoryapp.app.csv

import ch.brickinventoryapp.model.fach.Laufstatus
import ch.brickinventoryapp.data.CsvImportBeobachter
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.CsvImportSseClient
import ch.brickinventoryapp.data.CsvImportStrom
import ch.brickinventoryapp.vertrag.CsvImportStatus
import ch.brickinventoryapp.vertrag.GenericAdminResponse
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.dienste.service.CsvImportDienst
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
import ch.brickinventoryapp.testing.NummernTexte
import ch.brickinventoryapp.testing.SetDateienRepository
import ch.brickinventoryapp.testing.TestDienste
import ch.brickinventoryapp.testing.text

/**
 * Der Balken des CSV-Imports ausgeführt, ViewModel samt Koordinator: Strom,
 * Vordergrund-Dienst und Ablage im Speicher, Api ohne Netz, Zeit virtuell. So sind
 * die fünf Sekunden „Balken bleibt stehen“ und der wachsende Abstand der
 * Wiederverbindung ohne Warten prüfbar. Das ViewModel startet den Strom selbst,
 * sobald die Sitzung angemeldet ist; kein Bildschirm stösst ihn an.
 *
 * Gegenproben:
 *   csv-zustand-zuerst  entschieden mit dem schon neuen Zustand → rot „ein laufender Import …“
 *   csv-ohne-nachladen  NACHLADEN ohne `abgleich.bestand()` → rot „ein laufender Import …“
 *   csv-rueckzug-fest   der Abstand wächst nicht mehr → rot „ein abgerissener Strom …“
 *   csv-abbruch-still   cancelCsvImport() meldet einen Fehler nicht → rot „der Abbruch meldet …“
 *   csv-folgt-doppelt   folge() ohne die Sperre `folgt` → rot „ein laufender Import …“
 *                       (zwei Verbindungen, Dienst zweimal gestartet)
 *   csv-abmelden-laesst-dienst  beim Abmelden kein dienst.stop() → rot „nach dem Abmelden …“
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
            // Wie CsvImportSseClient: Er endet nur mit Failed. Ein sauberes Ende hiesse
            // für den Beobachter „sofort neu verbinden“ und zählte eine Verbindung zu viel.
            if (folge.lastOrNull() !is CsvImportSseClient.Event.Failed) awaitCancellation()
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
        t.cacheDir.deleteRecursively()
    }

    private fun status(s: String, done: Int = 0) =
        CsvImportSseClient.Event.Status(CsvImportStatus(success = true, status = Laufstatus.aus(s), total = 3, done = done))

    private lateinit var koordinator: CsvImportKoordinator

    /** Angemeldet, wie nach dem Start der App; das ViewModel folgt dem Import von selbst. */
    private fun mitVm(strom: Strom, dienst: Dienst, block: suspend TestScope.(CsvImportViewModel) -> Unit) = runTest(takt) {
        strom.uhr = { testScheduler.currentTime }
        val beobachter = CsvImportBeobachter(strom, SetDateienRepository(fake.api))
        koordinator = CsvImportKoordinator(beobachter, dienst, t.abgleich)
        t.sitzung.angemeldet(admin = false)
        val vm = CsvImportViewModel(koordinator, beobachter, NummernTexte, t.meldungen, t.sitzung)
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
            val vorher = fake.aufrufeVon("getSets")
            // Ein zweiter Folger (etwa ein zweites ViewModel) öffnet keine zweite Verbindung.
            val zweiter = backgroundScope.launch { koordinator.folge(t.sitzung.state.map { it.isLoggedIn }) }
            runCurrent()
            assertEquals("Mehrfach gestartet: eine Verbindung", 1, strom.verbindungen.size)
            zweiter.cancel()
            assertEquals("Der Dienst startet beim Anlaufen, nicht je Zeile", 1, dienst.starts)
            assertEquals(3, vm.csvImportState.value.done)
            assertFalse(vm.csvImportState.value.running)

            advanceTimeBy(4_999)
            assertEquals("Der Balken steht noch", 3, vm.csvImportState.value.done)
            assertEquals(0, dienst.stops)
            advanceTimeBy(2)
            assertEquals(0, vm.csvImportState.value.done)
            assertEquals(1, dienst.stops)
            assertTrue("Nach dem Import holt die Ablage den Bestand", fake.aufrufeVon("getSets") > vorher)
        }
    }

    @Test
    fun `ein abgerissener Strom fragt einmal nach und verbindet mit wachsendem Abstand neu`() {
        val dienst = Dienst()
        val fehler = listOf(CsvImportSseClient.Event.Failed("weg"))
        val strom = Strom(fehler, fehler, fehler)
        mitVm(strom, dienst) { vm ->
            fake.antworten["getCsvImportStatus"] = CsvImportStatus(success = true, status = Laufstatus.LAEUFT, total = 5, done = 2)
            runCurrent()
            assertEquals("Nach dem Abriss eine Abfrage", 1, fake.aufrufeVon("getCsvImportStatus"))
            assertEquals("Die Abfrage füllt den Balken", 2, vm.csvImportState.value.done)
            assertTrue(vm.csvImportState.value.running)
            assertEquals(1, dienst.starts)

            advanceTimeBy(60_000)
            assertEquals("5 s, dann 10 s, dann 20 s", listOf(0L, 5_000L, 15_000L, 35_000L), strom.verbindungen)
        }
    }

    @Test
    fun `nach dem Abmelden ist der Balken leer, die Verbindung zu und der Dienst angehalten`() {
        val strom = Strom(listOf(status("running", 1)))
        val dienst = Dienst()
        mitVm(strom, dienst) { vm ->
            runCurrent()
            assertTrue(vm.csvImportState.value.running)
            assertEquals(1, dienst.starts)
            val vorher = strom.verbindungen.size
            t.sitzung.abgemeldet()
            advanceUntilIdle()
            assertFalse(vm.csvImportState.value.running)
            assertEquals(0, vm.csvImportState.value.done)
            assertEquals("Der Dienst läuft nicht für das abgemeldete Konto weiter", 1, dienst.stops)
            advanceTimeBy(120_000)
            assertEquals("Abgemeldet verbindet niemand neu", vorher, strom.verbindungen.size)
        }
    }

    @Test
    fun `ohne Anmeldung verbindet niemand, die Anmeldung startet den Strom`() = runTest(takt) {
        val strom = Strom(listOf(status("running", 1)))
        strom.uhr = { testScheduler.currentTime }
        val beobachter = CsvImportBeobachter(strom, SetDateienRepository(fake.api))
        val vm = CsvImportViewModel(CsvImportKoordinator(beobachter, Dienst(), t.abgleich), beobachter,
            NummernTexte, t.meldungen, t.sitzung)
        try {
            advanceTimeBy(60_000)
            assertEquals("Abgemeldet öffnet das ViewModel keinen Strom", 0, strom.verbindungen.size)
            t.sitzung.angemeldet(admin = false)
            runCurrent()
            assertEquals(1, strom.verbindungen.size)
            assertTrue(vm.csvImportState.value.running)
        } finally {
            vm.viewModelScope.cancel()
        }
    }

    @Test
    fun `der Abbruch meldet Erfolg und Fehler`() {
        mitVm(Strom(), Dienst()) { vm ->
            vm.cancelCsvImport()
            advanceUntilIdle()
            assertEquals("Scheitert der Abbruch, sagt es die Meldung", "fehler", t.meldungen.text)
            t.meldungen.quittiere()
            fake.antworten["cancelCsvImport"] = GenericAdminResponse(success = true)
            vm.cancelCsvImport()
            advanceUntilIdle()
            assertEquals("t${R.string.csv_cancel_requested}", t.meldungen.text)
        }
    }
}
