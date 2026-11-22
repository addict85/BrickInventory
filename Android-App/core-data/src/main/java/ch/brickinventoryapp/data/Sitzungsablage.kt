package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.domain.Waehrung
import ch.brickinventoryapp.model.ui.theme.Design
import kotlinx.coroutines.flow.Flow

/**
 * What the AppViewModel needs from the store: address, token and the values of the
 * account that it mirrors. On the device the AccountStore; the interface
 * lets the AppViewModel run without DataStore and Context.
 */
interface Sitzungsablage {
    val serverUrl: Flow<String>
    val authToken: Flow<String>
    val appTheme: Flow<Design>
    val currency: Flow<Waehrung>
    val language: Flow<String>
    suspend fun serverUrlJetzt(): String
    suspend fun tokenJetzt(): String

    /** Older than the server lets a sign-in apply: then sign out instead of loading. */
    suspend fun loginExpired(jetzt: Long = System.currentTimeMillis()): Boolean
    suspend fun saveAppTheme(theme: Design)
    suspend fun saveCurrency(cur: Waehrung)

    /** Servers at which a deferred sign-out finally failed. */
    fun failedRedemptions(): Set<String>
    fun acknowledgeFailedRedemptions()
}
