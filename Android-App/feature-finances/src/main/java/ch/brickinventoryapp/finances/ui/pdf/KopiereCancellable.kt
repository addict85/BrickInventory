package ch.brickinventoryapp.finances.ui.pdf

import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import java.io.InputStream
import java.io.OutputStream

/** Writes a loaded PDF to a destination, off the main thread (PdfViewerViewModel). */
internal fun interface PdfWriter {
    suspend fun write(source: PdfSource, target: OutputStream)
}

/**
 * Copies in chunks and checks before each one whether the job is still valid. An instruction manual
 * can be up to 300 MB; if the print dialog is cancelled, the rest should not still be copied.
 */
internal suspend fun copyCancellable(one: InputStream, from: OutputStream, piece: Int = 64 * 1024): Long {
    val buffer = ByteArray(piece)
    var total = 0L
    while (true) {
        currentCoroutineContext().ensureActive()
        val n = one.read(buffer)
        if (n < 0) return total
        from.write(buffer, 0, n)
        total += n
    }
}
