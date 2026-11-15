package ch.brickinventoryapp.data.datei

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.core.net.toUri
import ch.brickinventoryapp.model.koroutinen.BrickDispatchers
import ch.brickinventoryapp.model.koroutinen.Dispatcher
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.InputStream
import ch.brickinventoryapp.model.datei.DateiLeser
import ch.brickinventoryapp.model.datei.DateiRef
import ch.brickinventoryapp.model.datei.Gelesen
import javax.inject.Inject

internal class AppDateiLeser @Inject constructor(
    @param:ApplicationContext private val ctx: Context,
    @param:Dispatcher(BrickDispatchers.IO) private val io: CoroutineDispatcher,
) : DateiLeser {
    override suspend fun lies(datei: DateiRef): Pair<String?, ByteArray>? =
        (liesHoechstens(datei, DATEI_HOECHSTENS) as? Gelesen.Inhalt)?.let { it.typ to it.bytes }

    // Die Grösse, die der Anbieter nennt, zuerst; sie kann fehlen oder lügen, darum liest
    // liesBegrenzt() ohnehin nur bis zur Grenze.
    override suspend fun liesHoechstens(datei: DateiRef, grenze: Long): Gelesen? = withContext(io) {
        val uri = datei.wert.toUri()
        runCatching {
            if ((groesse(uri) ?: 0L) > grenze) return@runCatching Gelesen.ZuGross
            val ein = ctx.contentResolver.openInputStream(uri) ?: return@runCatching null
            val bytes = ein.use { liesBegrenzt(it, grenze) } ?: return@runCatching Gelesen.ZuGross
            Gelesen.Inhalt(ctx.contentResolver.getType(uri), bytes)
        }.getOrNull()
    }

    private fun groesse(uri: Uri): Long? =
        ctx.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { c ->
            val i = c.getColumnIndex(OpenableColumns.SIZE)
            if (i >= 0 && c.moveToFirst() && !c.isNull(i)) c.getLong(i) else null
        }

    override suspend fun name(datei: DateiRef): String? = withContext(io) {
        val uri = datei.wert.toUri()
        runCatching {
            ctx.contentResolver.query(uri, null, null, null, null)?.use { c ->
                val i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (i >= 0 && c.moveToFirst()) c.getString(i) else null
            }
        }.getOrNull()
    }
}

/** Die grösste Datei, die ein Upload der App annimmt (Anleitungen); mehr liest [AppDateiLeser.lies] nie. */
internal const val DATEI_HOECHSTENS = 50L * 1024 * 1024

/** Bis [grenze] Bytes und eines mehr zur Probe; null, wenn der Strom länger ist. Der Rest bleibt ungelesen. */
internal fun liesBegrenzt(ein: InputStream, grenze: Long): ByteArray? {
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
