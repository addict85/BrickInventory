package ch.brickinventoryapp.state.ui.viewmodel

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Delete with „undo“, as for sets and the wishlist: the entry disappears from the
 * display immediately, the server only learns of it with [ausfuehren]. This way „undo“ needs no
 * path back on the server and also works offline.
 */
class Loeschvormerkung<T : Any>(
    private val scope: CoroutineScope,
    private val loeschen: suspend (T) -> Unit,
) {
    private val _value = MutableStateFlow<T?>(null)
    val wert: StateFlow<T?> = _value.asStateFlow()

    /** A still-open earlier deletion is carried out first: it no longer has a snackbar. */
    fun reserve(entry: T) {
        ausfuehren()
        _value.value = entry
    }

    /** [nur]: only this entry; the snackbar of a superseded deletion doesn't bring the next one back. */
    fun rueckgaengig(nur: T? = null) {
        val v = _value.value ?: return
        if (nur != null && v != nur) return
        _value.value = null
    }

    /** [nur]: only this entry; otherwise the next one would be deleted without „undo“. */
    fun ausfuehren(nur: T? = null) {
        val v = _value.value ?: return
        if (nur != null && v != nur) return
        _value.value = null
        // Immediately and not cancellable: if the snackbar ends because the page is left,
        // the ViewModel goes with it right away, and the deletion must not be lost in the process.
        scope.launch(start = CoroutineStart.UNDISPATCHED) { withContext(NonCancellable) { loeschen(v) } }
    }
}
