package ch.brickinventoryapp.data.util

import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.ByteArrayOutputStream
import ch.brickinventoryapp.data.DownloadFailed
import java.io.IOException

/** Upper limit of a PDF that may only lie in memory; a voucher export has a few hundred kB. */
internal const val PDF_STORAGE_MAX_BYTES: Long = 32L * 1024 * 1024

/**
 * Loads a confidential PDF (vouchers: number and PIN) completely into memory, without
 * a partial file: what never lay on disk does not stay behind after a crash either.
 * With an upper limit because a response without end would otherwise fill memory. Blocking:
 * call in the background.
 */
suspend fun ladePdfInDenSpeicher(
    client: OkHttpClient,
    url: String,
    grenze: Long = PDF_STORAGE_MAX_BYTES,
    fortschritt: (geladen: Long, gesamt: Long) -> Unit = { _, _ -> },
): ByteArray =
    client.newCall(Request.Builder().url(url).build()).execute().use { antwort ->
        if (!antwort.isSuccessful) throw DownloadFailed(antwort.code)
        val gesamt = antwort.body.contentLength()
        if (gesamt > grenze) throw IOException("PDF zu gross: $gesamt Bytes")
        val inhalt = ByteArrayOutputStream(if (gesamt > 0) gesamt.toInt() else 64 * 1024)
        antwort.body.byteStream().use { ein ->
            val stueck = ByteArray(64 * 1024)
            while (true) {
                // Leaving cancels instead of fetching a PIN further into memory.
                currentCoroutineContext().ensureActive()
                val n = ein.read(stueck)
                if (n < 0) break
                if (inhalt.size() + n > grenze) throw IOException("PDF zu gross: über $grenze Bytes")
                inhalt.write(stueck, 0, n)
                fortschritt(inhalt.size().toLong(), gesamt)
            }
        }
        inhalt.toByteArray()
    }
