package ch.brickinventoryapp.ui.viewmodel

import android.content.Context
import android.net.Uri
import ch.brickinventoryapp.data.Anmeldestand
import ch.brickinventoryapp.data.api.fehlerTextZuCode
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.ui.fehlerTextBrauchtCode
import ch.brickinventoryapp.ui.fehlerTextId
import ch.brickinventoryapp.ui.mitTechnischerUrsache
import ch.brickinventoryapp.util.LanguageManager
import dagger.hilt.android.qualifiers.ApplicationContext
import ch.brickinventoryapp.di.BrickDispatchers
import ch.brickinventoryapp.di.Dispatcher
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

    override fun meldung(fehler: Result.Error): String {
        if (fehler.message.isNotBlank()) return fehler.message
        fehlerTextZuCode(fehler.code)?.let { return text(it) }
        val id = fehlerTextId(fehler.art)
        val satz = if (fehlerTextBrauchtCode(fehler.art)) text(id, fehler.httpCode ?: 0) else text(id)
        return mitTechnischerUrsache(satz, fehler.art, fehler.technisch)
    }
}

class AppDateiLeser @Inject constructor(
    @param:ApplicationContext private val ctx: Context,
    @param:Dispatcher(BrickDispatchers.IO) private val io: CoroutineDispatcher,
) : DateiLeser {
    override suspend fun lies(uri: Uri): Pair<String?, ByteArray>? = withContext(io) {
        runCatching {
            val bytes = ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() }
            bytes?.let { ctx.contentResolver.getType(uri) to it }
        }.getOrNull()
    }

    override suspend fun name(uri: Uri): String? = withContext(io) {
        runCatching {
            ctx.contentResolver.query(uri, null, null, null, null)?.use { c ->
                val i = c.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                if (i >= 0 && c.moveToFirst()) c.getString(i) else null
            }
        }.getOrNull()
    }
}
