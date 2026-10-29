package ch.brickinventoryapp.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import ch.brickinventoryapp.util.TokenVerschluesselung
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.first
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
) : Anmeldeablage, ch.brickinventoryapp.data.cache.CacheBesitzer {
    companion object {
        /**
         * Der synchron lesbare Spiegel des Designs — eigene Datei, damit er
         * nichts anderes beruehrt. Warum es ihn gibt, steht bei
         * gemerktesDesign() weiter unten.
         */
        /**
         * Welche Designs es gibt — dieselbe Liste wie ALLOWED in js/00-theme-boot.js, die
         * Whitelist in routes/settings.ts und public/themes/ (theme.test.js hält sie
         * zusammen). Unbekannte Werte werden nicht gemerkt: "" oder null heisst „keine
         * Information“ und darf den gemerkten Wert nicht löschen.
         */
        val ERLAUBTE_DESIGNS = setOf("classic", "brick", "werkbank", "farbfaecher", "noppe", "hochglanz")

        const val DESIGN_SPIEGEL_DATEI = "design_spiegel"
        const val DUNKEL_NACH_SYSTEM = "dunkel_nach_system"
        const val APP_THEME_SPIEGEL = "app_theme"
        const val SPRACHE_SPIEGEL = "sprache"
        const val NUTZER_CA = "nutzer_ca"

        /**
         * In welchen Netzen darf das Vorwärmen der Vorschaubilder holen? Auf dem Gerät,
         * nicht beim Konto: Am Telefon mit knappem Tarif will man es anders als am Tablet.
         * Die drei Schalter sind unabhängig, je einer für eine Lage; eine versteckte
         * Kopplung sähe aus wie ein kaputter Schalter.
         */
        val VORWAERMEN_WLAN    = booleanPreferencesKey("vorwaermen_wlan")
        val VORWAERMEN_MOBIL   = booleanPreferencesKey("vorwaermen_mobil")
        val VORWAERMEN_ROAMING = booleanPreferencesKey("vorwaermen_roaming")

        val SERVER_URL   = stringPreferencesKey("server_url")
        /** Hosts, zu denen der Nutzer Klartext ausdrücklich erlaubt hat (NetworkPolicy). */
        val KLARTEXT_HOSTS = stringSetPreferencesKey("klartext_hosts")
        val KLARTEXT_ALT_UEBERNOMMEN = booleanPreferencesKey("klartext_alt_uebernommen")
        /**
         * Der alte Klartext-Schlüssel: Auf Geräten mit älterer Fassung liegt das Token
         * dort. Er wird nur noch einmal zur Übernahme gelesen und dann entfernt;
         * geschrieben wird AUTH_TOKEN_ENC.
         */
        val AUTH_TOKEN     = stringPreferencesKey("auth_token")

        /** Der verschlüsselte Nachfolger. */
        val AUTH_TOKEN_ENC = stringPreferencesKey("auth_token_enc")
        /** Der Server, der den Token ausgab (NetworkPolicy.herkunft); nur dorthin geht er. */
        val TOKEN_HERKUNFT = stringPreferencesKey("token_herkunft")
        /** „Server|Netz“, in denen eine Klartext-Anmeldung eingerichtet oder bestätigt wurde. */
        val KLARTEXT_NETZE = stringSetPreferencesKey("klartext_netze")
        val USERNAME     = stringPreferencesKey("username")
        val CURRENCY     = stringPreferencesKey("currency")
        // "system" (folgt der OS-Sprache), "en" oder "de"
        val LANGUAGE     = stringPreferencesKey("language")
        /**
         * Das zuletzt bekannte Design des Servers. Gemerkt, weil /settings erst nach der
         * Anmeldung kommt und Anmelde- und Einrichtungsbildschirm sonst im Standard-Design
         * erschienen und umsprangen — Stufe eins wie in public/js/00-theme-boot.js.
         * Global, deshalb überlebt es das Abmelden.
         */
        val APP_THEME    = stringPreferencesKey("app_theme")

        /**
         * Sollen ausgelöste Preisalarme als Benachrichtigung erscheinen? Je Gerät: Mit
         * Telefon und Tablet will man die Meldung meist nur an einem. Vorgabe aus —
         * ungefragte Benachrichtigungen wären eine Überraschung, und ab Android 13 braucht
         * es ohnehin die Erlaubnis.
         */
        val ALARM_MELDUNGEN = booleanPreferencesKey("alarm_meldungen")

        /**
         * Der Zeitpunkt des letzten erfolgreichen Abrufs, als ISO-Text vom Server — nicht
         * die Uhr des Telefons, deren Abweichung über doppelte oder fehlende Meldungen
         * entschiede (siehe Alarmabholung). Text, weil nur weitergereicht wird und eine
         * Umrechnung die Zeitzone verlöre.
         */
        val ALARM_MARKE = stringPreferencesKey("alarm_marke")
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
     * Das Bearer-Token im Klartext. Erst der verschlüsselte Wert, sonst der alte
     * Klartext — sonst wäre jede ältere Installation nach dem Update abgemeldet.
     * Umgeschrieben wird in uebernehmeAltesToken(); ein Lesepfad schreibt nicht.
     */
    val authToken: Flow<String> = context.dataStore.data.map { prefs ->
        prefs[AUTH_TOKEN_ENC]?.let { tresor.entschluessle(it) }
            ?: prefs[AUTH_TOKEN]
            ?: ""
    }
    val username:  Flow<String> = context.dataStore.data.map { it[USERNAME]   ?: "" }
    val currency:  Flow<String> = context.dataStore.data.map { it[CURRENCY]   ?: "EUR" }
    val language:  Flow<String> = context.dataStore.data.map { it[LANGUAGE]   ?: "system" }

    // Vorgabe: nur WLAN. Begruendung an den Schluesseln oben. `?: true` bzw.
    // `?: false` ist hier die ganze Vorgabe — ein noch nie gesetzter Wert ist
    // in DataStore schlicht nicht da.
    val vorwaermenWlan:    Flow<Boolean> = context.dataStore.data.map { it[VORWAERMEN_WLAN]    ?: true }
    val vorwaermenMobil:   Flow<Boolean> = context.dataStore.data.map { it[VORWAERMEN_MOBIL]   ?: false }
    val vorwaermenRoaming: Flow<Boolean> = context.dataStore.data.map { it[VORWAERMEN_ROAMING] ?: false }
    val appTheme:  Flow<String> = context.dataStore.data.map { it[APP_THEME]  ?: "classic" }

    // Vorgabe AUS — Begruendung am Schluessel oben.
    val alarmMeldungenAn: Flow<Boolean> = context.dataStore.data.map { it[ALARM_MELDUNGEN] ?: false }
    /**
     * null = noch nie abgerufen: Beim allerersten Durchgang markiert Alarmabholung nur
     * und meldet nichts. Ein leerer Text brächte alles Alte auf einmal.
     */
    val alarmMarke: Flow<String?> = context.dataStore.data.map { it[ALARM_MARKE] }

    // ── In-Memory-Cache für den OkHttp-Interceptor ────────────────────────────
    // Der Interceptor läuft auf OkHttp-Dispatcher-Threads und darf dort nicht
    // blockieren. Diese StateFlows spiegeln DataStore-Werte im Speicher, sodass
    // pro Request nur ein synchroner .value-Read nötig ist (statt runBlocking).
    // null = DataStore noch nicht gelesen (nur ganz kurz beim Kaltstart).
    private val prefsScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    // Der Speicherwert führt, der DataStore folgt: Die Anmeldung feuert sofort
    // Abrufe, und ein nachlaufender Wert gäbe dem Interceptor den alten Token.
    // null = DataStore noch nicht gelesen (nur kurz beim Kaltstart).
    private val _serverUrlState = MutableStateFlow<String?>(null)
    val serverUrlState: StateFlow<String?> = _serverUrlState.asStateFlow()
    private val _authTokenState = MutableStateFlow<String?>(null)
    val authTokenState: StateFlow<String?> = _authTokenState.asStateFlow()
    private val _tokenHerkunftState = MutableStateFlow<String?>(null)
    /** Leer = Altbestand ohne Bindung; dann gilt der eingetragene Server. */
    val tokenHerkunftState: StateFlow<String?> = _tokenHerkunftState.asStateFlow()

    // Vier Spiegel: Adresse, Token, Herkunft, Klartext-Hosts. Erst wenn jeder
    // einmal von der Platte kam, ist der Kaltstart vorbei.
    private val startGelesen = java.util.concurrent.CountDownLatch(4)

    /**
     * Für den Interceptor auf OkHttp-Threads: wartet beim Kaltstart auf den ersten
     * Stand der Platte, ohne Koroutine und höchstens fünf Sekunden.
     */
    fun warteAufStart() {
        startGelesen.await(5, java.util.concurrent.TimeUnit.SECONDS)
    }

    private fun <T> spiegle(fluss: Flow<T>, ziel: MutableStateFlow<T?>) = prefsScope.launch {
        var erster = true
        fluss.collect {
            ziel.value = it
            if (erster) { erster = false; startGelesen.countDown() }
        }
    }

    /**
     * Der Token, wie er jetzt gilt — nicht, wie er zuletzt auf der Platte stand.
     * `authToken` läuft der Schreibung nach; jeder Abruf, der ihn im Fenster nach dem
     * Anmelden liest, ginge ohne Token hinaus. Deshalb lesen SSE-Klienten, CSV-Dienst,
     * PDF-Export und Preisalarm-Arbeiter alle hier: erst der Speicherwert, nur beim
     * Kaltstart die Platte.
     */
    suspend fun tokenJetzt(): String = _authTokenState.value ?: authToken.first()

    /** Dieselbe Regel fuer die Server-Adresse — aus demselben Grund. */
    override suspend fun serverUrlJetzt(): String = _serverUrlState.value ?: serverUrl.first()

    /**
     * Der Bereich des Antwort-Caches: Server und Token. Der Token gehört genau
     * einem Konto, und er wechselt bei jeder Anmeldung — schon in dem Moment,
     * in dem der Interceptor ihn liest, nicht erst nach dem Benutzernamen.
     */
    override suspend fun cacheBereich(): String? {
        val server = serverUrlJetzt().trim().trimEnd('/')
        val token = tokenJetzt()
        return if (server.isBlank() || token.isBlank()) null else "$server\n$token"
    }

    /** Synchron lesbar für den Interceptor, wie serverUrlState; null = noch nicht gelesen. */
    private val _klartextHosts = MutableStateFlow<Set<String>?>(null)
    val klartextHostsState: StateFlow<Set<String>?> = _klartextHosts.asStateFlow()

    /** Für den Kaltstart: erst die einmalige Übernahme, dann die Platte. */
    suspend fun klartextHostsJetzt(): Set<String> = _klartextHosts.value ?: run {
        uebernimmAltenKlartextHost()
        context.dataStore.data.first()[KLARTEXT_HOSTS] ?: emptySet()
    }

    override suspend fun bestaetigeKlartext(host: String) {
        val h = host.lowercase()
        _klartextHosts.value = (_klartextHosts.value ?: emptySet()) + h
        context.dataStore.edit { it[KLARTEXT_HOSTS] = (it[KLARTEXT_HOSTS] ?: emptySet()) + h }
    }

    /**
     * Einmalig beim ersten Start mit der Bestätigungsregel: Die schon
     * eingerichtete Adresse gilt als bestätigt — sie wurde mit der Warnung
     * gewählt, und ein Update soll die App nicht vom eigenen Server trennen.
     */
    private suspend fun uebernimmAltenKlartextHost() {
        context.dataStore.edit { prefs ->
            if (prefs[KLARTEXT_ALT_UEBERNOMMEN] == true) return@edit
            prefs[KLARTEXT_ALT_UEBERNOMMEN] = true
            val host = ch.brickinventoryapp.util.NetworkPolicy.klartextHost(prefs[SERVER_URL] ?: "") ?: return@edit
            prefs[KLARTEXT_HOSTS] = (prefs[KLARTEXT_HOSTS] ?: emptySet()) + host
        }
    }

    init {
        // Der Nachlauf aus dem DataStore: für den Kaltstart und für Änderungen,
        // die nicht über die save-Funktionen kamen (Übernahme eines alten Tokens).
        spiegle(serverUrl, _serverUrlState)
        spiegle(authToken, _authTokenState)
        spiegle(context.dataStore.data.map { it[TOKEN_HERKUNFT] }, _tokenHerkunftState)
        prefsScope.launch {
            uebernimmAltenKlartextHost()
            uebernimmAltenCaStand()
            spiegle(context.dataStore.data.map { it[KLARTEXT_HOSTS] ?: emptySet() }, _klartextHosts)
        }
    }

    override suspend fun bekannteNetze(): Set<String> =
        context.dataStore.data.first()[KLARTEXT_NETZE] ?: emptySet()

    override suspend fun merkeNetz(eintrag: String) {
        context.dataStore.edit { it[KLARTEXT_NETZE] = (it[KLARTEXT_NETZE] ?: emptySet()) + eintrag }
    }

    override suspend fun saveServerUrl(url: String) {
        // Normalize: lowercase scheme (http/https), trim trailing slash
        val normalized = url.trim().trimEnd('/').let { u ->
            if (u.contains("://")) {
                val idx = u.indexOf("://")
                u.substring(0, idx).lowercase() + u.substring(idx)
            } else u
        }
        // Zuerst in den Speicher, dann auf die Platte (siehe serverUrlState).
        // Ein anderer Server beendet die Sitzung: Der Token gehört dem alten.
        val herkunft = _tokenHerkunftState.value ?: serverUrlJetzt()
        val anderer = tokenJetzt().isNotBlank() &&
            !ch.brickinventoryapp.util.NetworkPolicy.gleicheHerkunft(herkunft, normalized)
        if (anderer) { _authTokenState.value = ""; _tokenHerkunftState.value = null }
        _serverUrlState.value = normalized
        context.dataStore.edit {
            it[SERVER_URL] = normalized
            if (anderer) { it.remove(AUTH_TOKEN); it.remove(AUTH_TOKEN_ENC); it.remove(TOKEN_HERKUNFT); it.remove(USERNAME) }
        }
    }
    /**
     * Token ablegen, nur noch verschlüsselt. Der alte Klartext-Eintrag wird im selben
     * Zug entfernt — sonst bliebe er auslesbar, und die Verschlüsselung wäre Zierde.
     */
    override suspend fun saveAuthToken(token: String) {
        // ZUERST in den Speicher: Der Aufrufer feuert unmittelbar nach dieser
        // Funktion die ersten Anfragen, und der Interceptor liest den Wert
        // synchron. Die ausfuehrliche Begruendung steht ueber authTokenState.
        val herkunft = ch.brickinventoryapp.util.NetworkPolicy.herkunft(serverUrlJetzt())
        _tokenHerkunftState.value = herkunft
        _authTokenState.value = token
        val geheim = tresor.verschluessle(token)
        context.dataStore.edit {
            it[AUTH_TOKEN_ENC] = geheim
            it.remove(AUTH_TOKEN)
            if (herkunft != null) it[TOKEN_HERKUNFT] = herkunft else it.remove(TOKEN_HERKUNFT)
        }
    }

    /**
     * Ein noch im Klartext liegendes Token einmalig verschlüsselt neu ablegen, beim
     * App-Start. Getrennt vom Lesepfad, weil `authToken` viele Sammler hat und ein
     * Schreiben darin mehrfach liefe.
     *
     * @return true, wenn etwas übernommen wurde; false, wenn nichts zu tun war.
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
    override suspend fun saveUsername(name: String) {
        context.dataStore.edit { it[USERNAME] = name }
    }
    suspend fun saveCurrency(cur: String) {
        context.dataStore.edit { it[CURRENCY] = cur }
    }
    /**
     * Eine der drei Netzerlaubnisse setzen — eine Funktion mit dem Schlüssel als
     * Argument statt dreier fast gleicher, die auseinanderlaufen könnten.
     */
    suspend fun saveVorwaermenNetz(schluessel: Preferences.Key<Boolean>, erlaubt: Boolean) {
        context.dataStore.edit { it[schluessel] = erlaubt }
    }

    /**
     * Die Marke fortschreiben. Leere Werte werden nicht geschrieben, sonst ginge die
     * Unterscheidung „noch nie abgerufen“ verloren.
     */
    suspend fun setzeAlarmMarke(marke: String) {
        if (marke.isBlank()) return
        context.dataStore.edit { it[ALARM_MARKE] = marke }
    }

    suspend fun setzeAlarmMeldungen(an: Boolean) {
        context.dataStore.edit { it[ALARM_MELDUNGEN] = an }
    }

    suspend fun saveLanguage(lang: String) {
        context.dataStore.edit { it[LANGUAGE] = lang }
        designSpiegel.edit().putString(SPRACHE_SPIEGEL, lang).apply()
    }

    /**
     * Die Sprache synchron für Application.onCreate (unter Android 13), ohne den
     * DataStore zu blockieren. null = vor dem Spiegel gespeichert; dann liest
     * [spracheNachziehen] sie einmal nach.
     */
    fun gemerkteSprache(): String? = designSpiegel.getString(SPRACHE_SPIEGEL, null)

    suspend fun spracheNachziehen(): String {
        val lang = language.first()
        designSpiegel.edit().putString(SPRACHE_SPIEGEL, lang).apply()
        return lang
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

    // Synchron lesbarer Spiegel des Designs (SharedPreferences): setContent() läuft
    // vor dem ersten DataStore-Wert, und das erste Bild entstünde sonst im
    // Standard-Design. Der DataStore bleibt führend.
    private val designSpiegel by lazy {
        context.getSharedPreferences(DESIGN_SPIEGEL_DATEI, Context.MODE_PRIVATE)
    }

    /**
     * Das zuletzt bekannte Design — synchron, für den allerersten Bildaufbau. Ohne
     * Eintrag (Neuinstallation) gilt der Standard.
     */
    fun gemerktesDesign(): String =
        designSpiegel.getString(APP_THEME_SPIEGEL, null) ?: "classic"

    /**
     * „Dunkel, wenn das System dunkel ist“ — je Gerät. Im Spiegel, weil es wie das
     * Design schon das erste Bild bestimmt; ohne gespeicherte Wahl folgt die App dem
     * System (dunkelNachSystemGilt).
     */
    fun dunkelNachSystem(): Boolean = ch.brickinventoryapp.ui.theme.dunkelNachSystemGilt(
        if (designSpiegel.contains(DUNKEL_NACH_SYSTEM)) designSpiegel.getBoolean(DUNKEL_NACH_SYSTEM, true) else null)
    /**
     * Vertrauen die Clients des eigenen Servers auch nutzerinstallierten CAs
     * (util/ServerVertrauen.kt)? Je Gerät und synchron: Gefragt wird bei jedem
     * Verbindungsaufbau.
     */
    fun nutzerCaErlaubt(): Boolean = designSpiegel.getBoolean(NUTZER_CA, false)
    fun setzeNutzerCa(an: Boolean) {
        designSpiegel.edit().putBoolean(NUTZER_CA, an).apply()
    }

    /** Einmalig vor dem ersten Verbindungsaufbau (der Latch wartet darauf); siehe nutzerCaVorgabe. */
    private suspend fun uebernimmAltenCaStand() {
        if (designSpiegel.contains(NUTZER_CA)) return
        setzeNutzerCa(ch.brickinventoryapp.util.nutzerCaVorgabe(context.dataStore.data.first()[SERVER_URL] ?: ""))
    }

    fun setzeDunkelNachSystem(an: Boolean) {
        designSpiegel.edit().putBoolean(DUNKEL_NACH_SYSTEM, an).apply()
    }
    suspend fun clearSession() {
        _authTokenState.value = ""
        _tokenHerkunftState.value = null
        context.dataStore.edit {
            // BEIDE Schlüssel: Bliebe der alte stehen, wäre man nach dem
            // Abmelden über den Altbestand wieder angemeldet.
            it.remove(AUTH_TOKEN)
            it.remove(AUTH_TOKEN_ENC)
            it.remove(TOKEN_HERKUNFT)
            it.remove(USERNAME)
        }
    }
}
