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
suspend fun loadPdfIntoMemory(
    client: OkHttpClient,
    url: String,
    limit: Long = PDF_STORAGE_MAX_BYTES,
    progress: (loaded: Long, total: Long) -> Unit = { _, _ -> },
): ByteArray =
    client.newCall(Request.Builder().url(url).build()).execute().use { response ->
        if (!response.isSuccessful) throw DownloadFailed(response.code)
        val total = response.body.contentLength()
        if (total > limit) throw IOException("PDF zu gross: $total Bytes")
        val content = ByteArrayOutputStream(if (total > 0) total.toInt() else 64 * 1024)
        response.body.byteStream().use { one ->
            val piece = ByteArray(64 * 1024)
            while (true) {
                // Leaving cancels instead of fetching a PIN further into memory.
                currentCoroutineContext().ensureActive()
                val n = one.read(piece)
                if (n < 0) break
                if (content.size() + n > limit) throw IOException("PDF zu gross: über $limit Bytes")
                content.write(piece, 0, n)
                progress(content.size().toLong(), total)
            }
        }
        content.toByteArray()
    }
