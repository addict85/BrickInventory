package ch.brickinventoryapp.data.file

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.core.net.toUri
import ch.brickinventoryapp.model.coroutines.BrickDispatchers
import ch.brickinventoryapp.model.coroutines.Dispatcher
import ch.brickinventoryapp.model.file.FileReader
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.model.file.Read
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.InputStream
import javax.inject.Inject

internal class AppFileReader @Inject constructor(
    @param:ApplicationContext private val ctx: Context,
    @param:Dispatcher(BrickDispatchers.IO) private val io: CoroutineDispatcher,
) : FileReader {
    override suspend fun read(file: FileRef): Pair<String?, ByteArray>? =
        (readAtMost(file, FILE_AT_MOST) as? Read.Content)?.let { it.type to it.bytes }

    // The size the provider names first; it can be missing or lie, which is why
    // readLimited() reads only up to the limit anyway.
    override suspend fun readAtMost(file: FileRef, limit: Long): Read? = withContext(io) {
        val uri = file.value.toUri()
        runCatching {
            if ((size(uri) ?: 0L) > limit) return@runCatching Read.ToLarge
            val one = ctx.contentResolver.openInputStream(uri) ?: return@runCatching null
            val bytes = one.use { readLimited(it, limit) } ?: return@runCatching Read.ToLarge
            Read.Content(ctx.contentResolver.getType(uri), bytes)
        }.getOrNull()
    }

    private fun size(uri: Uri): Long? =
        ctx.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { c ->
            val i = c.getColumnIndex(OpenableColumns.SIZE)
            if (i >= 0 && c.moveToFirst() && !c.isNull(i)) c.getLong(i) else null
        }

    override suspend fun name(file: FileRef): String? = withContext(io) {
        val uri = file.value.toUri()
        runCatching {
            ctx.contentResolver.query(uri, null, null, null, null)?.use { c ->
                val i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (i >= 0 && c.moveToFirst()) c.getString(i) else null
            }
        }.getOrNull()
    }
}

/** The largest file an upload of the app accepts (instructions); [AppFileReader.read] never reads more. */
internal const val FILE_AT_MOST = 50L * 1024 * 1024

/** Up to [limit] bytes and one more as a probe; null if the stream is longer. The rest stays unread. */
internal fun readLimited(one: InputStream, limit: Long): ByteArray? {
    val from = ByteArrayOutputStream()
    val buffer = ByteArray(64 * 1024)
    var read = 0L
    while (true) {
        val n = one.read(buffer, 0, minOf(buffer.size.toLong(), limit + 1 - read).toInt())
        if (n < 0) return from.toByteArray()
        read += n
        if (read > limit) return null
        from.write(buffer, 0, n)
    }
}
