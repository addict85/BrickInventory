package ch.brickinventoryapp.data

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.MutablePreferences
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import ch.brickinventoryapp.data.cache.CacheOwner
import ch.brickinventoryapp.model.coroutines.ApplicationScope
import ch.brickinventoryapp.model.util.LockWipe
import ch.brickinventoryapp.model.util.catchUnlessCancelled
import ch.brickinventoryapp.network.util.NetworkPolicy
import ch.brickinventoryapp.security.DeviceLock
import ch.brickinventoryapp.security.TokenEncryption
import ch.brickinventoryapp.security.VaultFinding
import ch.brickinventoryapp.security.pinKey
import ch.brickinventoryapp.security.readPatient
import ch.brickinventoryapp.security.readToken
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.transformLatest
import kotlinx.coroutines.launch
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import javax.inject.Inject
import javax.inject.Provider
import javax.inject.Singleton

/**
 * Server, token, origin and generation of the signed-in account including the
 * in-memory mirrors for the interceptor. Separate from the DevicesStore;
 * all writes of the token run here under a [TokenLimit].
 */
@Singleton
class TokenStore @Inject constructor(
    private val dataStore: DataStore<Preferences>,
    private val vault: TokenEncryption,
    /** Pins for the invalidation job and the one-time cleanup tasks at start. */
    private val device: DevicesStore,
    /** The mirrors run as long as the app lives; no own scope without an owner. */
    @param:ApplicationScope private val prefsScope: CoroutineScope,
    /** Screen off with a secure lock: the token leaves the interceptor's mirror (wipeTokenMirror). */
    private val lockWipe: LockWipe = LockWipe(),
    /**
     * With a locked device reading the token waits for unlocking (readToken).
     * Stands before [redemption]: a trailing lambda means the scheduler, not the lock.
     */
    private val lock: DeviceLock = DeviceLock { false },
    /** For a token that a server switch discards without it having been readable (saveServerUrl). */
    private val redemption: Provider<RedemptionPlanner> = Provider { RedemptionPlanner {} },
) : TokenMirror, TokenAdoption, CacheOwner, RedemptionSource, Credentials, LoginState, SessionEnd {
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
        /** The server that issued the token (NetworkPolicy's origin); it goes only there. */
        val TOKEN_ORIGIN_SECRET = stringPreferencesKey("token_herkunft_geheim")
        /** Plaintext of older versions: taken over once into [SIGNED_IN_SECRET] (loggedInAt). */
        val SIGNED_IN_AT = longPreferencesKey("angemeldet_am")
        /**
         * When the sign-in happened with password, passkey or QR, bound to the token and
         * under the details' key: a later date or one copied from another sign-in fails the check.
         */
        val SIGNED_IN_SECRET = stringPreferencesKey("angemeldet_am_geheim")

        /**
         * Stands in the mirror while the device is locked: not blank (signed in stays signed in),
         * but never a token. The interceptor refuses it (di/ServerClient) instead of sending it.
         */
        internal const val TOKEN_WIPED = "\u0000gesperrt"

        /**
         * Until then a plaintext date of older versions is still taken over; afterwards every sign-in
         * still valid carries the sealed one, and a missing one means: tampered, sign in anew.
         */
        internal const val LEGACY_DATE_UNTIL = 1_811_808_000_000L // 2027-06-01: older ones ran out after 180 days
        /** Plaintext and earlier form, like [SERVER_URL] and [SERVER_URL_ENC]. */
        val USERNAME     = stringPreferencesKey("username")
        val USERNAME_ENC = stringPreferencesKey("username_enc")
        val USERNAME_SECRET = stringPreferencesKey("username_geheim")

        private val ADDRESS = Info(SERVER_URL_SECRET, SERVER_URL_ENC, SERVER_URL)
        private val NAME = Info(USERNAME_SECRET, USERNAME_ENC, USERNAME)
        private val ORIGIN = Info(TOKEN_ORIGIN_SECRET, null, TOKEN_ORIGIN)
    }

    /** The raw values of a detail in all forms; if none changes, nothing has to be read anew. */
    private fun raw(prefs: Preferences, a: Info): List<String?> = listOf(prefs[a.secret], a.old?.let { prefs[it] }, prefs[a.clear])

    /** An earlier form (under the pins' key or plaintext) until the start takes it over. */
    private fun earlier(raw: List<String?>, a: Info): String? =
        a.old?.let { k -> raw[1]?.let { device.decryptOldDetail(it, k.name) } } ?: raw[2]

    /** First the ciphertext, then an earlier form. Locked means wait, not „no address“. */
    private fun open(raw: List<String?>, a: Info): VaultFinding {
        val b = raw[0]?.let { device.openDetail(it, a.secret.name) } ?: VaultFinding.Gone
        if (b != VaultFinding.Gone) return b
        return earlier(raw, a)?.let { VaultFinding.Readable(it) } ?: VaultFinding.Gone
    }

    /** Without waiting; locked is null here like „not there“. */
    private fun value(prefs: Preferences, a: Info): String? = (open(raw(prefs, a), a) as? VaultFinding.Readable)?.plaintext

    /** Waits for unlocking with a locked device, like the token (readPatient). */
    @OptIn(ExperimentalCoroutinesApi::class)
    private fun flow(a: Info): Flow<String> = dataStore.data.map { raw(it, a) }.distinctUntilChanged()
        .transformLatest { r -> readPatient({ open(r, a) }, null, report = { emit(it) }, lock = lock) }

    private fun encrypt(a: Info, value: String): String =
        device.encryptDetail(value, a.secret.name) ?: throw IOException("${a.secret.name} gerade nicht verschlüsselbar")

    private fun MutablePreferences.set(a: Info, secret: String) {
        this[a.secret] = secret
        a.old?.let { remove(it) }
        remove(a.clear)
    }

    private fun MutablePreferences.remove(a: Info) {
        remove(a.secret)
        a.old?.let { remove(it) }
        remove(a.clear)
    }

    val serverUrl: Flow<String> = flow(ADDRESS).map(::schemaSmall)

    private fun addressFrom(prefs: Preferences): String = schemaSmall(value(prefs, ADDRESS) ?: "")

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
        .transformLatest { secret -> readToken(vault, secret, null, report = { emit(it) }, lock = lock) }
    val username:  Flow<String> = flow(NAME)

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
    private val _pairingTarget = MutableStateFlow<String?>(null)
    override val pairingTargetState: StateFlow<String?> = _pairingTarget.asStateFlow()
    fun pairingTarget(url: String?) {
        _pairingTarget.value = url
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

    private fun <R, T> mirror(raw: (Preferences) -> R, target: MutableStateFlow<T?>, read: suspend (R, suspend (T) -> Unit) -> Unit) =
        prefsScope.launch {
            tokenLimit.mirror(dataStore.data, { dataStore.data.first() }, raw, read,
                set = { target.value = it }, onRead = readStart::countDown)
        }

    /**
     * The token as it applies now — not as it last stood on disk.
     * `authToken` lags behind the write; every fetch that reads it in the window after
     * sign-in would go out without a token. That is why SSE clients, CSV service,
     * PDF export and price alert worker all read here: first the in-memory value, only at
     * cold start the disk.
     */
    override suspend fun tokenNow(): String = _authTokenState.value?.takeUnless { it == TOKEN_WIPED } ?: authToken.first()

    /** The same rule for the server address — for the same reason. */
    override suspend fun serverUrlNow(): String = _serverUrlState.value ?: serverUrl.first()

    /**
     * The scope of the response cache: server and token. The token belongs to exactly
     * one account, and it changes on every sign-in — already at the moment
     * the interceptor reads it, not only after the username.
     */
    override suspend fun accountArea(): String? {
        val server = serverUrlNow().trim().trimEnd('/')
        val token = tokenNow()
        if (server.isBlank() || token.isBlank()) return null
        val name = username.first()
        return "$server\n" + name.ifBlank { token }
    }

    /** From the same mirrors as [accountArea]; null until the cold start has been read. */
    override fun accountAreaFlow(): Flow<String?> =
        combine(_serverUrlState, _authTokenState, username) { s, t, name -> Triple(s, t, name) }
            // Locked the account stays the same; only the token is out of memory.
            .filter { it.second != TOKEN_WIPED }
            .map { (s, t, name) ->
                val server = s?.trim()?.trimEnd('/').orEmpty()
                if (server.isBlank() || t.isNullOrBlank()) null else "$server\n" + name.ifBlank { t }
            }.distinctUntilChanged()

    override suspend fun cacheArea(): String? {
        val server = serverUrlNow().trim().trimEnd('/')
        val token = tokenNow()
        return if (server.isBlank() || token.isBlank()) null else "$server\n$token"
    }

    init {
        // Catching up from the DataStore: for the cold start and for changes
        // that did not come via the save functions (rekeying at start).
        mirror<List<String?>, String>({ raw(it, ADDRESS) }, _serverUrlState) { r, report ->
            readPatient({ open(r, ADDRESS) }, null, report = { report(schemaSmall(it)) }, lock = lock)
        }
        mirror<String?, String>({ it[AUTH_TOKEN_ENC] }, _authTokenState) { secret, report ->
            readToken(vault, secret, null, report, lock = lock)
        }
        mirror<List<String?>, String?>({ raw(it, ORIGIN) }, _tokenOriginState) { r, report ->
            readPatient({ open(r, ORIGIN) }, null, report = { report(it.ifEmpty { null }) }, lock = lock)
        }
        lockWipe.register(::wipeTokenMirror, ::restoreAfterLock)
        prefsScope.launch {
            try {
                device.prepareBefore()
                catchUnlessCancelled { bindLegacyStock() }
                catchUnlessCancelled { dataStore.edit { adoptDetails(it) } }
                // Cleaning up is secondary: if it fails, the app starts anyway.
                catchUnlessCancelled { dataStore.edit { PlaintextRemainder.remove(it) } }
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
            val different = !NetworkPolicy.sameServer(serverUrlNow(), normalized)
            // Running calls belong to the old server; their responses should no longer trigger anything.
            if (different) serverSwitchListener.forEach { it() }
            different
        }
        tokenLimit.write(newSession = newOrigin) {
            // Decided via the disk, not via memory: with a locked
            // keystore memory reports "", but the token is still there (Tresorbefund).
            val plate = dataStore.data.first()
            // Before everything else: if it cannot be stored, everything stays with the old server.
            val address = encrypt(ADDRESS, normalized)
            val oldAddress = serverUrlNow()
            val origin = value(plate, ORIGIN) ?: _tokenOriginState.value ?: oldAddress
            val hasToken = plate[AUTH_TOKEN_ENC] != null || tokenNow().isNotBlank()
            val other = hasToken &&
                (!NetworkPolicy.sameOrigin(origin, normalized) ||
                    !NetworkPolicy.sameServer(oldAddress, normalized))
            if (other) {
                orphanedToken(plate, oldAddress)?.let { runCatching { redemption.get().plane(it) } }
                _authTokenState.value = ""; _tokenOriginState.value = null
            }
            _serverUrlState.value = normalized
            dataStore.edit {
                it.set(ADDRESS, address)
                if (other) {
                    it.remove(AUTH_TOKEN); it.remove(AUTH_TOKEN_ENC); it.remove(ORIGIN); it.remove(NAME)
                    it.remove(SIGNED_IN_AT); it.remove(SIGNED_IN_SECRET)
                }
            }
        }
    }

    /**
     * The job for a token that is discarded without sign-out: only a readable session
     * is signed out (LoginViewModel). The job needs no plaintext and
     * goes to the server of the binding, never to the new one.
     */
    private fun orphanedToken(plate: Preferences, oldAddress: String): RedemptionJob? {
        val secret = plate[AUTH_TOKEN_ENC] ?: return null
        val origin = value(plate, ORIGIN) ?: NetworkPolicy.origin(oldAddress)
        if (oldAddress.isBlank() || origin == null || origin != NetworkPolicy.origin(oldAddress)) return null
        return RedemptionJob(oldAddress, secret, pinKey(oldAddress)?.let(device::pin), origin)
    }

    /**
     * A token of older versions without binding belongs to the registered server. Bound once
     * at start, because the guard sends an unbound token nowhere.
     */
    private suspend fun bindLegacyStock() {
        dataStore.edit { p ->
            if (p[AUTH_TOKEN_ENC] == null || raw(p, ORIGIN).any { it != null }) return@edit
            NetworkPolicy.origin(addressFrom(p))?.let { p.set(ORIGIN, encrypt(ORIGIN, it)); _tokenOriginState.value = it }
        }
    }

    /**
     * Store the token, only encrypted now. The old plaintext entry is removed in the same
     * step — otherwise it would stay readable, and the encryption would be decoration.
     */
    suspend fun saveAuthToken(token: String) = tokenLimit.write {
        writeToken(token, NetworkPolicy.origin(serverUrlNow()), loggedInAt = System.currentTimeMillis())
    }

    /**
     * FIRST into memory: the caller fires the first requests immediately afterwards,
     * and the interceptor reads the value synchronously. [loggedInAt] only
     * on a sign-in: a swap carries the date of [previousToken] over to the new one.
     */
    private suspend fun writeToken(token: String, origin: String?, loggedInAt: Long?, previousToken: String? = null) {
        // Encrypt first: if it fails (locked), memory and disk still stand at the old values.
        val secret = vault.encrypt(token)
        val originSecret = origin?.let { encrypt(ORIGIN, it) }
        val datum = loggedInAt ?: previousToken?.let { old ->
            (loggedInFrom(dataStore.data.first(), old, System.currentTimeMillis()) as? LoginStatus.At)?.ms
        }
        // Not carried over (tampered): the old seal stays, does not match, and the next start signs out.
        val sealed = datum?.let { sealLoggedIn(it, token) }
        _tokenOriginState.value = origin
        _authTokenState.value = token
        dataStore.edit {
            it[AUTH_TOKEN_ENC] = secret
            it.remove(AUTH_TOKEN)
            if (originSecret != null) it.set(ORIGIN, originSecret) else it.remove(ORIGIN)
            if (sealed != null) { it[SIGNED_IN_SECRET] = sealed; it.remove(SIGNED_IN_AT) }
        }
    }

    /** The date with a tag of the token; AES-GCM under the details' key, which only works unlocked. */
    private fun sealLoggedIn(ms: Long, token: String): String =
        device.encryptDetail("$ms:${tokenTag(token)}", SIGNED_IN_SECRET.name)
            ?: throw IOException("${SIGNED_IN_SECRET.name} gerade nicht verschlüsselbar")

    /** Sealed date of [token]; otherwise a plaintext one of older versions until [LEGACY_DATE_UNTIL]. */
    private fun loggedInFrom(prefs: Preferences, token: String, now: Long): LoginStatus {
        prefs[SIGNED_IN_SECRET]?.let { secret ->
            return when (val b = device.openDetail(secret, SIGNED_IN_SECRET.name)) {
                is VaultFinding.Readable -> b.plaintext.split(':').takeIf { it.size == 2 && it[1] == tokenTag(token) }
                    ?.get(0)?.toLongOrNull()?.let { LoginStatus.At(it, legacy = false) } ?: LoginStatus.Missing
                VaultFinding.LockedState -> LoginStatus.Locked
                VaultFinding.Gone -> LoginStatus.Missing
            }
        }
        // A date in the future would extend the sign-in; at most now counts.
        val old = prefs[SIGNED_IN_AT] ?: return LoginStatus.Missing
        return if (now < LEGACY_DATE_UNTIL) LoginStatus.At(minOf(old, now), legacy = true) else LoginStatus.Missing
    }

    /** Screen off with a secure lock: the interceptor gets a placeholder until unlocking. */
    private fun wipeTokenMirror() {
        prefsScope.launch {
            tokenLimit.write<Unit>(newSession = { false }) {
                if (!_authTokenState.value.isNullOrBlank()) _authTokenState.value = TOKEN_WIPED
            }
        }
    }

    private val restoring = AtomicBoolean(false)

    /** Reads the token from disk again; locked, readToken waits for unlocking. */
    override fun restoreAfterLock() {
        if (_authTokenState.value != TOKEN_WIPED || !restoring.compareAndSet(false, true)) return
        prefsScope.launch {
            try {
                // readToken reports "" after a few seconds of a still-locked keystore: "not yet",
                // not "signed out". Taken as the token, the mirror would stay empty for the rest of
                // the process (every request 401, the session-expired hint), because the unlock only
                // restores a placeholder. So keep it; the unlock or the next request reads again.
                val token = authToken.first().ifEmpty {
                    when (val f = dataStore.data.first()[AUTH_TOKEN_ENC]?.let(vault::open)) {
                        is VaultFinding.Readable -> f.plaintext
                        VaultFinding.LockedState -> return@launch
                        VaultFinding.Gone, null -> ""
                    }
                }
                tokenLimit.write<Unit>(newSession = { false }) {
                    if (_authTokenState.value == TOKEN_WIPED) _authTokenState.value = token
                }
            } finally {
                restoring.set(false)
            }
        }
    }

    /** For the guard (di/ServerGuard): the generation, read before the token. */
    override fun tokenGeneration(): Long = tokenLimit.generation

    private val serverSwitchListener = CopyOnWriteArrayList<() -> Unit>()

    /** The server clients cancel their calls when switching to a different origin (di/ServerClient). */
    override fun onServerSwitch(listener: () -> Unit) { serverSwitchListener += listener }

    /** For the swap: origin as in the guard — without binding none, then nothing swaps. */
    override suspend fun tokenStatus(): TokenStatus {
        val origin = _tokenOriginState.value ?: value(dataStore.data.first(), ORIGIN)
        return TokenStatus(tokenNow(), origin, tokenLimit.generation)
    }

    /** Store the swapped token only if nothing else happened since the swap began. */
    override suspend fun replaceSwappedToken(before: TokenStatus, newValue: String, requestOrigin: String?): Boolean =
        tokenLimit.replaceIf(before, requestOrigin, ::tokenStatus) {
            writeToken(newValue, requestOrigin, loggedInAt = null, previousToken = before.token)
        }

    /**
     * Is the sign-in older than [TOKEN_MAX_DURATION_DAYS]? Without a date that matches the
     * token (deleted, altered, copied) it counts as expired: otherwise removing it would
     * restart the clock. Locked it cannot be read; then it is checked on the next start.
     */
    suspend fun loginExpired(now: Long = System.currentTimeMillis()): Boolean {
        val token = tokenNow().ifBlank { return false }
        return when (val at = loggedInFrom(dataStore.data.first(), token, now)) {
            is LoginStatus.At -> {
                if (at.legacy) adoptLegacyDate(at.ms, token)
                loginOverdue(at.ms, now)
            }
            LoginStatus.Locked -> false
            LoginStatus.Missing -> true
        }
    }

    /** Less than [LOGIN_WARNING_DAYS] left: the session asks for a new sign-in in time. */
    suspend fun loginExpiresSoon(now: Long = System.currentTimeMillis()): Boolean {
        val token = tokenNow().ifBlank { return false }
        val at = loggedInFrom(dataStore.data.first(), token, now) as? LoginStatus.At ?: return false
        return loginDueSoon(at.ms, now)
    }

    /** The plaintext date of older versions goes under the seal; only if the token is still the same. */
    private suspend fun adoptLegacyDate(ms: Long, token: String) = tokenLimit.write<Unit>(newSession = { false }) {
        if (tokenNow() != token) return@write
        val sealed = catchUnlessCancelled { sealLoggedIn(ms, token) }.getOrNull() ?: return@write
        dataStore.edit { it[SIGNED_IN_SECRET] = sealed; it.remove(SIGNED_IN_AT) }
    }

    /**
     * At app start: remove a plaintext token of older versions (never take it over,
     * then one signs in anew) and rekey a ciphertext under the old key.
     *
     * @return true if a plaintext token was removed.
     */
    override suspend fun adoptOldToken(): Boolean {
        var removed = false
        var rekeyed = false
        dataStore.edit { prefs ->
            removed = !prefs[AUTH_TOKEN].isNullOrEmpty()
            prefs.remove(AUTH_TOKEN)
            rekeyed = rekey(prefs)
        }
        if (rekeyed) catchUnlessCancelled { vault.forgetLegacyStock() }
        return removed
    }

    /**
     * A token of earlier versions under the weaker key would stay readable until the next start
     * for anyone who reads out the locked device; hence right after unlocking
     * (BrickInventoryApp, ACTION_USER_PRESENT). Without legacy stock no writing.
     */
    override suspend fun levelTokenHigh() {
        if (dataStore.data.first()[AUTH_TOKEN_ENC]?.let(vault::stale) != true) return
        var rekeyed = false
        dataStore.edit { rekeyed = rekey(it) }
        if (rekeyed) catchUnlessCancelled { vault.forgetLegacyStock() }
    }

    /**
     * Address, name and origin of earlier versions (plaintext or under the pins' key)
     * under the details' key; if it fails (locked), at the next start. The earlier
     * form goes only when the new one is there: nothing gets lost.
     */
    private fun adoptDetails(prefs: MutablePreferences) {
        for (a in listOf(ADDRESS, NAME, ORIGIN)) {
            if (prefs[a.secret] == null) {
                val before = earlier(raw(prefs, a), a) ?: continue
                prefs[a.secret] = device.encryptDetail(before, a.secret.name) ?: continue
            }
            a.old?.let { prefs.remove(it) }
            prefs.remove(a.clear)
        }
    }

    /**
     * A ciphertext under the weaker key of earlier versions goes under the one that
     * only works unlocked. In the same edit as the reading: a swap in between would otherwise
     * be overwritten by the old token. The caller deletes the old key only after
     * writing: if the edit fails, a ciphertext without a key would otherwise remain.
     */
    private fun rekey(prefs: MutablePreferences): Boolean {
        val secret = prefs[AUTH_TOKEN_ENC]?.takeIf(vault::stale) ?: return false
        val clear = (vault.open(secret) as? VaultFinding.Readable)?.plaintext ?: return false
        val newValue = catchUnlessCancelled { vault.encrypt(clear) }.getOrNull() ?: return false
        if (vault.stale(newValue)) return false
        prefs[AUTH_TOKEN_ENC] = newValue
        return true
    }
    suspend fun saveUsername(name: String) {
        val secret = encrypt(NAME, name)
        dataStore.edit { it.set(NAME, secret) }
    }

    /** The ciphertext as stored, only for the server of its binding; never in plaintext. */
    override suspend fun redemptionJob(): RedemptionJob? {
        val plate = dataStore.data.first()
        val secret = plate[AUTH_TOKEN_ENC] ?: return null
        val server = serverUrlNow().ifBlank { return null }
        val origin = value(plate, ORIGIN) ?: return null
        if (origin != NetworkPolicy.origin(server)) return null
        return RedemptionJob(server, secret, pinKey(server)?.let(device::pin), origin)
    }

    override suspend fun clearSession(): Unit = tokenLimit.write<Unit> {
        _authTokenState.value = ""
        _tokenOriginState.value = null
        dataStore.edit {
            // BOTH keys: if the old one remained, one would be signed in again via the legacy stock
            // after sign-out.
            it.remove(AUTH_TOKEN)
            it.remove(AUTH_TOKEN_ENC)
            it.remove(ORIGIN)
            it.remove(NAME)
            it.remove(SIGNED_IN_AT)
            it.remove(SIGNED_IN_SECRET)
            // The price alert's mark belongs to the account; the next one would otherwise get its state.
            it.remove(DevicesStore.ALARM_BRAND)
        }
    }
}

/** The sign-in date as found: readable and matching, not readable right now, or not to be trusted. */
private sealed class LoginStatus {
    class At(val ms: Long, val legacy: Boolean) : LoginStatus()
    object Locked : LoginStatus()
    object Missing : LoginStatus()
}

/** 128 bits of the token's SHA-256: binds the date without the token itself lying in it. */
private fun tokenTag(token: String): String =
    MessageDigest.getInstance("SHA-256").digest(token.toByteArray(Charsets.UTF_8)).take(16)
        .joinToString("") { "%02x".format(it) }

/** A detail in its forms: [secret] now, [old] under the pins' key, [clear] in plaintext. */
private class Info(
    val secret: Preferences.Key<String>,
    val old: Preferences.Key<String>?,
    val clear: Preferences.Key<String>,
)
