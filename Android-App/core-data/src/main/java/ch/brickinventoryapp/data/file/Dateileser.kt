package ch.brickinventoryapp.data.file

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.core.net.toUri
import ch.brickinventoryapp.model.coroutines.BrickDispatchers
import ch.brickinventoryapp.model.coroutines.Dispatcher
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.InputStream
import ch.brickinventoryapp.model.file.FileReader
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.model.file.Gelesen
import javax.inject.Inject

internal class AppFileReader @Inject constructor(
    @param:ApplicationContext private val ctx: Context,
    @param:Dispatcher(BrickDispatchers.IO) private val io: CoroutineDispatcher,
) : FileReader {
    override suspend fun lies(datei: FileRef): Pair<String?, ByteArray>? =
        (readAtMost(datei, FILE_AT_MOST) as? Gelesen.Inhalt)?.let { it.typ to it.bytes }

    // The size the provider names first; it can be missing or lie, which is why
    // readLimited() reads only up to the limit anyway.
    override suspend fun readAtMost(datei: FileRef, grenze: Long): Gelesen? = withContext(io) {
        val uri = datei.wert.toUri()
        runCatching {
            if ((groesse(uri) ?: 0L) > grenze) return@runCatching Gelesen.ToLarge
            val ein = ctx.contentResolver.openInputStream(uri) ?: return@runCatching null
            val bytes = ein.use { readLimited(it, grenze) } ?: return@runCatching Gelesen.ToLarge
            Gelesen.Inhalt(ctx.contentResolver.getType(uri), bytes)
        }.getOrNull()
    }

    private fun groesse(uri: Uri): Long? =
        ctx.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { c ->
            val i = c.getColumnIndex(OpenableColumns.SIZE)
            if (i >= 0 && c.moveToFirst() && !c.isNull(i)) c.getLong(i) else null
        }

    override suspend fun name(datei: FileRef): String? = withContext(io) {
        val uri = datei.wert.toUri()
        runCatching {
            ctx.contentResolver.query(uri, null, null, null, null)?.use { c ->
                val i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (i >= 0 && c.moveToFirst()) c.getString(i) else null
            }
        }.getOrNull()
    }
}

/** The largest file an upload of the app accepts (instructions); [AppFileReader.lies] never reads more. */
internal const val FILE_AT_MOST = 50L * 1024 * 1024

/** Up to [grenze] bytes and one more as a probe; null if the stream is longer. The rest stays unread. */
internal fun readLimited(ein: InputStream, grenze: Long): ByteArray? {
    val aus = ByteArrayOutputStream()
    val puffer = ByteArray(64 * 1024)
    var gelesen = 0L
    while (true) {
        val n = ein.read(puffer, 0, minOf(puffer.size.toLong(), grenze + 1 - gelesen).toInt())
        if (n < 0) return aus.toByteArray()
        gelesen += n
        if (gelesen > grenze) return null
        aus.write(puffer, 0, n)
    }
}
