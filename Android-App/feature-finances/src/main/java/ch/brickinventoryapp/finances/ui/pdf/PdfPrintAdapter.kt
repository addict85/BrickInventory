package ch.brickinventoryapp.finances.ui.pdf

import android.os.Bundle
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.print.PageRange
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintDocumentAdapter.LayoutResultCallback
import android.print.PrintDocumentAdapter.WriteResultCallback
import android.print.PrintDocumentInfo
import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import java.io.FileOutputStream

/**
 * Prints a loaded PDF via the system. Android calls onWrite on the main thread;
 * copying therefore happens via [schreiber] into [bereich], and a cancel in the
 * print dialog stops the copying instead of still writing the whole file.
 */
internal class PdfPrintAdapter(
    private val quelle: PdfQuelle,
    private val name: String,
    private val schreiber: PdfSchreiber,
    private val bereich: CoroutineScope,
) : PrintDocumentAdapter() {

    override fun onLayout(
        oldAttributes: PrintAttributes?,
        newAttributes: PrintAttributes?,
        cancellationSignal: CancellationSignal?,
        callback: LayoutResultCallback?,
        extras: Bundle?,
    ) {
        if (cancellationSignal?.isCanceled == true) {
            callback?.onLayoutCancelled()
            return
        }
        val info = PrintDocumentInfo.Builder("$name.pdf")
            .setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
            .build()
        callback?.onLayoutFinished(info, oldAttributes != newAttributes)
    }

    override fun onWrite(
        pages: Array<out PageRange>?,
        destination: ParcelFileDescriptor,
        cancellationSignal: CancellationSignal?,
        callback: WriteResultCallback?,
    ) {
        val job = bereich.launch {
            fangeAusserAbbruch {
                FileOutputStream(destination.fileDescriptor).use { schreiber.schreibe(quelle, it) }
            }.onSuccess { callback?.onWriteFinished(arrayOf(PageRange.ALL_PAGES)) }
                .onFailure { e -> callback?.onWriteFailed(e.message) }
        }
        job.invokeOnCompletion { grund -> if (grund is CancellationException) callback?.onWriteCancelled() }
        cancellationSignal?.setOnCancelListener { job.cancel() }
    }
}
