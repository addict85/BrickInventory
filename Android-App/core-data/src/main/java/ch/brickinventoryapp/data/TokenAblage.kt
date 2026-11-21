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
 * Server, token, origin and generation of the signed-in account including the
 * in-memory mirrors for the interceptor. Separate from the DevicesStore;
 * all writes of the token run here under a [TokenLimit].
 */
@Singleton
class TokenAblage @Inject constructor(
    private val dataStore: DataStore<Preferences>,
    private val tresor: TokenEncryption,
    /** Pins for the invalidation job and the one-time cleanup tasks at start. */
    private val geraet: DevicesStore,
    /** The mirrors run as long as the app lives; no own scope without an owner. */
    @param:ApplicationScope private val prefsScope: CoroutineScope,
    /**
     * With a locked device reading the token waits for unlocking (readToken).
     * Stands before [redemption]: a trailing lambda means the scheduler, not the lock.
     */
    private val lock: Geraetesperre = Geraetesperre { false },
    /** For a token that a server switch discards without it having been readable (saveServerUrl). */
    private val redemption: Provider<RedemptionPlanner> = Provider { RedemptionPlanner {} },
) : Tokenspiegel, Tokenuebernahme, CacheOwner, Entwertungsquelle, Credentials, Anmeldestand, SessionEnd {
    companion object {
        /** Plaintext of older versions: read until the start takes it over to [SERVER_URL_SECRET]. */
        val SERVER_URL   = stringPreferencesKey("server_url")
        /** Earlier versions: under the pins' key, which also works locked. Like [SERVER_URL]. */
        val SERVER_URL_ENC = stringPreferencesKey("server_url_enc")
        /** Under the key of the details, which only works unlocked (DevicesStore.openDetail). */
        val SERVER_URL_SECRET = stringPreferencesKey("server_url_geheim")
        /**
         * The plaintext token of older versions. It never counts as a token but is only
         * removed: what lay in plaintext may have been copied (backup, file access).
         */
        val AUTH_TOKEN     = stringPreferencesKey("auth_token")

        /** The encrypted successor. */
        val AUTH_TOKEN_ENC = stringPreferencesKey("auth_token_enc")
        /** Plaintext of older versions, like [SERVER_URL]. */
        val TOKEN_ORIGIN = stringPreferencesKey("token_herkunft")
        /** The server that issued the token (NetworkPolicy.herkunft); it goes only there. */
        val TOKEN_ORIGIN_SECRET = stringPreferencesKey("token_herkunft_geheim")
        /** When the sign-in happened with password, passkey or QR; a swap does not change it. */
        val SIGNED_IN_AT = longPreferencesKey("angemeldet_am")
        /** Plaintext and earlier form, like [SERVER_URL] and [SERVER_URL_ENC]. */
        val USERNAME     = stringPreferencesKey("username")
        val USERNAME_ENC = stringPreferencesKey("username_enc")
        val USERNAME_SECRET = stringPreferencesKey("username_geheim")

        private val ADDRESS = Angabe(SERVER_URL_SECRET, SERVER_URL_ENC, SERVER_URL)
        private val NAME = Angabe(USERNAME_SECRET, USERNAME_ENC, USERNAME)
        private val ORIGIN = Angabe(TOKEN_ORIGIN_SECRET, null, TOKEN_ORIGIN)
    }

    /** The raw values of a detail in all forms; if none changes, nothing has to be read anew. */
    private fun roh(prefs: Preferences, a: Angabe): List<String?> = listOf(prefs[a.geheim], a.alt?.let { prefs[it] }, prefs[a.klar])

    /** An earlier form (under the pins' key or plaintext) until the start takes it over. */
    private fun frueher(roh: List<String?>, a: Angabe): String? =
        a.alt?.let { k -> roh[1]?.let { geraet.entschluessleOldDetail(it, k.name) } } ?: roh[2]

    /** First the ciphertext, then an earlier form. Locked means wait, not „no address“. */
    private fun oeffne(roh: List<String?>, a: Angabe): Tresorbefund {
        val b = roh[0]?.let { geraet.openDetail(it, a.geheim.name) } ?: Tresorbefund.Weg
        if (b != Tresorbefund.Weg) return b
        return frueher(roh, a)?.let { Tresorbefund.Readable(it) } ?: Tresorbefund.Weg
    }

    /** Without waiting; locked is null here like „not there“. */
    private fun wert(prefs: Preferences, a: Angabe): String? = (oeffne(roh(prefs, a), a) as? Tresorbefund.Readable)?.klartext

    /** Waits for unlocking with a locked device, like the token (readPatient). */
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

    /** The scheme in lowercase (HTTPs → https), as saveServerUrl stores it. */
    private fun schemaSmall(raw: String): String =
        if (raw.contains("://")) {
            val idx = raw.indexOf("://")
            raw.substring(0, idx).lowercase() + raw.substring(idx)
        } else raw
    /**
     * The bearer token in plaintext, only from the encrypted value ([AUTH_TOKEN] never applies).
     * A locked keystore is waited for and caught up on (util/Tresorbefund.readToken).
     */
    @OptIn(ExperimentalCoroutinesApi::class)
    val authToken: Flow<String> = dataStore.data.map { prefs -> prefs[AUTH_TOKEN_ENC] }
        .distinctUntilChanged()
        .transformLatest { geheim -> readToken(tresor, geheim, null, melde = { emit(it) }, lock = lock) }
    val username:  Flow<String> = fluss(NAME)

    // ── In-memory cache for the OkHttp interceptor ────────────────────────────
    // The interceptor runs on OkHttp dispatcher threads and must not
    // block there. These StateFlows mirror DataStore values in memory, so that
    // per request only a synchronous .value read is needed (instead of runBlocking).
    // null = DataStore not read yet (only very briefly at cold start).

    // The in-memory value leads, the DataStore follows: the sign-in fires fetches
    // immediately, and a lagging value would give the interceptor the old token.
    // null = DataStore not read yet (only briefly at cold start).
    private val _serverUrlState = MutableStateFlow<String?>(null)
    override val serverUrlState: StateFlow<String?> = _serverUrlState.asStateFlow()
    private val _authTokenState = MutableStateFlow<String?>(null)
    override val authTokenState: StateFlow<String?> = _authTokenState.asStateFlow()
    private val _tokenOriginState = MutableStateFlow<String?>(null)
    /** Empty = legacy stock without binding; then the registered server applies. */
    override val tokenOriginState: StateFlow<String?> = _tokenOriginState.asStateFlow()

    // Only in memory: a pairing the process does not survive is aborted.
    private val _kopplungsziel = MutableStateFlow<String?>(null)
    override val kopplungszielState: StateFlow<String?> = _kopplungsziel.asStateFlow()
    fun kopplungsziel(url: String?) {
        _kopplungsziel.value = url
    }

    // Three mirrors (address, token, origin) and the one-time cleanup tasks:
    // only when all four are through is the cold start over and the first
    // connection setup may go.
    private val readStart = CountDownLatch(4)

    /** Lock and generation for all writes of the token (data/TokenSwap). Before init: the mirrors need them. */
    private val tokenLimit = TokenLimit()

    /**
     * For the interceptor on OkHttp threads: at cold start waits for the first
     * state of the disk, without a coroutine and at most five seconds.
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
     * The token as it applies now — not as it last stood on disk.
     * `authToken` lags behind the write; every fetch that reads it in the window after
     * sign-in would go out without a token. That is why SSE clients, CSV service,
     * PDF export and price alert worker all read here: first the in-memory value, only at
     * cold start the disk.
     */
    override suspend fun tokenJetzt(): String = _authTokenState.value ?: authToken.first()

    /** The same rule for the server address — for the same reason. */
    override suspend fun serverUrlJetzt(): String = _serverUrlState.value ?: serverUrl.first()

    /**
     * The scope of the response cache: server and token. The token belongs to exactly
     * one account, and it changes on every sign-in — already at the moment
     * the interceptor reads it, not only after the username.
     */
    override suspend fun accountArea(): String? {
        val server = serverUrlJetzt().trim().trimEnd('/')
        val token = tokenJetzt()
        if (server.isBlank() || token.isBlank()) return null
        val name = username.first()
        return "$server\n" + name.ifBlank { token }
    }

    /** From the same mirrors as [accountArea]; null until the cold start has been read. */
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
        // Catching up from the DataStore: for the cold start and for changes
        // that did not come via the save functions (rekeying at start).
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
                // Cleaning up is secondary: if it fails, the app starts anyway.
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
        // First into memory, then onto disk (see serverUrlState).
        // A different server ends the session: the token belongs to the old one.
        val newOrigin: suspend () -> Boolean = {
            val anders = !NetworkPolicy.sameServer(serverUrlJetzt(), normalized)
            // Running calls belong to the old server; their responses should no longer trigger anything.
            if (anders) serverwechselListener.forEach { it() }
            anders
        }
        tokenLimit.schreibe(newSession = newOrigin) {
            // Decided via the disk, not via memory: with a locked
            // keystore memory reports "", but the token is still there (Tresorbefund).
            val platte = dataStore.data.first()
            // Before everything else: if it cannot be stored, everything stays with the old server.
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
     * The job for a token that is discarded without sign-out: only a readable session
     * is signed out (AnmeldungViewModel). The job needs no plaintext and
     * goes to the server of the binding, never to the new one.
     */
    private fun orphanedToken(platte: Preferences, oldAddress: String): Entwertungsauftrag? {
        val geheim = platte[AUTH_TOKEN_ENC] ?: return null
        val herkunft = wert(platte, ORIGIN) ?: NetworkPolicy.herkunft(oldAddress)
        if (oldAddress.isBlank() || herkunft == null || herkunft != NetworkPolicy.herkunft(oldAddress)) return null
        return Entwertungsauftrag(oldAddress, geheim, pinKey(oldAddress)?.let(geraet::pin), herkunft)
    }

    /**
     * A token of older versions without binding belongs to the registered server. Bound once
     * at start, because the guard sends an unbound token nowhere.
     */
    private suspend fun bindLegacyStock() {
        dataStore.edit { p ->
            if (p[AUTH_TOKEN_ENC] == null || roh(p, ORIGIN).any { it != null }) return@edit
            NetworkPolicy.herkunft(addressFrom(p))?.let { p.setze(ORIGIN, verschluessle(ORIGIN, it)); _tokenOriginState.value = it }
        }
    }

    /**
     * Store the token, only encrypted now. The old plaintext entry is removed in the same
     * step — otherwise it would stay readable, and the encryption would be decoration.
     */
    suspend fun saveAuthToken(token: String) = tokenLimit.schreibe {
        writeToken(token, NetworkPolicy.herkunft(serverUrlJetzt()), signedInAt = System.currentTimeMillis())
    }

    /**
     * FIRST into memory: the caller fires the first requests immediately afterwards,
     * and the interceptor reads the value synchronously. [signedInAt] only
     * on a sign-in: a swap does not extend the maximum duration.
     */
    private suspend fun writeToken(token: String, herkunft: String?, signedInAt: Long?) {
        // Encrypt first: if it fails (locked), memory and disk still stand at the old values.
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

    /** For the guard (di/ServerWaechter): the generation, read before the token. */
    override fun tokenGeneration(): Long = tokenLimit.generation

    private val serverwechselListener = CopyOnWriteArrayList<() -> Unit>()

    /** The server clients cancel their calls when switching to a different origin (di/ServerClient). */
    override fun onServerwechsel(listener: () -> Unit) { serverwechselListener += listener }

    /** For the swap: origin as in the guard — without binding none, then nothing swaps. */
    override suspend fun tokenStatus(): TokenStatus {
        val herkunft = _tokenOriginState.value ?: wert(dataStore.data.first(), ORIGIN)
        return TokenStatus(tokenJetzt(), herkunft, tokenLimit.generation)
    }

    /** Store the swapped token only if nothing else happened since the swap began. */
    override suspend fun replaceSwappedToken(vorher: TokenStatus, neu: String, requestOrigin: String?): Boolean =
        tokenLimit.replaceIf(vorher, requestOrigin, ::tokenStatus) {
            writeToken(neu, requestOrigin, signedInAt = null)
        }

    /**
     * Is the sign-in older than [TOKEN_MAX_DURATION_DAYS]? A sign-in from
     * a version without a date starts counting now instead of signing out immediately.
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
     * At app start: remove a plaintext token of older versions (never take it over,
     * then one signs in anew) and rekey a ciphertext under the old key.
     *
     * @return true if a plaintext token was removed.
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
     * A token of earlier versions under the weaker key would stay readable until the next start
     * for anyone who reads out the locked device; hence right after unlocking
     * (BrickInventoryApp, ACTION_USER_PRESENT). Without legacy stock no writing.
     */
    override suspend fun levelTokenHigh() {
        if (dataStore.data.first()[AUTH_TOKEN_ENC]?.let(tresor::veraltet) != true) return
        var umgeschluesselt = false
        dataStore.edit { umgeschluesselt = umschluesseln(it) }
        if (umgeschluesselt) fangeAusserAbbruch { tresor.forgetLegacyStock() }
    }

    /**
     * Address, name and origin of earlier versions (plaintext or under the pins' key)
     * under the details' key; if it fails (locked), at the next start. The earlier
     * form goes only when the new one is there: nothing gets lost.
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
     * A ciphertext under the weaker key of earlier versions goes under the one that
     * only works unlocked. In the same edit as the reading: a swap in between would otherwise
     * be overwritten by the old token. The caller deletes the old key only after
     * writing: if the edit fails, a ciphertext without a key would otherwise remain.
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

    /** The ciphertext as stored, only for the server of its binding; never in plaintext. */
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
            // BOTH keys: if the old one remained, one would be signed in again via the legacy stock
            // after sign-out.
            it.remove(AUTH_TOKEN)
            it.remove(AUTH_TOKEN_ENC)
            it.entferne(ORIGIN)
            it.entferne(NAME)
            it.remove(SIGNED_IN_AT)
            // The price alert's mark belongs to the account; the next one would otherwise get its state.
            it.remove(DevicesStore.ALARM_BRAND)
        }
    }
}

/** A detail in its forms: [geheim] now, [alt] under the pins' key, [klar] in plaintext. */
private class Angabe(
    val geheim: Preferences.Key<String>,
    val alt: Preferences.Key<String>?,
    val klar: Preferences.Key<String>,
)
