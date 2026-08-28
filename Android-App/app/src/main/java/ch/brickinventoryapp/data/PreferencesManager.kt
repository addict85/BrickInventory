package ch.brickinventoryapp.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import javax.inject.Inject
import javax.inject.Singleton

val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "app_prefs")

@Singleton
class PreferencesManager @Inject constructor(
    @param:ApplicationContext private val context: Context
) {
    companion object {
        val SERVER_URL   = stringPreferencesKey("server_url")
        val AUTH_TOKEN   = stringPreferencesKey("auth_token")
        val USERNAME     = stringPreferencesKey("username")
        val CURRENCY     = stringPreferencesKey("currency")
        // "system" (folgt der OS-Sprache), "en" oder "de"
        val LANGUAGE     = stringPreferencesKey("language")
    }

    val serverUrl: Flow<String> = context.dataStore.data.map { prefs ->
        val raw = prefs[SERVER_URL] ?: ""
        // Normalize scheme to lowercase (e.g. HTTPs → https)
        if (raw.contains("://")) {
            val idx = raw.indexOf("://")
            raw.substring(0, idx).lowercase() + raw.substring(idx)
        } else raw
    }
    val authToken: Flow<String> = context.dataStore.data.map { it[AUTH_TOKEN] ?: "" }
    val username:  Flow<String> = context.dataStore.data.map { it[USERNAME]   ?: "" }
    val currency:  Flow<String> = context.dataStore.data.map { it[CURRENCY]   ?: "EUR" }
    val language:  Flow<String> = context.dataStore.data.map { it[LANGUAGE]   ?: "system" }

    // ── In-Memory-Cache für den OkHttp-Interceptor ────────────────────────────
    // Der Interceptor läuft auf OkHttp-Dispatcher-Threads und darf dort nicht
    // blockieren. Diese StateFlows spiegeln DataStore-Werte im Speicher, sodass
    // pro Request nur ein synchroner .value-Read nötig ist (statt runBlocking).
    // null = DataStore noch nicht gelesen (nur ganz kurz beim Kaltstart).
    private val prefsScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    val serverUrlState: StateFlow<String?> =
        serverUrl.stateIn(prefsScope, SharingStarted.Eagerly, null)
    val authTokenState: StateFlow<String?> =
        authToken.stateIn(prefsScope, SharingStarted.Eagerly, null)

    suspend fun saveServerUrl(url: String) {
        // Normalize: lowercase scheme (http/https), trim trailing slash
        val normalized = url.trim().trimEnd('/').let { u ->
            if (u.contains("://")) {
                val idx = u.indexOf("://")
                u.substring(0, idx).lowercase() + u.substring(idx)
            } else u
        }
        context.dataStore.edit { it[SERVER_URL] = normalized }
    }
    suspend fun saveAuthToken(token: String) {
        context.dataStore.edit { it[AUTH_TOKEN] = token }
    }
    suspend fun saveUsername(name: String) {
        context.dataStore.edit { it[USERNAME] = name }
    }
    suspend fun saveCurrency(cur: String) {
        context.dataStore.edit { it[CURRENCY] = cur }
    }
    suspend fun saveLanguage(lang: String) {
        context.dataStore.edit { it[LANGUAGE] = lang }
    }
    suspend fun clearSession() {
        context.dataStore.edit {
            it.remove(AUTH_TOKEN)
            it.remove(USERNAME)
        }
    }
}
