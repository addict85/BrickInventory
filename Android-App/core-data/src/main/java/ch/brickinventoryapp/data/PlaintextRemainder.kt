package ch.brickinventoryapp.data

import androidx.datastore.preferences.core.MutablePreferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey

/**
 * What the abolished cleartext permission left on the device. It is no longer
 * read; it goes away so that no old release for hosts and networks stays
 * that a later state could accidentally evaluate again. Likewise the
 * account and storage location filters of earlier versions: they named accounts and locations in plaintext
 * and now live only in memory (ScopeFilterStorage).
 */
internal object PlaintextRemainder {
    /** In the DataStore: released hosts, known networks, the takeover mark. */
    private val DATASTORE = listOf(
        stringSetPreferencesKey("klartext_hosts"),
        stringSetPreferencesKey("klartext_netze"),
        booleanPreferencesKey("klartext_alt_uebernommen"),
    )

    /** In the mirror (SharedPreferences): the expert switch and its takeover mark. */
    val MIRROR = listOf("klartext_experte", "klartext_experte_uebernommen")

    /** The names begin with the view (ScopeFilter.View.key); the values were always text. */
    private val FILTER = listOf("scope_", "lager_")

    fun entferne(prefs: MutablePreferences) {
        DATASTORE.forEach { prefs.remove(it) }
        prefs.asMap().keys.map { it.name }.filter { n -> FILTER.any(n::startsWith) }
            .forEach { prefs.remove(stringPreferencesKey(it)) }
    }
}
