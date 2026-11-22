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
 * The PDF viewer loads in the ViewModel, not in the composition: a rotation calls
 * oeffne() again, the download keeps running and does not start over. With
 * StandardTestDispatcher and advanceUntilIdle, without network and without waiting.
 *
 * Counter-checks:
 *   A  in oeffne() the check `pdfUrl == adresse` removed
 *      (gegenproben/pdf-drehung-laedt-neu.patch) → red “a rotation does not reload”
 *   B  the progress not passed on (`{ }` instead of `{ _state.value = it }`) →
 *      red “the progress arrives in the state …”
 *   C  the check pdfInViewer() removed → red “a foreign address is not loaded …”
 *   D  in PdfHolder.halte() the check `if (zu)` removed → red “a source that arrives
 *      after leaving is closed right away”
 *   E  gegenproben/pdf-seite-am-renderer-vorbei.patch → red “the loader
 *      renders a page …”
 *   F  gegenproben/pdf-fehler-ohne-klasse.patch: the error without a class (only the raw
 *      text) → red “an error carries its class …”
 *   G  gegenproben/pdf-erneut-tot.patch: erneut() does not load → red “after an error
 *      Erneut versuchen loads …”
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

    /** Loads as configured: reports [fortschritt], waits for [brake], delivers or throws. */
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

    /** The renderer as a stub: rendering happens in the isolated process, here only counted. */
    private val gerendert = mutableListOf<Int>()
    private val seitenquelle = PdfSeitenQuelle { _, index, _ -> gerendert += index; null }

    private fun vm(lader: Lader) = PdfBetrachterViewModel(lader, seitenquelle, takt)

    @Test
    fun `a page renders the page source in its own process, not the ViewModel`() = runTest(takt) {
        val lader = Lader()
        val vm = vm(lader)
        vm.oeffne(INSTRUCTION, SERVER)
        advanceUntilIdle()
        vm.pages.seite(lader.quelle, 3, 1080)
        assertEquals(listOf(3), gerendert)
    }

    @Test
    fun `a rotation does not reload`() = runTest(takt) {
        val lader = Lader()
        val vm = vm(lader)
        vm.oeffne(INSTRUCTION, SERVER)
        // The new composition after the rotation calls oeffne() once more, in the middle of loading.
        vm.oeffne(INSTRUCTION, SERVER)
        advanceUntilIdle()
        vm.oeffne(INSTRUCTION, SERVER)
        advanceUntilIdle()
        assertEquals(listOf(INSTRUCTION), lader.adressen)
        assertEquals(PdfLoadState.Ready(lader.quelle, 12), vm.state.value)
    }

    @Test
    fun `the progress arrives in the state until the PDF is ready`() = runTest(takt) {
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
    fun `a foreign address is not loaded, the server's address is`() = runTest(takt) {
        val lader = Lader()
        val vm = vm(lader)
        vm.oeffne("https://fremd.example/anleitung.pdf", SERVER)
        advanceUntilIdle()
        assertEquals(PdfLoadState.Error(null, PdfError.FREMDER_HOST), vm.state.value)
        assertEquals(emptyList<String>(), lader.adressen)
        // If the server address only arrived after the first frame, the second call applies.
        val spaet = vm(lader)
        spaet.oeffne(INSTRUCTION, "")
        spaet.oeffne(INSTRUCTION, SERVER)
        advanceUntilIdle()
        assertEquals(listOf(INSTRUCTION), lader.adressen)
        assertTrue(spaet.state.value is PdfLoadState.Ready)
    }

    @Test
    fun `an error carries its class and the cause as addition, without a cause it is called download failed`() =
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
    fun `after an error Retry loads the same address once more`() = runTest(takt) {
        val lader = Lader(fehler = DownloadFailed(503))
        val vm = vm(lader)
        vm.oeffne(INSTRUCTION, SERVER)
        advanceUntilIdle()
        assertTrue(vm.state.value is PdfLoadState.Error)
        // The same address via oeffne() does not reload (rotation); only the button does.
        vm.oeffne(INSTRUCTION, SERVER)
        advanceUntilIdle()
        assertEquals(listOf(INSTRUCTION), lader.adressen)
        lader.fehler = null
        vm.erneut()
        advanceUntilIdle()
        assertEquals(listOf(INSTRUCTION, INSTRUCTION), lader.adressen)
        assertEquals(PdfLoadState.Ready(lader.quelle, 12), vm.state.value)
        // Ready, the button loads nothing anymore: it only appears in the error state.
        vm.erneut()
        advanceUntilIdle()
        assertEquals(2, lader.adressen.size)
    }

    @Test
    fun `a source that arrives after leaving is closed immediately`() {
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
