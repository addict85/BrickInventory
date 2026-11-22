package ch.brickinventoryapp.data

import android.content.Context
import android.net.wifi.WifiManager
import ch.brickinventoryapp.data.di.ApiClient
import ch.brickinventoryapp.model.coroutines.BrickDispatchers
import ch.brickinventoryapp.model.coroutines.Dispatcher
import ch.brickinventoryapp.data.util.INSTRUCTION_EXTENSION
import ch.brickinventoryapp.data.util.INSTRUCTION_PREFIX
import ch.brickinventoryapp.data.util.InstructionStore
import ch.brickinventoryapp.data.util.PdfStep
import ch.brickinventoryapp.model.util.catchUnlessCancelled
import ch.brickinventoryapp.data.util.loadPdfIntoMemory
import ch.brickinventoryapp.data.util.pdfStep
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit
import javax.inject.Inject

/**
 * The download failed. [status]: the server answered, but not with the PDF; the
 * display then chooses the kind of error. Null means: no cause was left.
 */
class DownloadFailed(val status: Int? = null) : IOException(status?.let { "HTTP $it" })

/** The network of instructions and voucher PDFs; preparing and showing happens in the UI. */
interface InstructionRepository {
    /**
     * Loads [url] into [target], via a partial file and with resuming. [once]: the
     * address carries a ticket for exactly one fetch, so no second attempt.
     */
    suspend fun load(url: String, target: File, once: Boolean, progress: (loaded: Long, total: Long) -> Unit)

    /** A confidential PDF only into memory, without a partial file. */
    suspend fun loadInTheStorage(url: String, progress: (loaded: Long, total: Long) -> Unit): ByteArray
}

/**
 * Via the api client (token, cleartext ban, 401 message), with a Wi-Fi lock:
 * if the screen goes black, Android would otherwise put Wi-Fi to sleep.
 */
internal class InstructionDownload @Inject constructor(
    @param:ApplicationContext private val ctx: Context,
    @param:ApiClient private val httpClient: OkHttpClient,
    private val instructions: InstructionStore,
    @param:Dispatcher(BrickDispatchers.IO) private val io: CoroutineDispatcher,
) : InstructionRepository {

    override suspend fun load(url: String, target: File, once: Boolean, progress: (Long, Long) -> Unit) =
        withWifi {
            withContext(io) {
                target.parentFile?.mkdirs()
                prunePdfCache(ctx.cacheDir, keep = target)
                downloadPdfWithResume(url, target, loadClient(httpClient), once, progress)
            }
        }

    override suspend fun loadInTheStorage(url: String, progress: (Long, Long) -> Unit): ByteArray =
        withWifi { withContext(io) { loadPdfIntoMemory(loadClient(httpClient), url, progress = progress) } }

    private suspend fun <T> withWifi(block: suspend () -> T): T {
        @Suppress("DEPRECATION")
        val wifiLock = (ctx.getSystemService(Context.WIFI_SERVICE) as? WifiManager)
            ?.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "brickinv:pdf")
        try {
            catchUnlessCancelled { wifiLock?.acquire() }
            return block()
        } finally {
            catchUnlessCancelled { if (wifiLock?.isHeld == true) wifiLock.release() }
        }
    }

    /**
     * Robust download of large PDFs: an aborted download is resumed via Range at the
     * abort position, up to eight attempts. The running download writes to
     * `<name>.part`; only completion renames (util/PdfCache.kt).
     */
    private suspend fun downloadPdfWithResume(
        url: String,
        dest: File,
        client: OkHttpClient,
        once: Boolean,
        onProgress: (downloaded: Long, total: Long) -> Unit,
    ) {
        val part = File(dest.path + ".part")

        // A ticket applies to exactly one fetch: no second attempt, no Range resume.
        val maxAttempts = if (once) 1 else 8
        var lastError: Throwable? = null
        for (attempt in 1..maxAttempts) {
            when (val step = pdfStep(
                finishedSize = if (dest.exists()) dest.length() else 0L,
                // Plaintext bytes, not file size: the server's Range refers to that.
                partSize    = instructions.plaintextLength(part),
            )) {
                is PdfStep.Done -> {
                    // Already complete: no network. The progress is reported anyway
                    // so that the display does not stay at 0 %.
                    val len = dest.length()
                    onProgress(len, len)
                    return
                }
                is PdfStep.Fetch -> {
                    catchUnlessCancelled {
                        fetchFrom(client, url, step.ab, part, onProgress)
                        // Only NOW does the file get the finished one's name. If renaming fails,
                        // it is copied — otherwise the next call loads everything again.
                        if (!part.renameTo(dest)) {
                            part.copyTo(dest, overwrite = true)
                            part.delete()
                        }
                        return
                    }.onFailure { e ->
                        lastError = e
                        if (attempt < maxAttempts) delay((1000L * attempt).coerceAtMost(4000L))
                    }
                }
            }
        }
        throw lastError ?: DownloadFailed()
    }

    /** A fetch from byte [ab] into the partial file; the server answers with 206 (resume) or 200 (new). */
    private suspend fun fetchFrom(client: OkHttpClient, url: String, ab: Long, part: File, onProgress: (Long, Long) -> Unit) {
        val reqBuilder = Request.Builder().url(url)
        if (ab > 0) reqBuilder.header("Range", "bytes=$ab-")
        client.newCall(reqBuilder.build()).execute().use { resp ->
            if (!resp.isSuccessful) throw DownloadFailed(resp.code)
            val resuming = resp.code == 206 && ab > 0
            // No `?:`: `resp.body` is not nullable since OkHttp 5.
            val body = resp.body
            val total: Long = if (resuming) {
                resp.header("Content-Range")?.substringAfterLast('/')?.toLongOrNull()
                    ?: (ab + body.contentLength())
            } else {
                body.contentLength()
            }
            var downloaded = if (resuming) ab else 0L
            instructions.write(part, resume = resuming).use { from ->
                body.byteStream().use { input ->
                    val buf = ByteArray(64 * 1024)
                    var lastPct = -1
                    var lastEmit = 0L
                    var read = input.read(buf)
                    while (read != -1) {
                        // Leaving cancels instead of continuing to load in the background.
                        currentCoroutineContext().ensureActive()
                        from.write(buf, 0, read)
                        downloaded += read
                        val now = System.currentTimeMillis()
                        val pct = if (total > 0) (downloaded * 100 / total).toInt() else -1
                        if (pct != lastPct || now - lastEmit > 300) {
                            lastPct = pct; lastEmit = now
                            onProgress(downloaded, total)
                        }
                        read = input.read(buf)
                    }
                }
            }
            onProgress(downloaded, total)
        }
    }
}

/**
 * Derived from the shared api client: newBuilder() takes over the interceptors
 * (bearer token, cleartext ban, 401 message) and the pools; only the timeouts differ.
 */
private fun loadClient(baseClient: OkHttpClient): OkHttpClient = baseClient.newBuilder()
    .connectTimeout(30, TimeUnit.SECONDS)
    .readTimeout(120, TimeUnit.SECONDS)
    .callTimeout(0, TimeUnit.SECONDS)
    .retryOnConnectionFailure(true)
    .build()

/**
 * Keeps the PDF view cache under [PDF_CACHE_BUDGET_BYTES]. Viewed instructions
 * stay (reopening, resuming), but need an upper limit. Oldest
 * first; [keep] — the file just requested including partial file — is never deleted.
 */
private fun prunePdfCache(cacheDir: File, keep: File) {
    try {
        // `.part` counted too: an aborted 300 MB download occupies the same space.
        val files = cacheDir.listFiles { f ->
            f.isFile && f.name.startsWith(INSTRUCTION_PREFIX) &&
                (f.name.endsWith(INSTRUCTION_EXTENSION) || f.name.endsWith("$INSTRUCTION_EXTENSION.part"))
        }?.sortedByDescending { it.lastModified() } ?: return

        val spared = setOf(keep.absolutePath, keep.absolutePath + ".part")
        var used = 0L
        for (f in files) {
            used += f.length()
            if (f.absolutePath !in spared && used > PDF_CACHE_BUDGET_BYTES) f.delete()
        }
    } catch (_: Exception) { /* Best effort — cleaning up must never prevent the download */ }
}

private const val PDF_CACHE_BUDGET_BYTES = 500L * 1024 * 1024
