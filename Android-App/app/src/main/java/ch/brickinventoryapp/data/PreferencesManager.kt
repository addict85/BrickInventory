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
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "app_prefs")

@Singleton
class PreferencesManager @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val tresor: TokenVerschluesselung,
) {
    companion object {
        /**
         * Der synchron lesbare Spiegel des Designs — eigene Datei, damit er
         * nichts anderes beruehrt. Warum es ihn gibt, steht bei
         * gemerktesDesign() weiter unten.
         */
        /**
         * Welche Designs es gibt. Dieselbe Liste wie ALLOWED in
         * js/00-theme-boot.js, die Whitelist in routes/settings.ts und die
         * Dateien unter public/themes/ — theme.test.js haelt sie zusammen.
         *
         * Unbekannte Werte werden NICHT gemerkt: "" oder null heisst „keine
         * Information" und darf den gemerkten Wert nicht loeschen.
         */
        val ERLAUBTE_DESIGNS = setOf("classic", "brick", "werkbank", "farbfaecher")

        const val DESIGN_SPIEGEL_DATEI = "design_spiegel"
        const val APP_THEME_SPIEGEL = "app_theme"

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

    // ── Warum diese beiden nicht mehr blosse stateIn() sind (Marcos Befund) ──
    //
    // „Wenn ich mich neu in der Android-App einlogge erscheint: ‚Ungültiges
    // oder abgelaufenes Token'. Ich werde aber trotzdem eingeloggt."
    //
    // Beides zugleich hat einen Grund, und er steht hier. `stateIn()` spiegelt
    // den DataStore — die Spiegelung folgt der Schreibung aber ERST, wenn der
    // DataStore geschrieben hat und sein Fluss ausgegeben hat. Das ist eine
    // Plattenschreibung auf Dispatchers.IO, also Millisekunden bis
    // Zehntelsekunden.
    //
    // login() macht in genau diesem Fenster weiter:
    //
    //     prefs.saveAuthToken(neu)      // DataStore-Schreibung angestossen
    //     _state.update { isLoggedIn = true }
    //     loadDashboard()               // feuert SOFORT Anfragen
    //
    // Der Interceptor (AppModule.kt) liest `authTokenState.value` — und das
    // trug in diesem Moment noch den ALTEN Wert. Bei einer frischen Anmeldung
    // ist der leer, also ging die Anfrage OHNE Authorization-Kopf raus.
    // requireToken beantwortet das mit 401 und `token_ungueltig`, und
    // loadSets() zeigt den Text des Servers als Meldung an. Angemeldet war man
    // trotzdem — die Anmeldung selbst war ja gelungen.
    //
    // Deshalb ist der Speicherwert jetzt die FUEHRENDE Fassung: saveAuthToken()
    // und saveServerUrl() setzen ihn, bevor sie schreiben, und der DataStore
    // fuellt ihn beim Start und bei Aenderungen von aussen nach. Damit sieht
    // der Interceptor den neuen Wert in derselben Anweisungsfolge, in der er
    // gesetzt wurde.
    //
    // Dasselbe galt fuer die Server-Adresse: loginWithQrToken() speichert sie
    // und loest den QR-Code unmittelbar danach ein — der Aufruf ging bis
    // hierher an den VORHERIGEN Server, der die Nonce nicht kennt.
    //
    // null = DataStore noch nicht gelesen (nur ganz kurz beim Kaltstart).
    private val _serverUrlState = MutableStateFlow<String?>(null)
    val serverUrlState: StateFlow<String?> = _serverUrlState.asStateFlow()
    private val _authTokenState = MutableStateFlow<String?>(null)
    val authTokenState: StateFlow<String?> = _authTokenState.asStateFlow()

    init {
        // Der Nachlauf aus dem DataStore: fuer den Kaltstart und fuer
        // Aenderungen, die NICHT ueber die beiden save-Funktionen kamen (etwa
        // die einmalige Uebernahme eines alten Klartext-Tokens).
        prefsScope.launch { serverUrl.collect { _serverUrlState.value = it } }
        prefsScope.launch { authToken.collect { _authTokenState.value = it } }
    }

    suspend fun saveServerUrl(url: String) {
        // Normalize: lowercase scheme (http/https), trim trailing slash
        val normalized = url.trim().trimEnd('/').let { u ->
            if (u.contains("://")) {
                val idx = u.indexOf("://")
                u.substring(0, idx).lowercase() + u.substring(idx)
            } else u
        }
        // ZUERST in den Speicher, dann auf die Platte — siehe der Block ueber
        // serverUrlState. Umgekehrt liest der Interceptor waehrend der
        // Schreibung noch die alte Adresse.
        _serverUrlState.value = normalized
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
        // ZUERST in den Speicher: Der Aufrufer feuert unmittelbar nach dieser
        // Funktion die ersten Anfragen, und der Interceptor liest den Wert
        // synchron. Die ausfuehrliche Begruendung steht ueber authTokenState.
        _authTokenState.value = token
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
        if (theme in ERLAUBTE_DESIGNS) {
            context.dataStore.edit { it[APP_THEME] = theme }
            // Und in den synchron lesbaren Spiegel, siehe gemerktesDesign().
            // Beides an EINER Stelle, damit die zwei Ablagen nicht
            // auseinanderlaufen koennen.
            designSpiegel.edit().putString(APP_THEME_SPIEGEL, theme).apply()
        }
    }

    // ── Der synchron lesbare Spiegel des Designs (Marcos Befund) ─────────────
    //
    // „Beim Starten der App sieht man teilweise das andere Design, insbesondere
    // wenn die Internetverbindung schlecht ist."
    //
    // Der gemerkte Wert lag nur im DataStore, und der laesst sich ausschliesslich
    // ASYNCHRON lesen. MainActivity.setContent() laeuft aber sofort — die ersten
    // Bilder entstanden deshalb immer im Vorgabewert "classic", und erst danach
    // traf der gemerkte Wert ein. Bei schlechtem Netz dauert der Kaltstart
    // laenger, konkurriert mehr um Haupt-Thread und Platte, und das Fenster
    // wird sichtbar.
    //
    // Die Webapp hat dasselbe Problem laengst geloest: js/00-theme-boot.js ist
    // ein BLOCKIERENDES Skript im <head>, das den zuletzt bekannten Wert aus
    // localStorage holt, bevor irgendetwas gezeichnet wird. SharedPreferences
    // ist das Gegenstueck dazu — sie lassen sich synchron lesen, und genau dafuer
    // benutzt sie auch Android selbst (AppCompatDelegate merkt sich so den
    // Nachtmodus).
    //
    // Der erste Zugriff liest eine winzige Datei vom Hauptthread. Das ist der
    // Preis fuer „kein falsches Bild", und es ist derselbe Handel, den das
    // Boot-Skript der Webapp eingeht.
    //
    // DataStore bleibt die fuehrende Ablage: Der Spiegel wird nur geschrieben,
    // wenn dort geschrieben wird, und nur gelesen, wenn es synchron sein muss.
    private val designSpiegel by lazy {
        context.getSharedPreferences(DESIGN_SPIEGEL_DATEI, Context.MODE_PRIVATE)
    }

    /**
     * Das zuletzt bekannte Design — SYNCHRON, fuer den allerersten Bildaufbau.
     *
     * Kennt der Spiegel nichts (Neuinstallation), bleibt es beim Standard;
     * dann gibt es auch kein „anderes Design", das aufblitzen koennte.
     */
    fun gemerktesDesign(): String =
        designSpiegel.getString(APP_THEME_SPIEGEL, null) ?: "classic"
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
