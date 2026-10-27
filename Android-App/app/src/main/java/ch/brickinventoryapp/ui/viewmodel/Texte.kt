package ch.brickinventoryapp.ui.viewmodel

import android.content.Context
import android.net.Uri
import ch.brickinventoryapp.data.PreferencesManager
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.ui.fehlerTextBrauchtCode
import ch.brickinventoryapp.ui.fehlerTextId
import ch.brickinventoryapp.ui.mitTechnischerUrsache
import ch.brickinventoryapp.util.LanguageManager
import ch.brickinventoryapp.util.meldetDieSitzungsschicht
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import javax.inject.Inject

/**
 * Texte und Fehlermeldungen für die herausgelösten ViewModels.
 *
 * Eine Schnittstelle statt des Contexts, damit sich ein ViewModel ohne Gerät
 * bauen und ausführen lässt: Der Test reicht eine Fassung herein, die die
 * Ressourcennummer zurückgibt. Die Regeln selbst sind dieselben wie in
 * MainViewModel.text()/meldungFuerSnackbar().
 */
interface Texte {
    fun text(id: Int, vararg args: Any?): String
    fun menge(id: Int, anzahl: Int, vararg args: Any?): String
    /** Null heisst: Die Sitzungsschicht hat den Fehler schon gemeldet. */
    fun meldungFuerSnackbar(fehler: Result.Error): String?
}

/** In der Sprache der App, nicht des Systems — siehe MainViewModel.text(). */
class AppTexte @Inject constructor(
    @param:ApplicationContext private val ctx: Context,
    private val prefs: PreferencesManager,
) : Texte {
    override fun text(id: Int, vararg args: Any?): String {
        val c = LanguageManager.localizedContext(ctx)
        return if (args.isEmpty()) c.getString(id) else c.getString(id, *args)
    }

    override fun menge(id: Int, anzahl: Int, vararg args: Any?): String =
        LanguageManager.localizedContext(ctx).resources.getQuantityString(id, anzahl, *args)

    override fun meldungFuerSnackbar(fehler: Result.Error): String? {
        if (meldetDieSitzungsschicht(fehler.unauthorized, prefs.authTokenState.value?.isNotBlank() == true)) return null
        if (fehler.message.isNotBlank()) return fehler.message
        val id = fehlerTextId(fehler.art)
        val satz = if (fehlerTextBrauchtCode(fehler.art)) text(id, fehler.httpCode ?: 0) else text(id)
        return mitTechnischerUrsache(satz, fehler.art, fehler.technisch)
    }
}

/** Liest eine vom Nutzer gewählte Datei: Medientyp und Inhalt, oder null. */
interface DateiLeser {
    suspend fun lies(uri: Uri): Pair<String?, ByteArray>?
}

class AppDateiLeser @Inject constructor(
    @param:ApplicationContext private val ctx: Context,
) : DateiLeser {
    override suspend fun lies(uri: Uri): Pair<String?, ByteArray>? = withContext(Dispatchers.IO) {
        runCatching {
            val bytes = ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() }
            bytes?.let { ctx.contentResolver.getType(uri) to it }
        }.getOrNull()
    }
}
