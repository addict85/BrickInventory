package ch.brickinventoryapp.finances.ui.pdf

import android.content.Context
import ch.brickinventoryapp.dataapi.instructions.INSTRUCTION_DISPLAY_FOLDER
import ch.brickinventoryapp.dataapi.instructions.InstructionFiles
import ch.brickinventoryapp.dataapi.instructions.InstructionRepository
import ch.brickinventoryapp.dataapi.instructions.pdfStore
import ch.brickinventoryapp.finances.ui.viewmodel.pdfWithOnceTicket
import ch.brickinventoryapp.finances.ui.viewmodel.showsVouchers
import ch.brickinventoryapp.model.coroutines.BrickDispatchers
import ch.brickinventoryapp.model.coroutines.Dispatcher
import ch.brickinventoryapp.model.util.catchUnlessCancelled
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import java.io.File
import javax.inject.Inject

/** Loads a PDF for the viewer; [open] gets the source before it comes back. */
internal interface PdfLoader {
    suspend fun load(pdfUrl: String, open: PdfHolder, onUiState: (PdfLoadState) -> Unit): Pair<PdfSource, Int>
}

@Module
@InstallIn(SingletonComponent::class)
internal interface PdfLoaderModule {
    @Binds fun loader(l: InstructionLoader): PdfLoader
    @Binds fun pages(s: PdfRendererPages): PdfPagesSource
}

/**
 * Download, storage and preparation of large instruction manuals, outside the composition:
 * a rotation rebuilds the screen, the download in the ViewModel keeps running.
 * Instruction manuals go onto disk streamed and encrypted ([InstructionFiles]),
 * vouchers only into memory.
 */
internal class InstructionLoader @Inject constructor(
    @param:ApplicationContext private val ctx: Context,
    /** The network lives in the data layer; here only storage, preparation and page count. */
    private val network: InstructionRepository,
    private val instructions: InstructionFiles,
    @param:Dispatcher(BrickDispatchers.IO) private val io: CoroutineDispatcher,
    /** Counts the pages in the isolated process (PdfRenderService), at the same time the readability test. */
    private val renderer: PdfRenderConnection,
) : PdfLoader {

    override suspend fun load(pdfUrl: String, open: PdfHolder, onUiState: (PdfLoadState) -> Unit): Pair<PdfSource, Int> {
        // A voucher PDF carries number and PIN: no file (store == null), only a
        // memory area that dies with the viewer.
        val confidential = showsVouchers(pdfUrl)
        val store = pdfStore(ctx.cacheDir, pdfUrl, confidential)
        return if (store == null) {
            loadIntoMemoryAndCount(pdfUrl, open, onUiState)
        } else {
            loadAndCount(pdfUrl, store, open, display = File(ctx.cacheDir, INSTRUCTION_DISPLAY_FOLDER), onUiState = onUiState)
        }
    }

    /**
     * Load and count pages — with one self-healing attempt: older versions
     * wrote directly under the finished name and could leave a truncated
     * file there. If opening fails, this instruction manual's cache
     * is discarded and reloaded once; a second failure goes through.
     */
    private suspend fun loadAndCount(
        url: String,
        cacheFile: File,
        open: PdfHolder,
        display: File,
        onUiState: (PdfLoadState) -> Unit,
    ): Pair<PdfSource, Int> {
        var attempt = 0
        while (true) {
            attempt++
            network.load(url, cacheFile, once = pdfWithOnceTicket(url)) { loaded, total ->
                val pct = if (total > 0) (loaded * 100 / total).toInt() else 0
                onUiState(PdfLoadState.Downloading(pct, loaded, if (total > 0) total else 0L))
            }
            onUiState(PdfLoadState.Rendering)
            catchUnlessCancelled {
                return withContext(io) {
                    val source = PdfArea.instruction(instructions, cacheFile, display)
                    if (!open.hold(source)) throw CancellationException("Betrachter verlassen")
                    source to renderer.pageCount(source)
                }
            }.onFailure { e ->
                if (attempt >= 2 || pdfWithOnceTicket(url)) throw e
                withContext(io) {
                    cacheFile.delete()
                    File(cacheFile.path + ".part").delete()
                }
                onUiState(PdfLoadState.Downloading(0, 0, 0))
            }
        }
    }

    /**
     * The path for confidential PDFs: entirely into memory ([InstructionRepository.loadInTheStorage]), without
     * a partial file and without resuming, then into a memfd ([PdfArea.memory]).
     */
    private suspend fun loadIntoMemoryAndCount(
        url: String,
        open: PdfHolder,
        onUiState: (PdfLoadState) -> Unit,
    ): Pair<PdfSource, Int> {
        val content = network.loadInTheStorage(url) { loaded, total ->
            val pct = if (total > 0) (loaded * 100 / total).toInt() else 0
            onUiState(PdfLoadState.Downloading(pct, loaded, if (total > 0) total else 0L))
        }
        onUiState(PdfLoadState.Rendering)
        return withContext(io) {
            val source = PdfArea.memory(content)
            if (!open.hold(source)) throw CancellationException("Betrachter verlassen")
            source to renderer.pageCount(source)
        }
    }
}
