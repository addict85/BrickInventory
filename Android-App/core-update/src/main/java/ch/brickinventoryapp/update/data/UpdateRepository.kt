package ch.brickinventoryapp.update.data

import ch.brickinventoryapp.data.di.UpdateClient
import ch.brickinventoryapp.model.coroutines.BrickDispatchers
import ch.brickinventoryapp.model.coroutines.Dispatcher
import ch.brickinventoryapp.model.util.AppVersion
import ch.brickinventoryapp.update.util.UPDATE_JSON_MAX_BYTES
import ch.brickinventoryapp.update.util.UPDATE_MAX_BYTES
import ch.brickinventoryapp.update.util.UPDATE_VERSION_URL
import ch.brickinventoryapp.update.util.UpdateDescription
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.File
import java.io.IOException
import javax.inject.Inject

/** The network side of the self-update: fetch description and APK. Checking and installing stays in the ViewModel. */
interface UpdateRepository {
    /** The installed version; the check compares against it. */
    val runningVersion: AppVersion

    /** The signed description, raw and at most [UPDATE_JSON_MAX_BYTES]; throws on a network error. */
    suspend fun fetchDescription(): String

    /**
     * Loads the APK to [target] and reports progress in percent, only on change.
     * An abort or error deletes the partial file; a half APK must not stick around.
     */
    fun loadApk(description: UpdateDescription, target: File): Flow<Int>
}

/** Via the bare update client; both fetches go through [fetch]. */
class UpdateLoader @Inject constructor(
    @param:UpdateClient private val client: OkHttpClient,
    override val runningVersion: AppVersion,
    @param:Dispatcher(BrickDispatchers.IO) private val io: CoroutineDispatcher,
) : UpdateRepository {

    override suspend fun fetchDescription(): String = withContext(io) {
        fetch(UPDATE_VERSION_URL).use { response ->
            // peekBody reads at most this much: a tampered response must not
            // crash the app, without ever having to touch an APK.
            response.peekBody(UPDATE_JSON_MAX_BYTES).string()
        }
    }

    override fun loadApk(description: UpdateDescription, target: File): Flow<Int> = flow {
        try {
            fetch(description.apkUrl).use { response ->
                // Preferred from the description: behind the redirect contentLength is often -1.
                val total = if (description.apkSize > 0) description.apkSize else response.body.contentLength()
                val upperLimit =
                    if (total in 1..UPDATE_MAX_BYTES) minOf(total + 1024 * 1024, UPDATE_MAX_BYTES)
                    else UPDATE_MAX_BYTES
                response.body.byteStream().use { one ->
                    target.outputStream().use { from ->
                        val buffer = ByteArray(64 * 1024)
                        var loaded = 0L
                        var last = -1
                        while (true) {
                            // Without this check an abandoned download would keep running to the end.
                            currentCoroutineContext().ensureActive()
                            val n = one.read(buffer)
                            if (n < 0) break
                            loaded += n
                            // Abort BEFORE writing: otherwise the excess is already on disk.
                            if (loaded > upperLimit) throw IOException("Update groesser als erlaubt ($loaded > $upperLimit)")
                            from.write(buffer, 0, n)
                            val p = if (total > 0) ((loaded * 100) / total).toInt().coerceIn(0, 100) else last
                            if (p != last) {
                                last = p
                                emit(p)
                            }
                        }
                    }
                }
            }
        } catch (e: CancellationException) {
            target.delete()
            throw e
        } catch (e: IOException) {
            target.delete()
            throw e
        }
    }.flowOn(io)

    /**
     * The one place where the self-update talks to the network: one check of the
     * response (status, redirect target) covers description and APK equally.
     */
    private fun fetch(address: String): Response {
        val response = client.newCall(Request.Builder().url(address).build()).execute()
        if (!response.isSuccessful) {
            response.close()
            throw IOException("HTTP ${response.code}")
        }
        return response
    }
}
