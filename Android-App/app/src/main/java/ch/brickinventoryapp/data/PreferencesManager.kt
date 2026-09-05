package ch.brickinventoryapp.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import ch.brickinventoryapp.util.TokenVerschluesselung
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
    @param:ApplicationContext private val context: Context,
    private val tresor: TokenVerschluesselung,
) {
    companion object {
        val SERVER_URL   = stringPreferencesKey("server_url")
        /**
         * Der ALTE Klartext-Schlüssel. Bleibt bestehen, weil auf jedem Gerät,
         * das die App schon benutzt hat, genau dort das Token liegt. Er wird
         * nur noch GELESEN (einmalig, zur Übernahme) und danach entfernt —
         * geschrieben wird ausschliesslich AUTH_TOKEN_ENC.
         */
        val AUTH_TOKEN     = stringPreferencesKey("auth_token")

        /** Der verschlüsselte Nachfolger (Nachtrag 155). */
        val AUTH_TOKEN_ENC = stringPreferencesKey("auth_token_enc")
        val USERNAME     = stringPreferencesKey("username")
        val CURRENCY     = stringPreferencesKey("currency")
        // "system" (folgt der OS-Sprache), "en" oder "de"
        val LANGUAGE     = stringPreferencesKey("language")
        /**
         * Das zuletzt bekannte Design des Servers — "classic" oder "brick".
         *
         * ── Warum es gemerkt wird (Nachtrag 135) ─────────────────────────────
         *
         * `app_theme` ist eine GLOBALE Einstellung des Servers und kam bisher
         * nur mit /settings, also erst NACH der Anmeldung. Anmelde- und
         * Einrichtungsbildschirm erschienen dadurch bei jedem Kaltstart im
         * Standard-Design und sprangen nach dem Anmelden um.
         *
         * Die Webapp hat genau dieses Flackern in zwei Stufen behoben
         * (public/js/00-theme-boot.js): erst der gemerkte Wert ohne Netz, dann
         * asynchron die oeffentliche Adresse /api/v1/settings/theme. Hier
         * dasselbe — dies ist Stufe eins.
         *
         * Nicht nutzerbezogen: Das Design gilt fuer alle, es ist keine
         * persoenliche Einstellung. Deshalb ueberlebt es auch das Abmelden.
         */
        val APP_THEME    = stringPreferencesKey("app_theme")
    }

    val serverUrl: Flow<String> = context.dataStore.data.map { prefs ->
        val raw = prefs[SERVER_URL] ?: ""
        // Normalize scheme to lowercase (e.g. HTTPs → https)
        if (raw.contains("://")) {
            val idx = raw.indexOf("://")
            raw.substring(0, idx).lowercase() + raw.substring(idx)
        } else raw
    }
    /**
     * Das Bearer-Token im Klartext — für Aufrufer unverändert.
     *
     * ── Übernahme der Altbestände (Nachtrag 155) ─────────────────────────────
     * Vor dieser Änderung lag das Token unverschlüsselt unter AUTH_TOKEN. Wer
     * die App schon benutzt, hat es genau dort. Würde hier nur noch
     * AUTH_TOKEN_ENC gelesen, wäre jede bestehende Installation beim nächsten
     * Start abgemeldet — für eine Verbesserung, die niemand angefordert hat,
     * ein zu hoher Preis.
     *
     * Deshalb: Erst den verschlüsselten Wert versuchen, sonst den alten
     * Klartext nehmen. Das eigentliche Umschreiben passiert in
     * uebernehmeAltesToken(), nicht hier — ein Lesepfad darf nicht schreiben.
     */
    val authToken: Flow<String> = context.dataStore.data.map { prefs ->
        prefs[AUTH_TOKEN_ENC]?.let { tresor.entschluessle(it) }
            ?: prefs[AUTH_TOKEN]
            ?: ""
    }
    val username:  Flow<String> = context.dataStore.data.map { it[USERNAME]   ?: "" }
    val currency:  Flow<String> = context.dataStore.data.map { it[CURRENCY]   ?: "EUR" }
    val language:  Flow<String> = context.dataStore.data.map { it[LANGUAGE]   ?: "system" }
    val appTheme:  Flow<String> = context.dataStore.data.map { it[APP_THEME]  ?: "classic" }

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
    /**
     * Token ablegen — ab jetzt ausschliesslich verschlüsselt.
     *
     * Der alte Klartext-Eintrag wird im selben Zug ENTFERNT. Ohne das bliebe
     * er neben dem verschlüsselten stehen und wäre weiterhin auslesbar; die
     * Verschlüsselung wäre dann Zierde.
     */
    suspend fun saveAuthToken(token: String) {
        val geheim = tresor.verschluessle(token)
        context.dataStore.edit {
            it[AUTH_TOKEN_ENC] = geheim
            it.remove(AUTH_TOKEN)
        }
    }

    /**
     * Ein noch im Klartext liegendes Token einmalig verschlüsselt neu ablegen.
     *
     * Wird beim App-Start aufgerufen. Bewusst getrennt vom Lesepfad: `authToken`
     * ist ein Flow, den beliebig viele Sammler beobachten — ein Schreibvorgang
     * darin liefe mehrfach und mitten in der Auswertung.
     *
     * @return true, wenn tatsächlich etwas übernommen wurde (für Tests und
     *         Protokoll); false, wenn nichts zu tun war.
     */
    suspend fun uebernehmeAltesToken(): Boolean {
        var uebernommen = false
        context.dataStore.edit { prefs ->
            val alt = prefs[AUTH_TOKEN]
            if (alt != null && alt.isNotEmpty()) {
                prefs[AUTH_TOKEN_ENC] = tresor.verschluessle(alt)
                prefs.remove(AUTH_TOKEN)
                uebernommen = true
            } else if (alt != null) {
                // Leerer Alteintrag: nichts zu verschlüsseln, aber weg damit.
                prefs.remove(AUTH_TOKEN)
            }
        }
        return uebernommen
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
    suspend fun saveAppTheme(theme: String) {
        // Unbekannte Werte NICHT schreiben: "" oder null heisst „keine
        // Information" und darf den gemerkten Wert nicht loeschen — dieselbe
        // Regel wie applyTheme() in 00-theme-boot.js.
        if (theme == "classic" || theme == "brick") {
            context.dataStore.edit { it[APP_THEME] = theme }
        }
    }
    suspend fun clearSession() {
        context.dataStore.edit {
            // BEIDE Schlüssel: Bliebe der alte stehen, wäre man nach dem
            // Abmelden über den Altbestand wieder angemeldet.
            it.remove(AUTH_TOKEN)
            it.remove(AUTH_TOKEN_ENC)
            it.remove(USERNAME)
        }
    }
}
