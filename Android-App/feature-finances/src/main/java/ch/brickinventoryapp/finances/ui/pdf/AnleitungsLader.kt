package ch.brickinventoryapp.finances.ui.pdf

import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import android.content.Context
import ch.brickinventoryapp.model.coroutines.BrickDispatchers
import ch.brickinventoryapp.model.coroutines.Dispatcher
import ch.brickinventoryapp.finances.ui.viewmodel.pdfWithOnceTicket
import ch.brickinventoryapp.finances.ui.viewmodel.showsVouchers
import ch.brickinventoryapp.data.util.INSTRUCTION_DISPLAY_FOLDER
import ch.brickinventoryapp.data.AnleitungsRepository
import ch.brickinventoryapp.data.util.InstructionStore
import ch.brickinventoryapp.data.util.pdfAblage
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

/** Loads a PDF for the viewer; [offen] gets the source before it comes back. */
interface PdfLoader {
    suspend fun lade(pdfUrl: String, offen: PdfHolder, onZustand: (PdfLoadState) -> Unit): Pair<PdfQuelle, Int>
}

@Module
@InstallIn(SingletonComponent::class)
internal interface PdfLoaderModule {
    @Binds fun lader(l: AnleitungsLader): PdfLoader
    @Binds fun pages(s: PdfRendererPages): PdfSeitenQuelle
}

/**
 * Download, storage and preparation of large instruction manuals, outside the composition:
 * a rotation rebuilds the screen, the download in the ViewModel keeps running.
 * Instruction manuals go onto disk streamed and encrypted ([InstructionStore]),
 * vouchers only into memory.
 */
internal class AnleitungsLader @Inject constructor(
    @param:ApplicationContext private val ctx: Context,
    /** The network lives in the data layer; here only storage, preparation and page count. */
    private val netz: AnleitungsRepository,
    private val anleitungen: InstructionStore,
    @param:Dispatcher(BrickDispatchers.IO) private val io: CoroutineDispatcher,
    /** Counts the pages in the isolated process (PdfRenderDienst), at the same time the readability test. */
    private val renderer: PdfRenderConnection,
) : PdfLoader {

    override suspend fun lade(pdfUrl: String, offen: PdfHolder, onZustand: (PdfLoadState) -> Unit): Pair<PdfQuelle, Int> {
        // A voucher PDF carries number and PIN: no file (ablage == null), only a
        // memory area that dies with the viewer.
        val vertraulich = showsVouchers(pdfUrl)
        val ablage = pdfAblage(ctx.cacheDir, pdfUrl, vertraulich)
        return if (ablage == null) {
            ladeInDenSpeicherUndZaehle(pdfUrl, offen, onZustand)
        } else {
            loadAndCount(pdfUrl, ablage, offen, anzeige = File(ctx.cacheDir, INSTRUCTION_DISPLAY_FOLDER), onZustand = onZustand)
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
        offen: PdfHolder,
        anzeige: File,
        onZustand: (PdfLoadState) -> Unit,
    ): Pair<PdfQuelle, Int> {
        var attempt = 0
        while (true) {
            attempt++
            netz.lade(url, cacheFile, einmalig = pdfWithOnceTicket(url)) { geladen, gesamt ->
                val pct = if (gesamt > 0) (geladen * 100 / gesamt).toInt() else 0
                onZustand(PdfLoadState.Downloading(pct, geladen, if (gesamt > 0) gesamt else 0L))
            }
            onZustand(PdfLoadState.Rendering)
            fangeAusserAbbruch {
                return withContext(io) {
                    val quelle = PdfArea.anleitung(anleitungen, cacheFile, anzeige)
                    if (!offen.hold(quelle)) throw CancellationException("Betrachter verlassen")
                    quelle to renderer.seitenzahl(quelle)
                }
            }.onFailure { e ->
                if (attempt >= 2 || pdfWithOnceTicket(url)) throw e
                withContext(io) {
                    cacheFile.delete()
                    File(cacheFile.path + ".part").delete()
                }
                onZustand(PdfLoadState.Downloading(0, 0, 0))
            }
        }
    }

    /**
     * The path for confidential PDFs: entirely into memory ([AnleitungsRepository.loadInTheStorage]), without
     * a partial file and without resuming, then into a memfd ([PdfArea.speicher]).
     */
    private suspend fun ladeInDenSpeicherUndZaehle(
        url: String,
        offen: PdfHolder,
        onZustand: (PdfLoadState) -> Unit,
    ): Pair<PdfQuelle, Int> {
        val inhalt = netz.loadInTheStorage(url) { geladen, gesamt ->
            val pct = if (gesamt > 0) (geladen * 100 / gesamt).toInt() else 0
            onZustand(PdfLoadState.Downloading(pct, geladen, if (gesamt > 0) gesamt else 0L))
        }
        onZustand(PdfLoadState.Rendering)
        return withContext(io) {
            val quelle = PdfArea.speicher(inhalt)
            if (!offen.hold(quelle)) throw CancellationException("Betrachter verlassen")
            quelle to renderer.seitenzahl(quelle)
        }
    }
}
