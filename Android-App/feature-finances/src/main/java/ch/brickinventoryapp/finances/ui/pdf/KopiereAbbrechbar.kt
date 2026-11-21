package ch.brickinventoryapp.finances.ui.pdf

import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import java.io.InputStream
import java.io.OutputStream

/** Writes a loaded PDF to a destination, off the main thread (PdfBetrachterViewModel). */
fun interface PdfSchreiber {
    suspend fun schreibe(quelle: PdfQuelle, ziel: OutputStream)
}

/**
 * Copies in chunks and checks before each one whether the job is still valid. An instruction manual
 * can be up to 300 MB; if the print dialog is cancelled, the rest should not still be copied.
 */
internal suspend fun copyAbbrechbar(ein: InputStream, aus: OutputStream, stueck: Int = 64 * 1024): Long {
    val puffer = ByteArray(stueck)
    var gesamt = 0L
    while (true) {
        currentCoroutineContext().ensureActive()
        val n = ein.read(puffer)
        if (n < 0) return gesamt
        aus.write(puffer, 0, n)
        gesamt += n
    }
}
