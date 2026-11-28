package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.appearance.Design
import ch.brickinventoryapp.model.domain.CurrencyCode
import kotlinx.coroutines.flow.Flow

/**
 * What the AppViewModel needs from the store: address, token and the values of the
 * account that it mirrors. On the device the AccountStore; the interface
 * lets the AppViewModel run without DataStore and Context.
 */
interface SessionStore {
    val serverUrl: Flow<String>
    val authToken: Flow<String>
    val appTheme: Flow<Design>
    val currency: Flow<CurrencyCode>
    val language: Flow<String>
    suspend fun serverUrlNow(): String
    suspend fun tokenNow(): String

    /** Older than the server lets a sign-in apply: then sign out instead of loading. */
    suspend fun loginExpired(now: Long = System.currentTimeMillis()): Boolean

    /** The end is near (last week): ask for a new sign-in before requests start failing. */
    suspend fun loginExpiresSoon(now: Long = System.currentTimeMillis()): Boolean = false
    suspend fun saveAppTheme(theme: Design)
    suspend fun saveCurrency(cur: CurrencyCode)

    /** Servers at which a deferred sign-out finally failed. */
    fun failedRedemptions(): Set<String>
    fun acknowledgeFailedRedemptions()
}
