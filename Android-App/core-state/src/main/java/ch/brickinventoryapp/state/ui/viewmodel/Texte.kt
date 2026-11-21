package ch.brickinventoryapp.state.ui.viewmodel

import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.network.util.reportsTheSessionLayer

/**
 * Texts and error messages for the extracted ViewModels.
 *
 * An interface instead of the Context, so a ViewModel can be built
 * and run without a device: the test supplies an implementation that returns the
 * resource number. The implementation for the device is AppTexte.
 */
interface Texte {
    fun text(id: Int, vararg args: Any?): String
    fun menge(id: Int, anzahl: Int, vararg args: Any?): String
    /** For error fields in forms — there, „nothing to say“ is not an answer. */
    fun meldung(fehler: Ergebnis.Fehler): String
    /** Null means: the session layer has already reported the error. */
    fun meldungFuerSnackbar(fehler: Ergebnis.Fehler): String? =
        if (reportsTheSessionLayer(fehler is Ergebnis.Fehler.Abgewiesen, angemeldet())) null else meldung(fehler)
    /** Is there a token? The same source the interceptor reads. */
    fun angemeldet(): Boolean
}
