package ch.brickinventoryapp.data

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.MutablePreferences
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import ch.brickinventoryapp.data.cache.CacheBesitzer
import ch.brickinventoryapp.model.koroutinen.ApplicationScope
import ch.brickinventoryapp.netz.util.NetworkPolicy
import ch.brickinventoryapp.sicherheit.Geraetesperre
import ch.brickinventoryapp.sicherheit.TokenVerschluesselung
import ch.brickinventoryapp.sicherheit.Tresorbefund
import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import ch.brickinventoryapp.sicherheit.liesToken
import ch.brickinventoryapp.sicherheit.pinSchluessel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.transformLatest
import kotlinx.coroutines.launch
import java.io.IOException
import java.util.concurrent.CopyOnWriteArrayList
import javax.inject.Inject
import javax.inject.Provider
import javax.inject.Singleton
import kotlinx.coroutines.ExperimentalCoroutinesApi
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Server, Token, Herkunft und Generation des angemeldeten Kontos samt den
 * Speicherspiegeln für den Interceptor. Getrennt von der GeraeteAblage;
 * alle Schreibungen des Tokens laufen hier unter einer [TokenSchranke].
 */
@Singleton
class TokenAblage @Inject constructor(
    private val dataStore: DataStore<Preferences>,
    private val tresor: TokenVerschluesselung,
    /** Pins für den Entwertungsauftrag und die einmaligen Aufräumarbeiten beim Start. */
    private val geraet: GeraeteAblage,
    /** Die Spiegel laufen, solange die App lebt; kein eigener Bereich ohne Besitzer. */
    @param:ApplicationScope private val prefsScope: CoroutineScope,
    /**
     * Bei gesperrtem Gerät wartet das Lesen des Tokens auf das Entsperren (liesToken).
     * Steht vor [entwertung]: Ein nachgestelltes Lambda meint den Planer, nicht die Sperre.
     */
    private val sperre: Geraetesperre = Geraetesperre { false },
    /** Für ein Token, das ein Serverwechsel verwirft, ohne dass es lesbar war (saveServerUrl). */
    private val entwertung: Provider<EntwertungsPlaner> = Provider { EntwertungsPlaner {} },
) : Tokenspiegel, Tokenuebernahme, CacheBesitzer, Entwertungsquelle, Zugangsdaten, Anmeldestand, Sitzungsende {
    companion object {
        /** Klartext älterer Fassungen: gelesen, bis der Start ihn nach [SERVER_URL_ENC] übernimmt. */
        val SERVER_URL   = stringPreferencesKey("server_url")
        val SERVER_URL_ENC = stringPreferencesKey("server_url_enc")
        /**
         * Das Klartext-Token älterer Fassungen. Es gilt nie als Token, sondern wird nur
         * entfernt: Was im Klartext lag, kann kopiert sein (Sicherung, Dateizugriff).
         */
        val AUTH_TOKEN     = stringPreferencesKey("auth_token")

        /** Der verschlüsselte Nachfolger. */
        val AUTH_TOKEN_ENC = stringPreferencesKey("auth_token_enc")
        /** Der Server, der den Token ausgab (NetworkPolicy.herkunft); nur dorthin geht er. */
        val TOKEN_HERKUNFT = stringPreferencesKey("token_herkunft")
        /** Wann mit Passwort, Passkey oder QR angemeldet wurde; ein Tausch ändert es nicht. */
        val ANGEMELDET_AM = longPreferencesKey("angemeldet_am")
        /** Klartext älterer Fassungen, wie [SERVER_URL]. */
        val USERNAME     = stringPreferencesKey("username")
        val USERNAME_ENC = stringPreferencesKey("username_enc")
    }

    /** Erst der Geheimtext; der Klartext nur, bis der Start ihn übernommen hat (uebernimmAngaben). */
    private fun angabe(prefs: Preferences, geheim: Preferences.Key<String>, klar: Preferences.Key<String>): String? =
        prefs[geheim]?.let { geraet.entschluessleAngabe(it, geheim.name) } ?: prefs[klar]

    private fun MutablePreferences.setzeAngabe(geheim: Preferences.Key<String>, klar: Preferences.Key<String>, wert: String) {
        this[geheim] = geraet.verschluessleAngabe(wert, geheim.name) ?: throw IOException("${geheim.name} nicht verschlüsselbar")
        remove(klar)
    }

    val serverUrl: Flow<String> = dataStore.data.map { adresseAus(it) }

    /** Das Schema klein (HTTPs → https), wie es saveServerUrl ablegt. */
    private fun adresseAus(prefs: Preferences): String {
        val raw = angabe(prefs, SERVER_URL_ENC, SERVER_URL) ?: ""
        return if (raw.contains("://")) {
            val idx = raw.indexOf("://")
            raw.substring(0, idx).lowercase() + raw.substring(idx)
        } else raw
    }
    /**
     * Das Bearer-Token im Klartext, nur aus dem verschlüsselten Wert ([AUTH_TOKEN] gilt nie).
     * Ein gesperrter Keystore wird abgewartet und nachgeholt (util/Tresorbefund.liesToken).
     */
    @OptIn(ExperimentalCoroutinesApi::class)
    val authToken: Flow<String> = dataStore.data.map { prefs -> prefs[AUTH_TOKEN_ENC] }
        .distinctUntilChanged()
        .transformLatest { geheim -> liesToken(tresor, geheim, null, melde = { emit(it) }, sperre = sperre) }
    val username:  Flow<String> = dataStore.data.map { angabe(it, USERNAME_ENC, USERNAME) ?: "" }

    // ── In-Memory-Cache für den OkHttp-Interceptor ────────────────────────────
    // Der Interceptor läuft auf OkHttp-Dispatcher-Threads und darf dort nicht
    // blockieren. Diese StateFlows spiegeln DataStore-Werte im Speicher, sodass
    // pro Request nur ein synchroner .value-Read nötig ist (statt runBlocking).
    // null = DataStore noch nicht gelesen (nur ganz kurz beim Kaltstart).

    // Der Speicherwert führt, der DataStore folgt: Die Anmeldung feuert sofort
    // Abrufe, und ein nachlaufender Wert gäbe dem Interceptor den alten Token.
    // null = DataStore noch nicht gelesen (nur kurz beim Kaltstart).
    private val _serverUrlState = MutableStateFlow<String?>(null)
    override val serverUrlState: StateFlow<String?> = _serverUrlState.asStateFlow()
    private val _authTokenState = MutableStateFlow<String?>(null)
    override val authTokenState: StateFlow<String?> = _authTokenState.asStateFlow()
    private val _tokenHerkunftState = MutableStateFlow<String?>(null)
    /** Leer = Altbestand ohne Bindung; dann gilt der eingetragene Server. */
    override val tokenHerkunftState: StateFlow<String?> = _tokenHerkunftState.asStateFlow()

    // Drei Spiegel (Adresse, Token, Herkunft) und die einmaligen Aufräumarbeiten:
    // Erst wenn alle vier durch sind, ist der Kaltstart vorbei und der erste
    // Verbindungsaufbau darf los.
    private val startGelesen = CountDownLatch(4)

    /** Sperre und Generation für alle Schreibungen des Tokens (data/TokenTausch). Vor init: Die Spiegel brauchen sie. */
    private val tokenSchranke = TokenSchranke()

    /**
     * Für den Interceptor auf OkHttp-Threads: wartet beim Kaltstart auf den ersten
     * Stand der Platte, ohne Koroutine und höchstens fünf Sekunden.
     */
    override fun warteAufStart() {
        startGelesen.await(5, TimeUnit.SECONDS)
    }

    private fun <R, T> spiegle(roh: (Preferences) -> R, ziel: MutableStateFlow<T?>, lies: suspend (R, suspend (T) -> Unit) -> Unit) =
        prefsScope.launch {
            tokenSchranke.spiegle(dataStore.data, { dataStore.data.first() }, roh, lies,
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

    /** Aus denselben Spiegeln wie [kontoBereich]; bis der Kaltstart gelesen ist, null. */
    override fun kontoBereichFluss(): Flow<String?> =
        combine(_serverUrlState, _authTokenState, username) { s, t, name ->
            val server = s?.trim()?.trimEnd('/').orEmpty()
            if (server.isBlank() || t.isNullOrBlank()) null else "$server\n" + name.ifBlank { t }
        }.distinctUntilChanged()

    override suspend fun cacheBereich(): String? {
        val server = serverUrlJetzt().trim().trimEnd('/')
        val token = tokenJetzt()
        return if (server.isBlank() || token.isBlank()) null else "$server\n$token"
    }

    init {
        // Der Nachlauf aus dem DataStore: für den Kaltstart und für Änderungen,
        // die nicht über die save-Funktionen kamen (Umschlüsseln beim Start).
        spiegle<String, String>(::adresseAus, _serverUrlState) { r, melde -> melde(r) }
        spiegle<String?, String>({ it[AUTH_TOKEN_ENC] }, _authTokenState) { geheim, melde ->
            liesToken(tresor, geheim, null, melde, sperre = sperre)
        }
        spiegle<String?, String?>({ it[TOKEN_HERKUNFT] }, _tokenHerkunftState) { r, melde -> melde(r) }
        prefsScope.launch {
            try {
                geraet.bereiteVor()
                fangeAusserAbbruch { bindeAltbestand() }
                fangeAusserAbbruch { dataStore.edit { uebernimmAngaben(it) } }
                // Aufräumen ist Nebensache: Scheitert es, startet die App trotzdem.
                fangeAusserAbbruch { dataStore.edit { KlartextReste.entferne(it) } }
            } finally {
                startGelesen.countDown()
            }
        }
    }

    suspend fun saveServerUrl(url: String) {
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
            // Entschieden wird über die Platte, nicht über den Speicher: Bei gesperrtem
            // Keystore meldet der Speicher "", das Token liegt aber noch da (Tresorbefund).
            val platte = dataStore.data.first()
            val alteAdresse = serverUrlJetzt()
            val herkunft = platte[TOKEN_HERKUNFT] ?: _tokenHerkunftState.value ?: alteAdresse
            val hatToken = platte[AUTH_TOKEN_ENC] != null || tokenJetzt().isNotBlank()
            val anderer = hatToken &&
                (!NetworkPolicy.gleicheHerkunft(herkunft, normalized) ||
                    !NetworkPolicy.gleicherServer(alteAdresse, normalized))
            if (anderer) {
                verwaistesToken(platte, alteAdresse)?.let { runCatching { entwertung.get().plane(it) } }
                _authTokenState.value = ""; _tokenHerkunftState.value = null
            }
            _serverUrlState.value = normalized
            dataStore.edit {
                it.setzeAngabe(SERVER_URL_ENC, SERVER_URL, normalized)
                if (anderer) {
                    it.remove(AUTH_TOKEN); it.remove(AUTH_TOKEN_ENC); it.remove(TOKEN_HERKUNFT); it.remove(USERNAME)
                    it.remove(USERNAME_ENC); it.remove(ANGEMELDET_AM)
                }
            }
        }
    }

    /**
     * Der Auftrag für ein Token, das ohne Abmelden verworfen wird: Abgemeldet wird nur
     * eine lesbare Sitzung (AnmeldungViewModel). Der Auftrag braucht keinen Klartext und
     * geht an den Server der Bindung, nie an den neuen.
     */
    private fun verwaistesToken(platte: Preferences, alteAdresse: String): Entwertungsauftrag? {
        val geheim = platte[AUTH_TOKEN_ENC] ?: return null
        val herkunft = platte[TOKEN_HERKUNFT] ?: NetworkPolicy.herkunft(alteAdresse)
        if (alteAdresse.isBlank() || herkunft == null || herkunft != NetworkPolicy.herkunft(alteAdresse)) return null
        return Entwertungsauftrag(alteAdresse, geheim, pinSchluessel(alteAdresse)?.let(geraet::pin), herkunft)
    }

    /**
     * Ein Token älterer Fassungen ohne Bindung gehört dem eingetragenen Server. Einmal
     * beim Start gebunden, denn ein ungebundenes Token sendet der Wächter nirgends hin.
     */
    private suspend fun bindeAltbestand() {
        dataStore.edit { p ->
            if (p[AUTH_TOKEN_ENC] == null || p[TOKEN_HERKUNFT] != null) return@edit
            NetworkPolicy.herkunft(adresseAus(p))?.let { p[TOKEN_HERKUNFT] = it; _tokenHerkunftState.value = it }
        }
    }

    /**
     * Token ablegen, nur noch verschlüsselt. Der alte Klartext-Eintrag wird im selben
     * Zug entfernt — sonst bliebe er auslesbar, und die Verschlüsselung wäre Zierde.
     */
    suspend fun saveAuthToken(token: String) = tokenSchranke.schreibe {
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
        dataStore.edit {
            it[AUTH_TOKEN_ENC] = geheim
            it.remove(AUTH_TOKEN)
            if (herkunft != null) it[TOKEN_HERKUNFT] = herkunft else it.remove(TOKEN_HERKUNFT)
            if (angemeldetAm != null) it[ANGEMELDET_AM] = angemeldetAm
        }
    }

    /** Für den Wächter (di/ServerWaechter): die Generation, vor dem Token gelesen. */
    override fun tokenGeneration(): Long = tokenSchranke.generation

    private val serverwechselHoerer = CopyOnWriteArrayList<() -> Unit>()

    /** Die Server-Clients brechen beim Wechsel auf eine andere Herkunft ihre Aufrufe ab (di/ServerClient). */
    override fun beimServerwechsel(hoerer: () -> Unit) { serverwechselHoerer += hoerer }

    /** Für den Tausch: Herkunft wie im Wächter — ohne Bindung keine, dann tauscht nichts. */
    override suspend fun tokenStand(): TokenStand {
        val herkunft = _tokenHerkunftState.value ?: dataStore.data.first()[TOKEN_HERKUNFT]
        return TokenStand(tokenJetzt(), herkunft, tokenSchranke.generation)
    }

    /** Den getauschten Token nur ablegen, wenn seit Beginn des Tauschs nichts anderes geschah. */
    override suspend fun ersetzeGetauschtenToken(vorher: TokenStand, neu: String, anfrageHerkunft: String?): Boolean =
        tokenSchranke.ersetzeFalls(vorher, anfrageHerkunft, ::tokenStand) {
            schreibeToken(neu, anfrageHerkunft, angemeldetAm = null)
        }

    /**
     * Ist die Anmeldung älter als [TOKEN_HOECHSTDAUER_TAGE]? Eine Anmeldung aus
     * einer Fassung ohne Datum beginnt jetzt zu zählen, statt sofort abzumelden.
     */
    suspend fun anmeldungAbgelaufen(jetzt: Long = System.currentTimeMillis()): Boolean {
        val am = dataStore.data.first()[ANGEMELDET_AM]
        if (am == null) {
            if (tokenJetzt().isNotBlank()) dataStore.edit { it[ANGEMELDET_AM] = jetzt }
            return false
        }
        return anmeldungUeberfaellig(am, jetzt)
    }

    /**
     * Beim App-Start: ein Klartext-Token älterer Fassungen entfernen (nie übernehmen,
     * dann meldet man sich neu an) und einen Geheimtext unter dem alten Schlüssel umschlüsseln.
     *
     * @return true, wenn ein Klartext-Token entfernt wurde.
     */
    override suspend fun uebernehmeAltesToken(): Boolean {
        var entfernt = false
        dataStore.edit { prefs ->
            entfernt = !prefs[AUTH_TOKEN].isNullOrEmpty()
            prefs.remove(AUTH_TOKEN)
            umschluesseln(prefs)
        }
        return entfernt
    }

    /** Adresse und Name im Klartext älterer Fassungen verschlüsselt ablegen; scheitert es, beim nächsten Start. */
    private fun uebernimmAngaben(prefs: MutablePreferences) {
        for ((geheim, klar) in listOf(SERVER_URL_ENC to SERVER_URL, USERNAME_ENC to USERNAME)) {
            val wert = prefs[klar] ?: continue
            if (prefs[geheim] == null) geraet.verschluessleAngabe(wert, geheim.name)?.let { prefs[geheim] = it } ?: continue
            prefs.remove(klar)
        }
    }

    /**
     * Ein Geheimtext unter dem schwächeren Schlüssel (älterer Stand, Tausch bei gesperrtem
     * Gerät) kommt unter den, der nur entsperrt arbeitet. Im selben edit wie das Lesen:
     * Ein Tausch dazwischen würde sonst vom alten Token überschrieben.
     */
    private fun umschluesseln(prefs: MutablePreferences) {
        val geheim = prefs[AUTH_TOKEN_ENC]?.takeIf(tresor::veraltet) ?: return
        val klar = (tresor.oeffne(geheim) as? Tresorbefund.Lesbar)?.klartext ?: return
        val neu = fangeAusserAbbruch { tresor.verschluessle(klar) }.getOrNull() ?: return
        if (!tresor.veraltet(neu)) prefs[AUTH_TOKEN_ENC] = neu
    }
    suspend fun saveUsername(name: String) {
        dataStore.edit { it.setzeAngabe(USERNAME_ENC, USERNAME, name) }
    }

    /** Der Geheimtext wie abgelegt, nur für den Server seiner Bindung; nie im Klartext. */
    override suspend fun entwertungsauftrag(): Entwertungsauftrag? {
        val platte = dataStore.data.first()
        val geheim = platte[AUTH_TOKEN_ENC] ?: return null
        val server = serverUrlJetzt().ifBlank { return null }
        val herkunft = platte[TOKEN_HERKUNFT] ?: return null
        if (herkunft != NetworkPolicy.herkunft(server)) return null
        return Entwertungsauftrag(server, geheim, pinSchluessel(server)?.let(geraet::pin), herkunft)
    }

    override suspend fun clearSession(): Unit = tokenSchranke.schreibe<Unit> {
        _authTokenState.value = ""
        _tokenHerkunftState.value = null
        dataStore.edit {
            // BEIDE Schlüssel: Bliebe der alte stehen, wäre man nach dem
            // Abmelden über den Altbestand wieder angemeldet.
            it.remove(AUTH_TOKEN)
            it.remove(AUTH_TOKEN_ENC)
            it.remove(TOKEN_HERKUNFT)
            it.remove(USERNAME)
            it.remove(USERNAME_ENC)
            it.remove(ANGEMELDET_AM)
            // Die Marke des Preisalarms gehört dem Konto; das nächste bekäme sonst dessen Stand.
            it.remove(GeraeteAblage.ALARM_MARKE)
        }
    }
}
