package ch.brickinventoryapp.zustand.ui.viewmodel

import ch.brickinventoryapp.data.Anmeldestand
import ch.brickinventoryapp.model.util.Textquelle
import ch.brickinventoryapp.data.repository.fehlerTextZuCode
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.zustand.ui.fehlerTextArgument
import ch.brickinventoryapp.zustand.ui.fehlerTextId
import ch.brickinventoryapp.zustand.ui.mitTechnischerUrsache
import javax.inject.Inject

/** In der Sprache der App, nicht des Systems: Die Textquelle holt sie über LanguageManager. */
class AppTexte @Inject constructor(
    private val quelle: Textquelle,
    private val prefs: Anmeldestand,
) : Texte {
    override fun text(id: Int, vararg args: Any?): String = quelle.text(id, *args)

    override fun menge(id: Int, anzahl: Int, vararg args: Any?): String = quelle.menge(id, anzahl, *args)

    override fun angemeldet() = prefs.authTokenState.value?.isNotBlank() == true

    override fun meldung(fehler: Ergebnis.Error): String {
        if (fehler.message.isNotBlank()) return fehler.message
        fehlerTextZuCode(fehler.code)?.let { return text(it) }
        val id = fehlerTextId(fehler)
        val satz = fehlerTextArgument(fehler)?.let { text(id, it) } ?: text(id)
        return mitTechnischerUrsache(satz, fehler)
    }
}
