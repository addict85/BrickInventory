package ch.brickinventoryapp.finanzen.ui.pdf

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
 * Druckt eine geladene PDF über das System. Android ruft onWrite auf dem Hauptfaden;
 * kopiert wird darum über [schreiber] in [bereich], und ein Abbruch im Druckdialog
 * beendet das Kopieren, statt die ganze Datei noch zu schreiben.
 */
class PdfDruckAdapter(
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
        val auftrag = bereich.launch {
            fangeAusserAbbruch {
                FileOutputStream(destination.fileDescriptor).use { schreiber.schreibe(quelle, it) }
            }.onSuccess { callback?.onWriteFinished(arrayOf(PageRange.ALL_PAGES)) }
                .onFailure { e -> callback?.onWriteFailed(e.message) }
        }
        auftrag.invokeOnCompletion { grund -> if (grund is CancellationException) callback?.onWriteCancelled() }
        cancellationSignal?.setOnCancelListener { auftrag.cancel() }
    }
}
