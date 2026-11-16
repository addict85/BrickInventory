package ch.brickinventoryapp.zustand.ui.viewmodel

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Löschen mit „Rückgängig“, wie bei Sets und Merkliste: Der Eintrag fehlt sofort in der
 * Anzeige, der Server erfährt es erst mit [ausfuehren]. So braucht „Rückgängig“ keinen
 * Weg zurück am Server und wirkt auch offline.
 */
class Loeschvormerkung<T : Any>(
    private val scope: CoroutineScope,
    private val loeschen: suspend (T) -> Unit,
) {
    private val _wert = MutableStateFlow<T?>(null)
    val wert: StateFlow<T?> = _wert.asStateFlow()

    /** Ein noch offenes früheres Löschen wird zuerst ausgeführt: Es hat keine Snackbar mehr. */
    fun vormerken(eintrag: T) {
        ausfuehren()
        _wert.value = eintrag
    }

    /** [nur]: nur dieser Eintrag; die Snackbar eines abgelösten Löschens holt nicht den nächsten zurück. */
    fun rueckgaengig(nur: T? = null) {
        val v = _wert.value ?: return
        if (nur != null && v != nur) return
        _wert.value = null
    }

    /** [nur]: nur dieser Eintrag; sonst wäre der nächste ohne „Rückgängig“ gelöscht. */
    fun ausfuehren(nur: T? = null) {
        val v = _wert.value ?: return
        if (nur != null && v != nur) return
        _wert.value = null
        // Sofort und nicht abbrechbar: Endet die Snackbar, weil man die Seite verlässt, geht
        // das ViewModel gleich mit, und das Löschen darf dabei nicht verloren gehen.
        scope.launch(start = CoroutineStart.UNDISPATCHED) { withContext(NonCancellable) { loeschen(v) } }
    }
}
