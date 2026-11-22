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
 * display immediately, the server only learns of it with [execute]. This way „undo“ needs no
 * path back on the server and also works offline.
 */
class DeletionMark<T : Any>(
    private val scope: CoroutineScope,
    private val delete: suspend (T) -> Unit,
) {
    private val _value = MutableStateFlow<T?>(null)
    val value: StateFlow<T?> = _value.asStateFlow()

    /** A still-open earlier deletion is carried out first: it no longer has a snackbar. */
    fun reserve(entry: T) {
        execute()
        _value.value = entry
    }

    /** [only]: only this entry; the snackbar of a superseded deletion doesn't bring the next one back. */
    fun undo(only: T? = null) {
        val v = _value.value ?: return
        if (only != null && v != only) return
        _value.value = null
    }

    /** [only]: only this entry; otherwise the next one would be deleted without „undo“. */
    fun execute(only: T? = null) {
        val v = _value.value ?: return
        if (only != null && v != only) return
        _value.value = null
        // Immediately and not cancellable: if the snackbar ends because the page is left,
        // the ViewModel goes with it right away, and the deletion must not be lost in the process.
        scope.launch(start = CoroutineStart.UNDISPATCHED) { withContext(NonCancellable) { delete(v) } }
    }
}
