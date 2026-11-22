package ch.brickinventoryapp.finances

import android.os.ParcelFileDescriptor
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import ch.brickinventoryapp.data.DownloadFailed
import ch.brickinventoryapp.finances.ui.pdf.PdfError
import ch.brickinventoryapp.finances.ui.pdf.PdfHolder
import ch.brickinventoryapp.finances.ui.pdf.PdfLoadState
import ch.brickinventoryapp.finances.ui.pdf.PdfLoader
import ch.brickinventoryapp.finances.ui.pdf.PdfPagesSource
import ch.brickinventoryapp.finances.ui.pdf.PdfSource
import ch.brickinventoryapp.finances.ui.viewmodel.PdfViewerViewModel
import ch.brickinventoryapp.model.ui.ErrorClass
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
 * open() again, the download keeps running and does not start over. With
 * StandardTestDispatcher and advanceUntilIdle, without network and without waiting.
 *
 * Counter-checks:
 *   A  in open() the check `pdfUrl == address` removed
 *      (counter-checks/pdf-drehung-laedt-neu.patch) → red “a rotation does not reload”
 *   B  the progress not passed on (`{ }` instead of `{ _state.value = it }`) →
 *      red “the progress arrives in the state …”
 *   C  the check pdfInViewer() removed → red “a foreign address is not loaded …”
 *   D  in PdfHolder.halte() the check `if (too)` removed → red “a source that arrives
 *      after leaving is closed right away”
 *   E  counter-checks/pdf-seite-am-renderer-vorbei.patch → red “the loader
 *      renders a page …”
 *   F  counter-checks/pdf-fehler-ohne-klasse.patch: the error without a class (only the raw
 *      text) → red “an error carries its class …”
 *   G  counter-checks/pdf-erneut-tot.patch: again() does not load → red “after an error
 *      Erneut versuchen loads …”
 *   H  onCleared() without `open.close()` → red “leaving the viewer closes …”
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PdfViewerViewModelTest {

    private val tick = StandardTestDispatcher()

    @Before
    fun an() = Dispatchers.setMain(tick)

    @After
    fun from() = Dispatchers.resetMain()

    private class Source : PdfSource {
        var too = false
        override fun open(): ParcelFileDescriptor = error("nothing is rendered in the test")
        override fun inbox(): InputStream = "%PDF".byteInputStream()
        override fun close() { too = true }
    }

    /** Loads as configured: reports [progress], waits for [brake], delivers or throws. */
    private class Loader(
        val progress: PdfLoadState? = null,
        val brake: CompletableDeferred<Unit>? = null,
        var error: Exception? = null,
    ) : PdfLoader {
        val addresses = mutableListOf<String>()
        val source = Source()
        override suspend fun load(pdfUrl: String, open: PdfHolder, onUiState: (PdfLoadState) -> Unit): Pair<PdfSource, Int> {
            addresses += pdfUrl
            progress?.let(onUiState)
            brake?.await()
            error?.let { throw it }
            open.hold(source)
            return source to 12
        }
    }

    /** The renderer as a stub: rendering happens in the isolated process, here only counted. */
    private val rendered = mutableListOf<Int>()
    private val pageSource = PdfPagesSource { _, index, _ -> rendered += index; null }

    private fun vm(loader: Loader) = PdfViewerViewModel(loader, pageSource, tick)

    @Test
    fun `a page renders the page source in its own process, not the ViewModel`() = runTest(tick) {
        val loader = Loader()
        val vm = vm(loader)
        vm.open(INSTRUCTION, SERVER)
        advanceUntilIdle()
        vm.pages.page(loader.source, 3, 1080)
        assertEquals(listOf(3), rendered)
    }

    @Test
    fun `a rotation does not reload`() = runTest(tick) {
        val loader = Loader()
        val vm = vm(loader)
        vm.open(INSTRUCTION, SERVER)
        // The new composition after the rotation calls open() once more, in the middle of loading.
        vm.open(INSTRUCTION, SERVER)
        advanceUntilIdle()
        vm.open(INSTRUCTION, SERVER)
        advanceUntilIdle()
        assertEquals(listOf(INSTRUCTION), loader.addresses)
        assertEquals(PdfLoadState.Ready(loader.source, 12), vm.state.value)
    }

    @Test
    fun `the progress arrives in the state until the PDF is ready`() = runTest(tick) {
        val brake = CompletableDeferred<Unit>()
        val loader = Loader(progress = PdfLoadState.Downloading(40, 400, 1000), brake = brake)
        val vm = vm(loader)
        vm.open(INSTRUCTION, SERVER)
        advanceUntilIdle()
        assertEquals(PdfLoadState.Downloading(40, 400, 1000), vm.state.value)
        brake.complete(Unit)
        advanceUntilIdle()
        assertEquals(PdfLoadState.Ready(loader.source, 12), vm.state.value)
    }

    @Test
    fun `a foreign address is not loaded, the server's address is`() = runTest(tick) {
        val loader = Loader()
        val vm = vm(loader)
        vm.open("https://fremd.example/anleitung.pdf", SERVER)
        advanceUntilIdle()
        assertEquals(PdfLoadState.Error(null, PdfError.FOREIGN_HOST), vm.state.value)
        assertEquals(emptyList<String>(), loader.addresses)
        // If the server address only arrived after the first frame, the second call applies.
        val late = vm(loader)
        late.open(INSTRUCTION, "")
        late.open(INSTRUCTION, SERVER)
        advanceUntilIdle()
        assertEquals(listOf(INSTRUCTION), loader.addresses)
        assertTrue(late.state.value is PdfLoadState.Ready)
    }

    @Test
    fun `an error carries its class and the cause as addition, without a cause it is called download failed`() =
        runTest(tick) {
            val server = vm(Loader(error = DownloadFailed(503)))
            server.open(INSTRUCTION, SERVER)
            val network = vm(Loader(error = UnknownHostException("brick.example")))
            network.open(INSTRUCTION, SERVER)
            val expired = vm(Loader(error = DownloadFailed(401)))
            expired.open(INSTRUCTION, SERVER)
            val other = vm(Loader(error = IOException("PDF zu gross")))
            other.open(INSTRUCTION, SERVER)
            val without = vm(Loader(error = DownloadFailed()))
            without.open(INSTRUCTION, SERVER)
            advanceUntilIdle()
            assertEquals(PdfLoadState.Error("HTTP 503", kind = ErrorClass.SERVER), server.state.value)
            assertEquals(PdfLoadState.Error("brick.example", kind = ErrorClass.OFFLINE), network.state.value)
            assertEquals(PdfLoadState.Error("HTTP 401", kind = ErrorClass.LOGIN), expired.state.value)
            assertEquals(PdfLoadState.Error("PDF zu gross", kind = ErrorClass.UNKNOWN), other.state.value)
            assertEquals(PdfLoadState.Error(null, PdfError.DOWNLOAD), without.state.value)
        }

    @Test
    fun `after an error Retry loads the same address once more`() = runTest(tick) {
        val loader = Loader(error = DownloadFailed(503))
        val vm = vm(loader)
        vm.open(INSTRUCTION, SERVER)
        advanceUntilIdle()
        assertTrue(vm.state.value is PdfLoadState.Error)
        // The same address via open() does not reload (rotation); only the button does.
        vm.open(INSTRUCTION, SERVER)
        advanceUntilIdle()
        assertEquals(listOf(INSTRUCTION), loader.addresses)
        loader.error = null
        vm.again()
        advanceUntilIdle()
        assertEquals(listOf(INSTRUCTION, INSTRUCTION), loader.addresses)
        assertEquals(PdfLoadState.Ready(loader.source, 12), vm.state.value)
        // Ready, the button loads nothing anymore: it only appears in the error state.
        vm.again()
        advanceUntilIdle()
        assertEquals(2, loader.addresses.size)
    }

    /** A voucher PDF lies in a memory area; leaving the viewer must release it. */
    @Test
    fun `leaving the viewer closes the loaded source`() = runTest(tick) {
        val loader = Loader()
        val vm = vm(loader)
        val store = ViewModelStore()
        val factory = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T = vm as T
        }
        ViewModelProvider.create(store, factory)[PdfViewerViewModel::class]
        vm.open(INSTRUCTION, SERVER)
        advanceUntilIdle()
        assertFalse("loaded means open", loader.source.too)
        store.clear()
        assertTrue("the source stays open after leaving", loader.source.too)
    }

    @Test
    fun `a source that arrives after leaving is closed immediately`() {
        val holder = PdfHolder()
        val first = Source()
        assertTrue(holder.hold(first))
        assertFalse("held means open", first.too)
        holder.close()
        assertTrue("leaving closes the held source", first.too)
        val late = Source()
        assertFalse(holder.hold(late))
        assertTrue("a late source would otherwise live until the process ends", late.too)
    }

    private companion object {
        const val SERVER = "https://brick.example"
        const val INSTRUCTION = "https://brick.example/api/v1/instructions/42/file"
    }
}
