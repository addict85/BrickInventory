package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.data.ScopeFilter
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Where the choice of the account and storage location filter lies: only in memory. The values name accounts
 * and storage locations and apply only until the next sign-in anyway; on disk they would lie
 * in plaintext next to the address. After a process end „all“ applies again, as for the
 * scroll position. Separate from [ScopeFilter] so that the rules there get by without Android.
 */
@Singleton
class ScopeFilterStorage @Inject constructor() {

    private val values = MutableStateFlow<Map<String, String>>(emptyMap())

    private fun prefKey(view: ScopeFilter.View) = "scope_${view.key}"

    fun flow(view: ScopeFilter.View): Flow<String> =
        values.map { it[prefKey(view)] ?: ScopeFilter.ALL }

    fun set(view: ScopeFilter.View, value: String) {
        values.update { it + (prefKey(view) to value) }
    }

    /**
     * Reset the account filter of all views on every sign-in: a surviving
     * filter on a single account would look after login as if half the
     * collection had disappeared. The storage location filter along with it, for the same reason.
     */
    fun resetAll() {
        values.value = emptyMap()
    }

    // ═══ Storage location filter — per view, like the account filter (`public/js/account-filter.js`) ═══

    private fun storageKey(view: ScopeFilter.View) = "lager_${view.key}"

    /** Empty text = not filtered. */
    fun storageFlow(view: ScopeFilter.View): Flow<String> =
        values.map { it[storageKey(view)] ?: "" }

    fun setStorage(view: ScopeFilter.View, value: String) {
        values.update { if (value.isBlank()) it - storageKey(view) else it + (storageKey(view) to value) }
    }
}
