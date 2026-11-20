package ch.brickinventoryapp.finances

import android.os.ParcelFileDescriptor
import ch.brickinventoryapp.data.DownloadFailed
import ch.brickinventoryapp.model.ui.Fehlerklasse
import ch.brickinventoryapp.finances.ui.pdf.PdfError
import ch.brickinventoryapp.finances.ui.pdf.PdfHolder
import ch.brickinventoryapp.finances.ui.pdf.PdfLoader
import ch.brickinventoryapp.finances.ui.pdf.PdfLoadState
import ch.brickinventoryapp.finances.ui.pdf.PdfQuelle
import ch.brickinventoryapp.finances.ui.pdf.PdfSeitenQuelle
import ch.brickinventoryapp.finances.ui.viewmodel.PdfBetrachterViewModel
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.IOException
import java.io.InputStream
import java.net.UnknownHostException

/**
 * Der PDF-Betrachter lädt im ViewModel, nicht in der Komposition: Eine Drehung ruft
 * oeffne() erneut, der Download läuft weiter und beginnt nicht von vorn. Mit
 * StandardTestDispatcher und advanceUntilIdle, ohne Netz und ohne Warten.
 *
 * Gegenproben:
 *   A  in oeffne() die Abfrage `pdfUrl == adresse` entfernt
 *      (gegenproben/pdf-drehung-laedt-neu.patch) → rot „eine Drehung laedt nicht neu“
 *   B  den Fortschritt nicht weitergereicht (`{ }` statt `{ _state.value = it }`) →
 *      rot „der Fortschritt kommt im Zustand an …“
 *   C  die Prüfung pdfInViewer() entfernt → rot „eine fremde Adresse wird nicht geladen …“
 *   D  in PdfHolder.halte() die Abfrage `if (zu)` entfernt → rot „eine Quelle, die nach
 *      dem Verlassen ankommt, wird sofort geschlossen“
 *   E  gegenproben/pdf-seite-am-renderer-vorbei.patch → rot „eine Seite
 *      rendert der Lader …“
 *   F  gegenproben/pdf-fehler-ohne-klasse.patch: der Fehler ohne Klasse (nur der rohe
 *      Text) → rot „ein Fehler traegt seine Klasse …“
 *   G  gegenproben/pdf-erneut-tot.patch: erneut() lädt nicht → rot „nach einem Fehler
 *      laedt Erneut versuchen …“
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PdfViewerViewModelTest {

    private val takt = StandardTestDispatcher()

    @Before
    fun an() = Dispatchers.setMain(takt)

    @After
    fun aus() = Dispatchers.resetMain()

    private class Quelle : PdfQuelle {
        var zu = false
        override fun oeffne(): ParcelFileDescriptor = error("Im Test wird nicht gerendert")
        override fun inbox(): InputStream = "%PDF".byteInputStream()
        override fun close() { zu = true }
    }

    /** Lädt nach Vorgabe: meldet [fortschritt], wartet auf [brake], liefert oder wirft. */
    private class Lader(
        val fortschritt: PdfLoadState? = null,
        val brake: CompletableDeferred<Unit>? = null,
        var fehler: Exception? = null,
    ) : PdfLoader {
        val adressen = mutableListOf<String>()
        val quelle = Quelle()
        override suspend fun lade(pdfUrl: String, offen: PdfHolder, onZustand: (PdfLoadState) -> Unit): Pair<PdfQuelle, Int> {
            adressen += pdfUrl
            fortschritt?.let(onZustand)
            brake?.await()
            fehler?.let { throw it }
            offen.hold(quelle)
            return quelle to 12
        }
    }

    /** Der Renderer als Attrappe: Gerendert wird im isolierten Prozess, hier nur gezählt. */
    private val gerendert = mutableListOf<Int>()
    private val seitenquelle = PdfSeitenQuelle { _, index, _ -> gerendert += index; null }

    private fun vm(lader: Lader) = PdfBetrachterViewModel(lader, seitenquelle, takt)

    @Test
    fun `eine Seite rendert die Seitenquelle im eigenen Prozess, nicht das ViewModel`() = runTest(takt) {
        val lader = Lader()
        val vm = vm(lader)
        vm.oeffne(INSTRUCTION, SERVER)
        advanceUntilIdle()
        vm.pages.seite(lader.quelle, 3, 1080)
        assertEquals(listOf(3), gerendert)
    }

    @Test
    fun `eine Drehung laedt nicht neu`() = runTest(takt) {
        val lader = Lader()
        val vm = vm(lader)
        vm.oeffne(INSTRUCTION, SERVER)
        // Die neue Komposition nach der Drehung ruft oeffne() noch einmal, mitten im Laden.
        vm.oeffne(INSTRUCTION, SERVER)
        advanceUntilIdle()
        vm.oeffne(INSTRUCTION, SERVER)
        advanceUntilIdle()
        assertEquals(listOf(INSTRUCTION), lader.adressen)
        assertEquals(PdfLoadState.Ready(lader.quelle, 12), vm.state.value)
    }

    @Test
    fun `der Fortschritt kommt im Zustand an, bis das PDF bereit ist`() = runTest(takt) {
        val brake = CompletableDeferred<Unit>()
        val lader = Lader(fortschritt = PdfLoadState.Downloading(40, 400, 1000), brake = brake)
        val vm = vm(lader)
        vm.oeffne(INSTRUCTION, SERVER)
        advanceUntilIdle()
        assertEquals(PdfLoadState.Downloading(40, 400, 1000), vm.state.value)
        brake.complete(Unit)
        advanceUntilIdle()
        assertEquals(PdfLoadState.Ready(lader.quelle, 12), vm.state.value)
    }

    @Test
    fun `eine fremde Adresse wird nicht geladen, mit der Adresse des Servers schon`() = runTest(takt) {
        val lader = Lader()
        val vm = vm(lader)
        vm.oeffne("https://fremd.example/anleitung.pdf", SERVER)
        advanceUntilIdle()
        assertEquals(PdfLoadState.Error(null, PdfError.FREMDER_HOST), vm.state.value)
        assertEquals(emptyList<String>(), lader.adressen)
        // Kam die Serveradresse erst nach dem ersten Bild, gilt der zweite Aufruf.
        val spaet = vm(lader)
        spaet.oeffne(INSTRUCTION, "")
        spaet.oeffne(INSTRUCTION, SERVER)
        advanceUntilIdle()
        assertEquals(listOf(INSTRUCTION), lader.adressen)
        assertTrue(spaet.state.value is PdfLoadState.Ready)
    }

    @Test
    fun `ein Fehler traegt seine Klasse und die Ursache als Zusatz, ohne Ursache heisst er Download gescheitert`() =
        runTest(takt) {
            val server = vm(Lader(fehler = DownloadFailed(503)))
            server.oeffne(INSTRUCTION, SERVER)
            val netz = vm(Lader(fehler = UnknownHostException("brick.example")))
            netz.oeffne(INSTRUCTION, SERVER)
            val abgelaufen = vm(Lader(fehler = DownloadFailed(401)))
            abgelaufen.oeffne(INSTRUCTION, SERVER)
            val anderes = vm(Lader(fehler = IOException("PDF zu gross")))
            anderes.oeffne(INSTRUCTION, SERVER)
            val ohne = vm(Lader(fehler = DownloadFailed()))
            ohne.oeffne(INSTRUCTION, SERVER)
            advanceUntilIdle()
            assertEquals(PdfLoadState.Error("HTTP 503", klasse = Fehlerklasse.SERVER), server.state.value)
            assertEquals(PdfLoadState.Error("brick.example", klasse = Fehlerklasse.OFFLINE), netz.state.value)
            assertEquals(PdfLoadState.Error("HTTP 401", klasse = Fehlerklasse.LOGIN), abgelaufen.state.value)
            assertEquals(PdfLoadState.Error("PDF zu gross", klasse = Fehlerklasse.UNBEKANNT), anderes.state.value)
            assertEquals(PdfLoadState.Error(null, PdfError.DOWNLOAD), ohne.state.value)
        }

    @Test
    fun `nach einem Fehler laedt Erneut versuchen dieselbe Adresse noch einmal`() = runTest(takt) {
        val lader = Lader(fehler = DownloadFailed(503))
        val vm = vm(lader)
        vm.oeffne(INSTRUCTION, SERVER)
        advanceUntilIdle()
        assertTrue(vm.state.value is PdfLoadState.Error)
        // Dieselbe Adresse über oeffne() lädt nicht neu (Drehung); nur der Knopf tut es.
        vm.oeffne(INSTRUCTION, SERVER)
        advanceUntilIdle()
        assertEquals(listOf(INSTRUCTION), lader.adressen)
        lader.fehler = null
        vm.erneut()
        advanceUntilIdle()
        assertEquals(listOf(INSTRUCTION, INSTRUCTION), lader.adressen)
        assertEquals(PdfLoadState.Ready(lader.quelle, 12), vm.state.value)
        // Bereit lädt der Knopf nichts mehr: Er steht nur im Fehlerzustand.
        vm.erneut()
        advanceUntilIdle()
        assertEquals(2, lader.adressen.size)
    }

    @Test
    fun `eine Quelle, die nach dem Verlassen ankommt, wird sofort geschlossen`() {
        val holder = PdfHolder()
        val erste = Quelle()
        assertTrue(holder.hold(erste))
        assertFalse("Gehalten heisst offen", erste.zu)
        holder.close()
        assertTrue("Das Verlassen schliesst die gehaltene Quelle", erste.zu)
        val late = Quelle()
        assertFalse(holder.hold(late))
        assertTrue("Eine späte Quelle lebte sonst bis zum Prozessende", late.zu)
    }

    private companion object {
        const val SERVER = "https://brick.example"
        const val INSTRUCTION = "https://brick.example/api/v1/instructions/42/file"
    }
}
