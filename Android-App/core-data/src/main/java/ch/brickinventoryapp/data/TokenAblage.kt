package ch.brickinventoryapp.data

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.MutablePreferences
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import ch.brickinventoryapp.data.cache.CacheOwner
import ch.brickinventoryapp.model.coroutines.ApplicationScope
import ch.brickinventoryapp.network.util.NetworkPolicy
import ch.brickinventoryapp.security.Geraetesperre
import ch.brickinventoryapp.security.TokenEncryption
import ch.brickinventoryapp.security.Tresorbefund
import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import ch.brickinventoryapp.security.readPatient
import ch.brickinventoryapp.security.readToken
import ch.brickinventoryapp.security.pinKey
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
 * Speicherspiegeln für den Interceptor. Getrennt von der DevicesStore;
 * alle Schreibungen des Tokens laufen hier unter einer [TokenLimit].
 */
@Singleton
class TokenAblage @Inject constructor(
    private val dataStore: DataStore<Preferences>,
    private val tresor: TokenEncryption,
    /** Pins für den Entwertungsauftrag und die einmaligen Aufräumarbeiten beim Start. */
    private val geraet: DevicesStore,
    /** Die Spiegel laufen, solange die App lebt; kein eigener Bereich ohne Besitzer. */
    @param:ApplicationScope private val prefsScope: CoroutineScope,
    /**
     * Bei gesperrtem Gerät wartet das Lesen des Tokens auf das Entsperren (readToken).
     * Steht vor [redemption]: Ein nachgestelltes Lambda meint den Planer, nicht die Sperre.
     */
    private val lock: Geraetesperre = Geraetesperre { false },
    /** Für ein Token, das ein Serverwechsel verwirft, ohne dass es lesbar war (saveServerUrl). */
    private val redemption: Provider<RedemptionPlanner> = Provider { RedemptionPlanner {} },
) : Tokenspiegel, Tokenuebernahme, CacheOwner, Entwertungsquelle, Credentials, Anmeldestand, SessionEnd {
    companion object {
        /** Klartext älterer Fassungen: gelesen, bis der Start ihn nach [SERVER_URL_SECRET] übernimmt. */
        val SERVER_URL   = stringPreferencesKey("server_url")
        /** Frühere Fassungen: unter dem Schlüssel der Pins, der auch gesperrt arbeitet. Wie [SERVER_URL]. */
        val SERVER_URL_ENC = stringPreferencesKey("server_url_enc")
        /** Unter dem Schlüssel der Angaben, der nur entsperrt arbeitet (DevicesStore.openDetail). */
        val SERVER_URL_SECRET = stringPreferencesKey("server_url_geheim")
        /**
         * Das Klartext-Token älterer Fassungen. Es gilt nie als Token, sondern wird nur
         * entfernt: Was im Klartext lag, kann kopiert sein (Sicherung, Dateizugriff).
         */
        val AUTH_TOKEN     = stringPreferencesKey("auth_token")

        /** Der verschlüsselte Nachfolger. */
        val AUTH_TOKEN_ENC = stringPreferencesKey("auth_token_enc")
        /** Klartext älterer Fassungen, wie [SERVER_URL]. */
        val TOKEN_ORIGIN = stringPreferencesKey("token_herkunft")
        /** Der Server, der den Token ausgab (NetworkPolicy.herkunft); nur dorthin geht er. */
        val TOKEN_ORIGIN_SECRET = stringPreferencesKey("token_herkunft_geheim")
        /** Wann mit Passwort, Passkey oder QR angemeldet wurde; ein Tausch ändert es nicht. */
        val SIGNED_IN_AT = longPreferencesKey("angemeldet_am")
        /** Klartext und frühere Form, wie [SERVER_URL] und [SERVER_URL_ENC]. */
        val USERNAME     = stringPreferencesKey("username")
        val USERNAME_ENC = stringPreferencesKey("username_enc")
        val USERNAME_SECRET = stringPreferencesKey("username_geheim")

        private val ADDRESS = Angabe(SERVER_URL_SECRET, SERVER_URL_ENC, SERVER_URL)
        private val NAME = Angabe(USERNAME_SECRET, USERNAME_ENC, USERNAME)
        private val ORIGIN = Angabe(TOKEN_ORIGIN_SECRET, null, TOKEN_ORIGIN)
    }

    /** Die Rohwerte einer Angabe in allen Formen; ändert sich keiner, ist nichts neu zu lesen. */
    private fun roh(prefs: Preferences, a: Angabe): List<String?> = listOf(prefs[a.geheim], a.alt?.let { prefs[it] }, prefs[a.klar])

    /** Eine frühere Form (unter dem Schlüssel der Pins oder Klartext), bis der Start sie übernimmt. */
    private fun frueher(roh: List<String?>, a: Angabe): String? =
        a.alt?.let { k -> roh[1]?.let { geraet.entschluessleOldDetail(it, k.name) } } ?: roh[2]

    /** Erst der Geheimtext, dann eine frühere Form. Gesperrt heisst warten, nicht „keine Adresse“. */
    private fun oeffne(roh: List<String?>, a: Angabe): Tresorbefund {
        val b = roh[0]?.let { geraet.openDetail(it, a.geheim.name) } ?: Tresorbefund.Weg
        if (b != Tresorbefund.Weg) return b
        return frueher(roh, a)?.let { Tresorbefund.Readable(it) } ?: Tresorbefund.Weg
    }

    /** Ohne zu warten; gesperrt ist hier null wie „nicht da“. */
    private fun wert(prefs: Preferences, a: Angabe): String? = (oeffne(roh(prefs, a), a) as? Tresorbefund.Readable)?.klartext

    /** Wartet bei gesperrtem Gerät auf das Entsperren, wie das Token (readPatient). */
    @OptIn(ExperimentalCoroutinesApi::class)
    private fun fluss(a: Angabe): Flow<String> = dataStore.data.map { roh(it, a) }.distinctUntilChanged()
        .transformLatest { r -> readPatient({ oeffne(r, a) }, null, melde = { emit(it) }, lock = lock) }

    private fun verschluessle(a: Angabe, wert: String): String =
        geraet.verschluessleDetail(wert, a.geheim.name) ?: throw IOException("${a.geheim.name} gerade nicht verschlüsselbar")

    private fun MutablePreferences.setze(a: Angabe, geheim: String) {
        this[a.geheim] = geheim
        a.alt?.let { remove(it) }
        remove(a.klar)
    }

    private fun MutablePreferences.entferne(a: Angabe) {
        remove(a.geheim)
        a.alt?.let { remove(it) }
        remove(a.klar)
    }

    val serverUrl: Flow<String> = fluss(ADDRESS).map(::schemaSmall)

    private fun addressFrom(prefs: Preferences): String = schemaSmall(wert(prefs, ADDRESS) ?: "")

    /** Das Schema klein (HTTPs → https), wie es saveServerUrl ablegt. */
    private fun schemaSmall(raw: String): String =
        if (raw.contains("://")) {
            val idx = raw.indexOf("://")
            raw.substring(0, idx).lowercase() + raw.substring(idx)
        } else raw
    /**
     * Das Bearer-Token im Klartext, nur aus dem verschlüsselten Wert ([AUTH_TOKEN] gilt nie).
     * Ein gesperrter Keystore wird abgewartet und nachgeholt (util/Tresorbefund.readToken).
     */
    @OptIn(ExperimentalCoroutinesApi::class)
    val authToken: Flow<String> = dataStore.data.map { prefs -> prefs[AUTH_TOKEN_ENC] }
        .distinctUntilChanged()
        .transformLatest { geheim -> readToken(tresor, geheim, null, melde = { emit(it) }, lock = lock) }
    val username:  Flow<String> = fluss(NAME)

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
    private val _tokenOriginState = MutableStateFlow<String?>(null)
    /** Leer = Altbestand ohne Bindung; dann gilt der eingetragene Server. */
    override val tokenOriginState: StateFlow<String?> = _tokenOriginState.asStateFlow()

    // Nur im Speicher: Eine Kopplung, die der Prozess nicht überlebt, ist abgebrochen.
    private val _kopplungsziel = MutableStateFlow<String?>(null)
    override val kopplungszielState: StateFlow<String?> = _kopplungsziel.asStateFlow()
    fun kopplungsziel(url: String?) {
        _kopplungsziel.value = url
    }

    // Drei Spiegel (Adresse, Token, Herkunft) und die einmaligen Aufräumarbeiten:
    // Erst wenn alle vier durch sind, ist der Kaltstart vorbei und der erste
    // Verbindungsaufbau darf los.
    private val readStart = CountDownLatch(4)

    /** Sperre und Generation für alle Schreibungen des Tokens (data/TokenSwap). Vor init: Die Spiegel brauchen sie. */
    private val tokenLimit = TokenLimit()

    /**
     * Für den Interceptor auf OkHttp-Threads: wartet beim Kaltstart auf den ersten
     * Stand der Platte, ohne Koroutine und höchstens fünf Sekunden.
     */
    override fun waitOnStart() {
        readStart.await(5, TimeUnit.SECONDS)
    }

    private fun <R, T> mirror(roh: (Preferences) -> R, ziel: MutableStateFlow<T?>, lies: suspend (R, suspend (T) -> Unit) -> Unit) =
        prefsScope.launch {
            tokenLimit.mirror(dataStore.data, { dataStore.data.first() }, roh, lies,
                setze = { ziel.value = it }, gelesen = readStart::countDown)
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
    override suspend fun accountArea(): String? {
        val server = serverUrlJetzt().trim().trimEnd('/')
        val token = tokenJetzt()
        if (server.isBlank() || token.isBlank()) return null
        val name = username.first()
        return "$server\n" + name.ifBlank { token }
    }

    /** Aus denselben Spiegeln wie [accountArea]; bis der Kaltstart gelesen ist, null. */
    override fun accountAreaFlow(): Flow<String?> =
        combine(_serverUrlState, _authTokenState, username) { s, t, name ->
            val server = s?.trim()?.trimEnd('/').orEmpty()
            if (server.isBlank() || t.isNullOrBlank()) null else "$server\n" + name.ifBlank { t }
        }.distinctUntilChanged()

    override suspend fun cacheArea(): String? {
        val server = serverUrlJetzt().trim().trimEnd('/')
        val token = tokenJetzt()
        return if (server.isBlank() || token.isBlank()) null else "$server\n$token"
    }

    init {
        // Der Nachlauf aus dem DataStore: für den Kaltstart und für Änderungen,
        // die nicht über die save-Funktionen kamen (Umschlüsseln beim Start).
        mirror<List<String?>, String>({ roh(it, ADDRESS) }, _serverUrlState) { r, melde ->
            readPatient({ oeffne(r, ADDRESS) }, null, melde = { melde(schemaSmall(it)) }, lock = lock)
        }
        mirror<String?, String>({ it[AUTH_TOKEN_ENC] }, _authTokenState) { geheim, melde ->
            readToken(tresor, geheim, null, melde, lock = lock)
        }
        mirror<List<String?>, String?>({ roh(it, ORIGIN) }, _tokenOriginState) { r, melde ->
            readPatient({ oeffne(r, ORIGIN) }, null, melde = { melde(it.ifEmpty { null }) }, lock = lock)
        }
        prefsScope.launch {
            try {
                geraet.prepareBefore()
                fangeAusserAbbruch { bindLegacyStock() }
                fangeAusserAbbruch { dataStore.edit { adoptDetails(it) } }
                // Aufräumen ist Nebensache: Scheitert es, startet die App trotzdem.
                fangeAusserAbbruch { dataStore.edit { PlaintextRemainder.entferne(it) } }
            } finally {
                readStart.countDown()
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
        val newOrigin: suspend () -> Boolean = {
            val anders = !NetworkPolicy.sameServer(serverUrlJetzt(), normalized)
            // Laufende Aufrufe gehören dem alten Server; ihre Antworten sollen nichts mehr auslösen.
            if (anders) serverwechselListener.forEach { it() }
            anders
        }
        tokenLimit.schreibe(newSession = newOrigin) {
            // Entschieden wird über die Platte, nicht über den Speicher: Bei gesperrtem
            // Keystore meldet der Speicher "", das Token liegt aber noch da (Tresorbefund).
            val platte = dataStore.data.first()
            // Vor allem anderen: Lässt sie sich nicht ablegen, bleibt alles beim alten Server.
            val adresse = verschluessle(ADDRESS, normalized)
            val oldAddress = serverUrlJetzt()
            val herkunft = wert(platte, ORIGIN) ?: _tokenOriginState.value ?: oldAddress
            val hatToken = platte[AUTH_TOKEN_ENC] != null || tokenJetzt().isNotBlank()
            val anderer = hatToken &&
                (!NetworkPolicy.sameOrigin(herkunft, normalized) ||
                    !NetworkPolicy.sameServer(oldAddress, normalized))
            if (anderer) {
                orphanedToken(platte, oldAddress)?.let { runCatching { redemption.get().plane(it) } }
                _authTokenState.value = ""; _tokenOriginState.value = null
            }
            _serverUrlState.value = normalized
            dataStore.edit {
                it.setze(ADDRESS, adresse)
                if (anderer) {
                    it.remove(AUTH_TOKEN); it.remove(AUTH_TOKEN_ENC); it.entferne(ORIGIN); it.entferne(NAME)
                    it.remove(SIGNED_IN_AT)
                }
            }
        }
    }

    /**
     * Der Auftrag für ein Token, das ohne Abmelden verworfen wird: Abgemeldet wird nur
     * eine lesbare Sitzung (AnmeldungViewModel). Der Auftrag braucht keinen Klartext und
     * geht an den Server der Bindung, nie an den neuen.
     */
    private fun orphanedToken(platte: Preferences, oldAddress: String): Entwertungsauftrag? {
        val geheim = platte[AUTH_TOKEN_ENC] ?: return null
        val herkunft = wert(platte, ORIGIN) ?: NetworkPolicy.herkunft(oldAddress)
        if (oldAddress.isBlank() || herkunft == null || herkunft != NetworkPolicy.herkunft(oldAddress)) return null
        return Entwertungsauftrag(oldAddress, geheim, pinKey(oldAddress)?.let(geraet::pin), herkunft)
    }

    /**
     * Ein Token älterer Fassungen ohne Bindung gehört dem eingetragenen Server. Einmal
     * beim Start gebunden, denn ein ungebundenes Token sendet der Wächter nirgends hin.
     */
    private suspend fun bindLegacyStock() {
        dataStore.edit { p ->
            if (p[AUTH_TOKEN_ENC] == null || roh(p, ORIGIN).any { it != null }) return@edit
            NetworkPolicy.herkunft(addressFrom(p))?.let { p.setze(ORIGIN, verschluessle(ORIGIN, it)); _tokenOriginState.value = it }
        }
    }

    /**
     * Token ablegen, nur noch verschlüsselt. Der alte Klartext-Eintrag wird im selben
     * Zug entfernt — sonst bliebe er auslesbar, und die Verschlüsselung wäre Zierde.
     */
    suspend fun saveAuthToken(token: String) = tokenLimit.schreibe {
        writeToken(token, NetworkPolicy.herkunft(serverUrlJetzt()), signedInAt = System.currentTimeMillis())
    }

    /**
     * ZUERST in den Speicher: Der Aufrufer feuert unmittelbar danach die ersten
     * Anfragen, und der Interceptor liest den Wert synchron. [signedInAt] nur
     * bei einer Anmeldung: Ein Tausch verlängert die Höchstdauer nicht.
     */
    private suspend fun writeToken(token: String, herkunft: String?, signedInAt: Long?) {
        // Erst verschlüsseln: Scheitert es (gesperrt), stehen Speicher und Platte noch beim alten.
        val geheim = tresor.verschluessle(token)
        val originSecret = herkunft?.let { verschluessle(ORIGIN, it) }
        _tokenOriginState.value = herkunft
        _authTokenState.value = token
        dataStore.edit {
            it[AUTH_TOKEN_ENC] = geheim
            it.remove(AUTH_TOKEN)
            if (originSecret != null) it.setze(ORIGIN, originSecret) else it.entferne(ORIGIN)
            if (signedInAt != null) it[SIGNED_IN_AT] = signedInAt
        }
    }

    /** Für den Wächter (di/ServerWaechter): die Generation, vor dem Token gelesen. */
    override fun tokenGeneration(): Long = tokenLimit.generation

    private val serverwechselListener = CopyOnWriteArrayList<() -> Unit>()

    /** Die Server-Clients brechen beim Wechsel auf eine andere Herkunft ihre Aufrufe ab (di/ServerClient). */
    override fun onServerwechsel(listener: () -> Unit) { serverwechselListener += listener }

    /** Für den Tausch: Herkunft wie im Wächter — ohne Bindung keine, dann tauscht nichts. */
    override suspend fun tokenStatus(): TokenStatus {
        val herkunft = _tokenOriginState.value ?: wert(dataStore.data.first(), ORIGIN)
        return TokenStatus(tokenJetzt(), herkunft, tokenLimit.generation)
    }

    /** Den getauschten Token nur ablegen, wenn seit Beginn des Tauschs nichts anderes geschah. */
    override suspend fun replaceSwappedToken(vorher: TokenStatus, neu: String, requestOrigin: String?): Boolean =
        tokenLimit.replaceIf(vorher, requestOrigin, ::tokenStatus) {
            writeToken(neu, requestOrigin, signedInAt = null)
        }

    /**
     * Ist die Anmeldung älter als [TOKEN_MAX_DURATION_DAYS]? Eine Anmeldung aus
     * einer Fassung ohne Datum beginnt jetzt zu zählen, statt sofort abzumelden.
     */
    suspend fun loginExpired(jetzt: Long = System.currentTimeMillis()): Boolean {
        val am = dataStore.data.first()[SIGNED_IN_AT]
        if (am == null) {
            if (tokenJetzt().isNotBlank()) dataStore.edit { it[SIGNED_IN_AT] = jetzt }
            return false
        }
        return loginOverdue(am, jetzt)
    }

    /**
     * Beim App-Start: ein Klartext-Token älterer Fassungen entfernen (nie übernehmen,
     * dann meldet man sich neu an) und einen Geheimtext unter dem alten Schlüssel umschlüsseln.
     *
     * @return true, wenn ein Klartext-Token entfernt wurde.
     */
    override suspend fun adoptOldToken(): Boolean {
        var entfernt = false
        var umgeschluesselt = false
        dataStore.edit { prefs ->
            entfernt = !prefs[AUTH_TOKEN].isNullOrEmpty()
            prefs.remove(AUTH_TOKEN)
            umgeschluesselt = umschluesseln(prefs)
        }
        if (umgeschluesselt) fangeAusserAbbruch { tresor.forgetLegacyStock() }
        return entfernt
    }

    /**
     * Ein Token früherer Fassungen unter dem schwächeren Schlüssel bliebe bis zum nächsten Start
     * lesbar für jeden, der das gesperrte Gerät ausliest; darum gleich nach dem Entsperren
     * (BrickInventoryApp, ACTION_USER_PRESENT). Ohne Altbestand kein Schreiben.
     */
    override suspend fun levelTokenHigh() {
        if (dataStore.data.first()[AUTH_TOKEN_ENC]?.let(tresor::veraltet) != true) return
        var umgeschluesselt = false
        dataStore.edit { umgeschluesselt = umschluesseln(it) }
        if (umgeschluesselt) fangeAusserAbbruch { tresor.forgetLegacyStock() }
    }

    /**
     * Adresse, Name und Herkunft früherer Fassungen (Klartext oder unter dem Schlüssel der Pins)
     * unter den Schlüssel der Angaben; scheitert es (gesperrt), beim nächsten Start. Die frühere
     * Form geht erst, wenn die neue dasteht: Nichts geht verloren.
     */
    private fun adoptDetails(prefs: MutablePreferences) {
        for (a in listOf(ADDRESS, NAME, ORIGIN)) {
            if (prefs[a.geheim] == null) {
                val vorher = frueher(roh(prefs, a), a) ?: continue
                prefs[a.geheim] = geraet.verschluessleDetail(vorher, a.geheim.name) ?: continue
            }
            a.alt?.let { prefs.remove(it) }
            prefs.remove(a.klar)
        }
    }

    /**
     * Ein Geheimtext unter dem schwächeren Schlüssel früherer Fassungen kommt unter den, der
     * nur entsperrt arbeitet. Im selben edit wie das Lesen: Ein Tausch dazwischen würde sonst
     * vom alten Token überschrieben. Den alten Schlüssel löscht der Aufrufer erst nach dem
     * Schreiben: Scheitert das edit, bliebe sonst ein Geheimtext ohne Schlüssel.
     */
    private fun umschluesseln(prefs: MutablePreferences): Boolean {
        val geheim = prefs[AUTH_TOKEN_ENC]?.takeIf(tresor::veraltet) ?: return false
        val klar = (tresor.oeffne(geheim) as? Tresorbefund.Readable)?.klartext ?: return false
        val neu = fangeAusserAbbruch { tresor.verschluessle(klar) }.getOrNull() ?: return false
        if (tresor.veraltet(neu)) return false
        prefs[AUTH_TOKEN_ENC] = neu
        return true
    }
    suspend fun saveUsername(name: String) {
        val geheim = verschluessle(NAME, name)
        dataStore.edit { it.setze(NAME, geheim) }
    }

    /** Der Geheimtext wie abgelegt, nur für den Server seiner Bindung; nie im Klartext. */
    override suspend fun entwertungsauftrag(): Entwertungsauftrag? {
        val platte = dataStore.data.first()
        val geheim = platte[AUTH_TOKEN_ENC] ?: return null
        val server = serverUrlJetzt().ifBlank { return null }
        val herkunft = wert(platte, ORIGIN) ?: return null
        if (herkunft != NetworkPolicy.herkunft(server)) return null
        return Entwertungsauftrag(server, geheim, pinKey(server)?.let(geraet::pin), herkunft)
    }

    override suspend fun clearSession(): Unit = tokenLimit.schreibe<Unit> {
        _authTokenState.value = ""
        _tokenOriginState.value = null
        dataStore.edit {
            // BEIDE Schlüssel: Bliebe der alte stehen, wäre man nach dem
            // Abmelden über den Altbestand wieder angemeldet.
            it.remove(AUTH_TOKEN)
            it.remove(AUTH_TOKEN_ENC)
            it.entferne(ORIGIN)
            it.entferne(NAME)
            it.remove(SIGNED_IN_AT)
            // Die Marke des Preisalarms gehört dem Konto; das nächste bekäme sonst dessen Stand.
            it.remove(DevicesStore.ALARM_BRAND)
        }
    }
}

/** Eine Angabe in ihren Formen: [geheim] jetzt, [alt] unter dem Schlüssel der Pins, [klar] im Klartext. */
private class Angabe(
    val geheim: Preferences.Key<String>,
    val alt: Preferences.Key<String>?,
    val klar: Preferences.Key<String>,
)
