package ch.brickinventoryapp.data

import android.content.Context
import androidx.core.content.edit
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import ch.brickinventoryapp.util.TokenVerschluesselung
import ch.brickinventoryapp.util.liesToken
import dagger.hilt.android.qualifiers.ApplicationContext
import ch.brickinventoryapp.di.ApplicationScope
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.transformLatest
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton
import ch.brickinventoryapp.ui.theme.helligkeitGilt
import ch.brickinventoryapp.util.NetworkPolicy
import ch.brickinventoryapp.util.UpdateStand
import ch.brickinventoryapp.util.UpdateStandAblage
import ch.brickinventoryapp.util.pinSchluessel
import ch.brickinventoryapp.data.cache.CacheBesitzer

val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "app_prefs")

@Singleton
class PreferencesManager @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val tresor: TokenVerschluesselung,
    /** Die Spiegel laufen, solange die App lebt; kein eigener Bereich ohne Besitzer. */
    @param:ApplicationScope private val prefsScope: CoroutineScope,
) : Anmeldeablage, CacheBesitzer, Entwertungsquelle,
    UpdateStandAblage, GeraeteEinstellungen, Sitzungsablage,
    Darstellungsablage, Vertrauensablage, Zugangsdaten, Anmeldestand, Sitzungsende {
    companion object {
        /**
         * Welche Designs es gibt — dieselbe Liste wie ALLOWED in js/00-theme-boot.js, die
         * Whitelist in routes/settings.ts und public/themes/ (theme.test.js hält sie
         * zusammen). Unbekannte Werte werden nicht gemerkt: "" oder null heisst „keine
         * Information“ und darf den gemerkten Wert nicht löschen.
         */
        val ERLAUBTE_DESIGNS = setOf("classic", "brick", "werkbank", "farbfaecher", "noppe", "hochglanz")

        /**
         * Der synchron lesbare Spiegel des Designs — eigene Datei, damit er
         * nichts anderes beruehrt. Warum es ihn gibt, steht bei
         * gemerktesDesign() weiter unten.
         */
        const val DESIGN_SPIEGEL_DATEI = "design_spiegel"
        const val DUNKEL_NACH_SYSTEM = "dunkel_nach_system"
        const val HELLIGKEIT = "helligkeit"
        const val APP_THEME_SPIEGEL = "app_theme"
        const val SPRACHE_SPIEGEL = "sprache"
        const val NUTZER_CA = "nutzer_ca"
        /** Gesetzt, sobald die Vorgabe „Nutzer-CAs aus“ einmal angewandt wurde. */
        const val NUTZER_CA_AUS_ANGEWANDT = "nutzer_ca_aus_angewandt"
        const val PIN_PRAEFIX = "pin:"
        const val SYSTEMFARBEN = "systemfarben"
        const val VORSCHAU_VERBERGEN = "vorschau_verbergen"
        const val ENTWERTUNG_GESCHEITERT = "entwertung_gescheitert"
        const val WIDGET_WERTE = "widget_werte"

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
        /** Wann mit Passwort, Passkey oder QR angemeldet wurde; ein Tausch ändert es nicht. */
        val ANGEMELDET_AM = longPreferencesKey("angemeldet_am")
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

        /**
         * Der höchste gesehene versionCode und der späteste Ausstellungszeitpunkt einer
         * aktuellen Update-Beschreibung (util/UpdateFrische.kt). Je Gerät; das Abmelden
         * lässt sie stehen, sonst setzte es die Messlatte für ein Zurückhalten zurück.
         */
        val UPDATE_HOECHSTER_CODE = intPreferencesKey("update_hoechster_code")
        val UPDATE_AUSGESTELLT = longPreferencesKey("update_ausgestellt")
    }

    override val serverUrl: Flow<String> = context.dataStore.data.map { adresseAus(it) }

    /** Das Schema klein (HTTPs → https), wie es saveServerUrl ablegt. */
    private fun adresseAus(prefs: Preferences): String {
        val raw = prefs[SERVER_URL] ?: ""
        return if (raw.contains("://")) {
            val idx = raw.indexOf("://")
            raw.substring(0, idx).lowercase() + raw.substring(idx)
        } else raw
    }
    /**
     * Das Bearer-Token im Klartext. Erst der verschlüsselte Wert, sonst der alte
     * Klartext — sonst wäre jede ältere Installation nach dem Update abgemeldet.
     * Umgeschrieben wird in uebernehmeAltesToken(); ein Lesepfad schreibt nicht.
     * Ein gesperrter Keystore wird abgewartet und nachgeholt (util/Tresorbefund.liesToken).
     */
    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    override val authToken: Flow<String> = context.dataStore.data.map { prefs -> prefs[AUTH_TOKEN_ENC] to prefs[AUTH_TOKEN] }
        .distinctUntilChanged()
        .transformLatest { (geheim, alt) -> liesToken(tresor, geheim, alt, melde = { emit(it) }) }
    val username:  Flow<String> = context.dataStore.data.map { it[USERNAME]   ?: "" }
    override val currency:  Flow<String> = context.dataStore.data.map { it[CURRENCY]   ?: "EUR" }
    override val language:  Flow<String> = context.dataStore.data.map { it[LANGUAGE]   ?: "system" }

    // Vorgabe: nur WLAN. Begruendung an den Schluesseln oben. `?: true` bzw.
    // `?: false` ist hier die ganze Vorgabe — ein noch nie gesetzter Wert ist
    // in DataStore schlicht nicht da.
    val vorwaermenWlan:    Flow<Boolean> = context.dataStore.data.map { it[VORWAERMEN_WLAN]    ?: true }
    val vorwaermenMobil:   Flow<Boolean> = context.dataStore.data.map { it[VORWAERMEN_MOBIL]   ?: false }
    val vorwaermenRoaming: Flow<Boolean> = context.dataStore.data.map { it[VORWAERMEN_ROAMING] ?: false }
    override val appTheme:  Flow<String> = context.dataStore.data.map { it[APP_THEME]  ?: "classic" }

    // Vorgabe AUS — Begruendung am Schluessel oben.
    override val alarmMeldungenAn: Flow<Boolean> = context.dataStore.data.map { it[ALARM_MELDUNGEN] ?: false }
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

    // Der Speicherwert führt, der DataStore folgt: Die Anmeldung feuert sofort
    // Abrufe, und ein nachlaufender Wert gäbe dem Interceptor den alten Token.
    // null = DataStore noch nicht gelesen (nur kurz beim Kaltstart).
    private val _serverUrlState = MutableStateFlow<String?>(null)
    val serverUrlState: StateFlow<String?> = _serverUrlState.asStateFlow()
    private val _authTokenState = MutableStateFlow<String?>(null)
    override val authTokenState: StateFlow<String?> = _authTokenState.asStateFlow()
    private val _tokenHerkunftState = MutableStateFlow<String?>(null)
    /** Leer = Altbestand ohne Bindung; dann gilt der eingetragene Server. */
    val tokenHerkunftState: StateFlow<String?> = _tokenHerkunftState.asStateFlow()

    // Drei Spiegel (Adresse, Token, Herkunft) und die einmaligen Aufräumarbeiten:
    // Erst wenn alle vier durch sind, ist der Kaltstart vorbei und der erste
    // Verbindungsaufbau darf los.
    private val startGelesen = java.util.concurrent.CountDownLatch(4)

    /** Sperre und Generation für alle Schreibungen des Tokens (data/TokenTausch). Vor init: Die Spiegel brauchen sie. */
    private val tokenSchranke = TokenSchranke()

    /**
     * Für den Interceptor auf OkHttp-Threads: wartet beim Kaltstart auf den ersten
     * Stand der Platte, ohne Koroutine und höchstens fünf Sekunden.
     */
    fun warteAufStart() {
        startGelesen.await(5, java.util.concurrent.TimeUnit.SECONDS)
    }

    private fun <R, T> spiegle(roh: (Preferences) -> R, ziel: MutableStateFlow<T?>, lies: suspend (R, suspend (T) -> Unit) -> Unit) =
        prefsScope.launch {
            tokenSchranke.spiegle(context.dataStore.data, { context.dataStore.data.first() }, roh, lies,
                setze = { ziel.value = it }, gelesen = startGelesen::countDown)
        }

    /**
     * Der Token, wie er jetzt gilt — nicht, wie er zuletzt auf der Platte stand.
     * `authToken` läuft der Schreibung nach; jeder Abruf, der ihn im Fenster nach dem
     * Anmelden liest, ginge ohne Token hinaus. Deshalb lesen SSE-Klienten, CSV-Dienst,
     * PDF-Export und Preisalarm-Arbeiter alle hier: erst der Speicherwert, nur beim
     * Kaltstart die Platte.
     */
    override suspend fun tokenJetzt(): String = _authTokenState.value ?: authToken.first()

    /** Dieselbe Regel fuer die Server-Adresse — aus demselben Grund. */
    override suspend fun serverUrlJetzt(): String = _serverUrlState.value ?: serverUrl.first()

    /**
     * Der Bereich des Antwort-Caches: Server und Token. Der Token gehört genau
     * einem Konto, und er wechselt bei jeder Anmeldung — schon in dem Moment,
     * in dem der Interceptor ihn liest, nicht erst nach dem Benutzernamen.
     */
    override suspend fun kontoBereich(): String? {
        val server = serverUrlJetzt().trim().trimEnd('/')
        val token = tokenJetzt()
        if (server.isBlank() || token.isBlank()) return null
        val name = username.first()
        return "$server\n" + name.ifBlank { token }
    }

    override suspend fun cacheBereich(): String? {
        val server = serverUrlJetzt().trim().trimEnd('/')
        val token = tokenJetzt()
        return if (server.isBlank() || token.isBlank()) null else "$server\n$token"
    }

    // Synchron lesbarer Spiegel des Designs (SharedPreferences): setContent() läuft
    // vor dem ersten DataStore-Wert, und das erste Bild entstünde sonst im
    // Standard-Design. Der DataStore bleibt führend. Vor
    // init, weil die Übernahme dort im Hintergrund schon darauf zugreift.
    private val designSpiegel by lazy {
        context.getSharedPreferences(DESIGN_SPIEGEL_DATEI, Context.MODE_PRIVATE)
    }

    init {
        // Der Nachlauf aus dem DataStore: für den Kaltstart und für Änderungen,
        // die nicht über die save-Funktionen kamen (Übernahme eines alten Tokens).
        spiegle<String, String>(::adresseAus, _serverUrlState) { r, melde -> melde(r) }
        spiegle<Pair<String?, String?>, String>({ it[AUTH_TOKEN_ENC] to it[AUTH_TOKEN] }, _authTokenState) { (geheim, alt), melde ->
            liesToken(tresor, geheim, alt, melde)
        }
        spiegle<String?, String?>({ it[TOKEN_HERKUNFT] }, _tokenHerkunftState) { r, melde -> melde(r) }
        prefsScope.launch {
            try {
                uebernimmAltenCaStand()
                // Aufräumen ist Nebensache: Scheitert es, startet die App trotzdem.
                runCatching { context.dataStore.edit { KlartextReste.entferne(it) } }
                designSpiegel.edit { KlartextReste.SPIEGEL.forEach { remove(it) } }
            } finally {
                startGelesen.countDown()
            }
        }
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
        val neueHerkunft: suspend () -> Boolean = {
            val anders = !NetworkPolicy.gleicherServer(serverUrlJetzt(), normalized)
            // Laufende Aufrufe gehören dem alten Server; ihre Antworten sollen nichts mehr auslösen.
            if (anders) serverwechselHoerer.forEach { it() }
            anders
        }
        tokenSchranke.schreibe(neueSitzung = neueHerkunft) {
            // Die Herkunft hält nur Schema, Host und Port; ein anderer Pfad auf demselben
            // Host ist eine andere Anwendung, also zählt die bisherige Adresse mit.
            val herkunft = _tokenHerkunftState.value ?: serverUrlJetzt()
            val anderer = tokenJetzt().isNotBlank() &&
                (!NetworkPolicy.gleicheHerkunft(herkunft, normalized) ||
                    !NetworkPolicy.gleicherServer(serverUrlJetzt(), normalized))
            if (anderer) { _authTokenState.value = ""; _tokenHerkunftState.value = null }
            _serverUrlState.value = normalized
            context.dataStore.edit {
                it[SERVER_URL] = normalized
                if (anderer) {
                    it.remove(AUTH_TOKEN); it.remove(AUTH_TOKEN_ENC); it.remove(TOKEN_HERKUNFT); it.remove(USERNAME)
                    it.remove(ANGEMELDET_AM)
                }
            }
        }
    }
    /**
     * Token ablegen, nur noch verschlüsselt. Der alte Klartext-Eintrag wird im selben
     * Zug entfernt — sonst bliebe er auslesbar, und die Verschlüsselung wäre Zierde.
     */
    override suspend fun saveAuthToken(token: String) = tokenSchranke.schreibe {
        schreibeToken(token, NetworkPolicy.herkunft(serverUrlJetzt()), angemeldetAm = System.currentTimeMillis())
    }

    /**
     * ZUERST in den Speicher: Der Aufrufer feuert unmittelbar danach die ersten
     * Anfragen, und der Interceptor liest den Wert synchron. [angemeldetAm] nur
     * bei einer Anmeldung: Ein Tausch verlängert die Höchstdauer nicht.
     */
    private suspend fun schreibeToken(token: String, herkunft: String?, angemeldetAm: Long?) {
        _tokenHerkunftState.value = herkunft
        _authTokenState.value = token
        val geheim = tresor.verschluessle(token)
        context.dataStore.edit {
            it[AUTH_TOKEN_ENC] = geheim
            it.remove(AUTH_TOKEN)
            if (herkunft != null) it[TOKEN_HERKUNFT] = herkunft else it.remove(TOKEN_HERKUNFT)
            if (angemeldetAm != null) it[ANGEMELDET_AM] = angemeldetAm
        }
    }

    /** Für den Wächter (di/ServerWaechter): die Generation, vor dem Token gelesen. */
    fun tokenGeneration(): Long = tokenSchranke.generation

    private val serverwechselHoerer = java.util.concurrent.CopyOnWriteArrayList<() -> Unit>()
    private val nutzerCaHoerer = java.util.concurrent.CopyOnWriteArrayList<() -> Unit>()

    /** Die Server-Clients brechen beim Wechsel auf eine andere Herkunft ihre Aufrufe ab (di/ServerClient). */
    fun beimServerwechsel(hoerer: () -> Unit) { serverwechselHoerer += hoerer }

    /** Nach dem Umschalten der Nutzer-CAs: neuer TLS-Kontext, offene Verbindungen weg (di/ServerClient). */
    fun beimNutzerCaWechsel(hoerer: () -> Unit) { nutzerCaHoerer += hoerer }

    /** Für den Tausch: Herkunft wie im Wächter — ohne Bindung die eingetragene Adresse. */
    suspend fun tokenStand(): TokenStand {
        val herkunft = _tokenHerkunftState.value ?: context.dataStore.data.first()[TOKEN_HERKUNFT]
            ?: NetworkPolicy.herkunft(serverUrlJetzt())
        return TokenStand(tokenJetzt(), herkunft, tokenSchranke.generation)
    }

    /** Den getauschten Token nur ablegen, wenn seit Beginn des Tauschs nichts anderes geschah. */
    suspend fun ersetzeGetauschtenToken(vorher: TokenStand, neu: String, anfrageHerkunft: String?): Boolean =
        tokenSchranke.ersetzeFalls(vorher, anfrageHerkunft, ::tokenStand) {
            schreibeToken(neu, anfrageHerkunft, angemeldetAm = null)
        }

    /**
     * Ist die Anmeldung älter als [TOKEN_HOECHSTDAUER_TAGE]? Eine Anmeldung aus
     * einer Fassung ohne Datum beginnt jetzt zu zählen, statt sofort abzumelden.
     */
    override suspend fun anmeldungAbgelaufen(jetzt: Long): Boolean {
        val am = context.dataStore.data.first()[ANGEMELDET_AM]
        if (am == null) {
            if (tokenJetzt().isNotBlank()) context.dataStore.edit { it[ANGEMELDET_AM] = jetzt }
            return false
        }
        return anmeldungUeberfaellig(am, jetzt)
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
    override suspend fun saveCurrency(cur: String) {
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

    override suspend fun setzeAlarmMeldungen(an: Boolean) {
        context.dataStore.edit { it[ALARM_MELDUNGEN] = an }
    }

    override fun vorwaermenErlaubt(netz: VorwaermNetz): Flow<Boolean> = when (netz) {
        VorwaermNetz.WLAN -> vorwaermenWlan
        VorwaermNetz.MOBIL -> vorwaermenMobil
        VorwaermNetz.ROAMING -> vorwaermenRoaming
    }

    override suspend fun setzeVorwaermen(netz: VorwaermNetz, erlaubt: Boolean) = saveVorwaermenNetz(
        when (netz) {
            VorwaermNetz.WLAN -> VORWAERMEN_WLAN
            VorwaermNetz.MOBIL -> VORWAERMEN_MOBIL
            VorwaermNetz.ROAMING -> VORWAERMEN_ROAMING
        },
        erlaubt,
    )

    override suspend fun saveLanguage(lang: String) {
        context.dataStore.edit { it[LANGUAGE] = lang }
        designSpiegel.edit { putString(SPRACHE_SPIEGEL, lang) }
    }

    /**
     * Die Sprache synchron für Application.onCreate (unter Android 13), ohne den
     * DataStore zu blockieren. null = vor dem Spiegel gespeichert; dann liest
     * [spracheNachziehen] sie einmal nach.
     */
    fun gemerkteSprache(): String? = designSpiegel.getString(SPRACHE_SPIEGEL, null)

    suspend fun spracheNachziehen(): String {
        val lang = language.first()
        designSpiegel.edit { putString(SPRACHE_SPIEGEL, lang) }
        return lang
    }
    override suspend fun saveAppTheme(theme: String) {
        // Unbekannte Werte NICHT schreiben: "" oder null heisst „keine
        // Information" und darf den gemerkten Wert nicht loeschen — dieselbe
        // Regel wie applyTheme() in 00-theme-boot.js.
        if (theme in ERLAUBTE_DESIGNS) {
            context.dataStore.edit { it[APP_THEME] = theme }
            // Und in den synchron lesbaren Spiegel, siehe gemerktesDesign().
            // Beides an EINER Stelle, damit die zwei Ablagen nicht
            // auseinanderlaufen koennen.
            designSpiegel.edit { putString(APP_THEME_SPIEGEL, theme) }
        }
    }

    /**
     * Das zuletzt bekannte Design — synchron, für den allerersten Bildaufbau. Ohne
     * Eintrag (Neuinstallation) gilt der Standard.
     */
    override fun gemerktesDesign(): String =
        designSpiegel.getString(APP_THEME_SPIEGEL, null) ?: "classic"

    /**
     * System, Hell oder Dunkel — je Gerät. Im Spiegel, weil es wie das Design schon
     * das erste Bild bestimmt; ohne neue Wahl gilt die frühere „dunkel nach System“.
     */
    override fun helligkeit(): String = helligkeitGilt(
        designSpiegel.getString(HELLIGKEIT, null),
        if (designSpiegel.contains(DUNKEL_NACH_SYSTEM)) designSpiegel.getBoolean(DUNKEL_NACH_SYSTEM, true) else null)
    override fun setzeHelligkeit(wahl: String) {
        designSpiegel.edit { putString(HELLIGKEIT, wahl) }
    }
    /**
     * Vertrauen die Clients des eigenen Servers auch nutzerinstallierten CAs
     * (util/ServerVertrauen.kt)? Je Gerät und synchron: Gefragt wird bei jedem
     * Verbindungsaufbau.
     */
    override fun nutzerCaErlaubt(): Boolean = designSpiegel.getBoolean(NUTZER_CA, false)
    override fun setzeNutzerCa(an: Boolean) {
        designSpiegel.edit { putBoolean(NUTZER_CA, an) }
        nutzerCaHoerer.forEach { it() }
    }

    /**
     * Einmalig vor dem ersten Verbindungsaufbau (der Latch wartet darauf): Nutzer-CAs
     * aus, auch wenn sie vorher an waren. Wer sie braucht, wird beim ersten
     * TLS-Fehler gefragt (ZertifikatsFrage) — eine stille Erlaubnis aus einer
     * älteren Fassung soll nicht weiter gelten.
     */
    private fun uebernimmAltenCaStand() {
        if (designSpiegel.getBoolean(NUTZER_CA_AUS_ANGEWANDT, false)) return
        designSpiegel.edit { putBoolean(NUTZER_CA, false); putBoolean(NUTZER_CA_AUS_ANGEWANDT, true) }
    }

    // Pins je Host und Port (util/ServerVertrauen.kt). apply genügt: Der Speicher
    // gilt sofort für den nächsten Handshake, nur die Platte folgt nach.
    // Der vorgehaltene Pin (Anmeldeablage.halteVor) geht vor und lebt nur im Speicher.
    override fun pin(schluessel: String): String? = vorgehalten[schluessel] ?: gemerkterPin(schluessel)
    override fun gemerkterPin(schluessel: String): String? = designSpiegel.getString(PIN_PRAEFIX + schluessel, null)
    override fun merkePin(schluessel: String, fingerabdruck: String) {
        designSpiegel.edit { putString(PIN_PRAEFIX + schluessel, fingerabdruck) }
        vorgehalten.remove(schluessel)
    }
    override fun halteVor(schluessel: String, fingerabdruck: String) { vorgehalten[schluessel] = fingerabdruck }
    override fun vergissVorgehaltenen(schluessel: String) { vorgehalten.remove(schluessel) }
    private val vorgehalten = java.util.concurrent.ConcurrentHashMap<String, String>()

    /**
     * Geldwerte im Startbildschirm-Widget zeigen? Je Gerät, Vorgabe aus: Das Widget
     * ist ohne Entsperren für jeden lesbar, der das Telefon sieht.
     */
    override fun widgetWerteZeigen(): Boolean = designSpiegel.getBoolean(WIDGET_WERTE, false)
    override fun setzeWidgetWerteZeigen(an: Boolean) {
        designSpiegel.edit { putBoolean(WIDGET_WERTE, an) }
    }

    /** Material You statt der Farben des Designs; je Gerät, wirkt ab Android 12. */
    override fun systemfarben(): Boolean = designSpiegel.getBoolean(SYSTEMFARBEN, false)
    override fun setzeSystemfarben(an: Boolean) {
        designSpiegel.edit { putBoolean(SYSTEMFARBEN, an) }
    }

    /**
     * Kein Vorschaubild in der App-Übersicht, keine Bildschirmfotos; je Gerät. Vorgabe
     * an: Die Übersicht zeigt Bestand, Preise und Konto jedem, der das Telefon kurz
     * in der Hand hat. Wer Bildschirmfotos braucht, schaltet es aus.
     */
    override fun vorschauVerbergen(): Boolean = designSpiegel.getBoolean(VORSCHAU_VERBERGEN, true)
    override fun setzeVorschauVerbergen(an: Boolean) {
        designSpiegel.edit { putBoolean(VORSCHAU_VERBERGEN, an) }
    }

    /**
     * Server, an denen eine nachgeholte Abmeldung endgültig scheiterte. Die Meldung
     * des Arbeiters kann abgeschaltet sein; die App sagt es darum beim nächsten Start
     * noch einmal (AppViewModel), danach ist die Liste leer.
     */
    fun merkeGescheiterteEntwertung(server: String) {
        designSpiegel.edit { putStringSet(ENTWERTUNG_GESCHEITERT, gescheiterteEntwertungen() + server) }
    }
    override fun gescheiterteEntwertungen(): Set<String> = designSpiegel.getStringSet(ENTWERTUNG_GESCHEITERT, null).orEmpty().toSet()
    override fun quittiereGescheiterteEntwertungen() {
        designSpiegel.edit { remove(ENTWERTUNG_GESCHEITERT) }
    }

    override suspend fun updateStand(): UpdateStand? {
        val p = context.dataStore.data.first()
        val code = p[UPDATE_HOECHSTER_CODE] ?: return null
        return UpdateStand(code, p[UPDATE_AUSGESTELLT] ?: 0L)
    }

    override suspend fun merkeUpdateStand(stand: UpdateStand) {
        context.dataStore.edit {
            it[UPDATE_HOECHSTER_CODE] = stand.hoechsterCode
            it[UPDATE_AUSGESTELLT] = stand.ausgestellt
        }
    }

    /** Der Geheimtext wie abgelegt: Der Auftrag braucht das Token nie im Klartext. */
    override suspend fun entwertungsauftrag(): Entwertungsauftrag? {
        val geheim = context.dataStore.data.first()[AUTH_TOKEN_ENC] ?: return null
        val server = serverUrlJetzt().ifBlank { return null }
        return Entwertungsauftrag(server, geheim, pinSchluessel(server)?.let(::pin))
    }

    override suspend fun clearSession(): Unit = tokenSchranke.schreibe<Unit> {
        _authTokenState.value = ""
        _tokenHerkunftState.value = null
        context.dataStore.edit {
            // BEIDE Schlüssel: Bliebe der alte stehen, wäre man nach dem
            // Abmelden über den Altbestand wieder angemeldet.
            it.remove(AUTH_TOKEN)
            it.remove(AUTH_TOKEN_ENC)
            it.remove(TOKEN_HERKUNFT)
            it.remove(USERNAME)
            it.remove(ANGEMELDET_AM)
        }
    }
}
