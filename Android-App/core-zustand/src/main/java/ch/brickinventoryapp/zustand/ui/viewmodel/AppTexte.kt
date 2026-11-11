package ch.brickinventoryapp.zustand.ui.viewmodel

import android.content.Context
import androidx.core.net.toUri
import ch.brickinventoryapp.data.Anmeldestand
import ch.brickinventoryapp.data.repository.fehlerTextZuCode
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.zustand.ui.fehlerTextArgument
import ch.brickinventoryapp.zustand.ui.fehlerTextId
import ch.brickinventoryapp.zustand.ui.mitTechnischerUrsache
import ch.brickinventoryapp.data.util.LanguageManager
import dagger.hilt.android.qualifiers.ApplicationContext
import ch.brickinventoryapp.model.koroutinen.BrickDispatchers
import ch.brickinventoryapp.model.koroutinen.Dispatcher
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import javax.inject.Inject

/** In der Sprache der App, nicht des Systems — siehe LanguageManager.localizedContext(). */
class AppTexte @Inject constructor(
    @param:ApplicationContext private val ctx: Context,
    private val prefs: Anmeldestand,
) : Texte {
    override fun text(id: Int, vararg args: Any?): String {
        val c = LanguageManager.localizedContext(ctx)
        return if (args.isEmpty()) c.getString(id) else c.getString(id, *args)
    }

    override fun menge(id: Int, anzahl: Int, vararg args: Any?): String =
        LanguageManager.localizedContext(ctx).resources.getQuantityString(id, anzahl, *args)

    override fun angemeldet() = prefs.authTokenState.value?.isNotBlank() == true

    override fun meldung(fehler: Ergebnis.Error): String {
        if (fehler.message.isNotBlank()) return fehler.message
        fehlerTextZuCode(fehler.code)?.let { return text(it) }
        val id = fehlerTextId(fehler)
        val satz = fehlerTextArgument(fehler)?.let { text(id, it) } ?: text(id)
        return mitTechnischerUrsache(satz, fehler)
    }
}

class AppDateiLeser @Inject constructor(
    @param:ApplicationContext private val ctx: Context,
    @param:Dispatcher(BrickDispatchers.IO) private val io: CoroutineDispatcher,
) : DateiLeser {
    override suspend fun lies(datei: DateiRef): Pair<String?, ByteArray>? = withContext(io) {
        val uri = datei.wert.toUri()
        runCatching {
            val bytes = ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() }
            bytes?.let { ctx.contentResolver.getType(uri) to it }
        }.getOrNull()
    }

    override suspend fun name(datei: DateiRef): String? = withContext(io) {
        val uri = datei.wert.toUri()
        runCatching {
            ctx.contentResolver.query(uri, null, null, null, null)?.use { c ->
                val i = c.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                if (i >= 0 && c.moveToFirst()) c.getString(i) else null
            }
        }.getOrNull()
    }
}
