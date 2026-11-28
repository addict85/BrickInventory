package ch.brickinventoryapp.data.di

import ch.brickinventoryapp.core.data.BuildConfig
import ch.brickinventoryapp.data.NetworkTrust
import ch.brickinventoryapp.data.PasswordRequired
import ch.brickinventoryapp.data.RightsSignal
import ch.brickinventoryapp.data.SecondFactorRequired
import ch.brickinventoryapp.data.SessionExpiredSignal
import ch.brickinventoryapp.data.TokenMirror
import ch.brickinventoryapp.data.TokenStore
import ch.brickinventoryapp.data.util.LanguageManager
import ch.brickinventoryapp.data.util.networkRecording
import ch.brickinventoryapp.dataapi.message.MessageChannel
import ch.brickinventoryapp.model.text.Message
import ch.brickinventoryapp.network.di.AccessState
import ch.brickinventoryapp.network.di.RotationReason
import ch.brickinventoryapp.network.di.ServerGuard
import ch.brickinventoryapp.network.util.NetworkPolicy
import ch.brickinventoryapp.network.util.RenewableTlsFactory
import ch.brickinventoryapp.network.util.VersionsHint
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.security.CertificateQuestion
import ch.brickinventoryapp.security.ChoiceTrust
import ch.brickinventoryapp.security.PinTrust
import ch.brickinventoryapp.security.SystemRoots
import ch.brickinventoryapp.security.pinKey
import ch.brickinventoryapp.security.spkiFingerprint
import ch.brickinventoryapp.security.trustJob
import okhttp3.ConnectionSpec
import okhttp3.OkHttpClient
import java.io.IOException
import java.util.concurrent.TimeUnit
import javax.inject.Inject

/**
 * The device's access situation. The values come from the in-memory mirror of the
 * TokenStore; only at cold start is the disk waited for, without
 * runBlocking (TokenStore.waitOnStart).
 */
private class DevicesAccess(private val prefs: TokenMirror) : AccessState {
    // Always wait, not only without a mirror value: only afterwards is the old
    // state of the user CAs reset too. After the cold start it returns immediately.
    private fun ready() = prefs.waitOnStart()
    // A QR pairing already talks to the new server; the token stays bound to its
    // origin and does not go there (ServerGuard.setHeaders).
    override fun serverUrl(): String { ready(); return prefs.pairingTargetState.value ?: prefs.serverUrlState.value.orEmpty() }
    // Locked the mirror holds a placeholder: the request fails like a network error and is
    // retried later, instead of going out without a token and reading as „signed out“.
    override fun token(): String {
        ready()
        val token = prefs.authTokenState.value.orEmpty()
        if (token == TokenStore.TOKEN_WIPED) {
            prefs.restoreAfterLock()
            throw IOException("Gerät gesperrt")
        }
        return token
    }
    override fun tokenOrigin(): String? { ready(); return prefs.tokenOriginState.value }
    override fun generation(): Long { ready(); return prefs.tokenGeneration() }
}

private fun trust(ks: java.security.KeyStore?): javax.net.ssl.X509ExtendedTrustManager {
    val tmf = javax.net.ssl.TrustManagerFactory.getInstance(javax.net.ssl.TrustManagerFactory.getDefaultAlgorithm())
    tmf.init(ks)
    return tmf.trustManagers.filterIsInstance<javax.net.ssl.X509ExtendedTrustManager>().first()
}

/** The same system roots as in pinning (without user CAs), read only on first need. */
internal fun systemRoots(): SystemRoots {
    val fingerprints by lazy { trust(null).acceptedIssuers.map { spkiFingerprint(it) }.toSet() }
    return SystemRoots { it in fingerprints }
}

/**
 * System CAs per network_security_config (without user CAs), plus the
 * AndroidCAStore including user CAs for the explicit setting — only for the
 * own server; above that its pinning (util/ServerTrust.kt).
 */
private var trustShared: PinTrust? = null
private var sharedTls: RenewableTlsFactory? = null

/** One SSLContext for all server clients; new as soon as the user CAs switch. */
@Synchronized
private fun serverTls(prefs: NetworkTrust, tm: PinTrust): RenewableTlsFactory {
    sharedTls?.let { return it }
    val factory = RenewableTlsFactory {
        javax.net.ssl.SSLContext.getInstance("TLS").apply { init(null, arrayOf(tm), null) }.socketFactory
    }
    prefs.onUserCaSwitch { factory.renew() }
    return factory.also { sharedTls = it }
}

@Synchronized
private fun trustServer(prefs: NetworkStores, question: CertificateQuestion): PinTrust {
    trustShared?.let { return it }
    val system = trust(null)
    return PinTrust(
        userCaTrust = ChoiceTrust(
            system = system,
            withUser = lazy { trust(java.security.KeyStore.getInstance("AndroidCAStore").apply { load(null) }) },
            userAllowed = { prefs.trust.userCaAllowed() },
        ),
        pins = prefs.trust,
        ownServer = { pinKey(prefs.token.pairingTargetState.value ?: prefs.token.serverUrlState.value.orEmpty()) },
        question = question,
        foreignHosts = system,
    ).also { trustShared = it }
}

/**
 * Only AEAD suites with forward secrecy: MODERN_TLS would still allow CBC and static RSA
 * on TLS 1.2. Plaintext only in the debug build, where the guard lets http to the
 * development hosts through (NetworkPolicy.connectionAllowed).
 */
internal fun serverConnectionSpecs(development: Boolean = NetworkPolicy.development): List<ConnectionSpec> =
    listOf(ConnectionSpec.RESTRICTED_TLS) + if (development) listOf(ConnectionSpec.CLEARTEXT) else emptyList()

/** Token and trust together: the server clients need both, nothing else from the stores. */
internal class NetworkStores @Inject constructor(val token: TokenMirror, val trust: NetworkTrust)

/** API, image and SSE client: the same guard (ServerGuard.kt), own timeouts. */
@Suppress("LongParameterList") // One building block for three clients; the parts differ per client.
internal fun buildInterceptorClient(
    prefs: NetworkStores,
    isApiClient: Boolean,
    sessionExpired: SessionExpiredSignal,
    ctx: android.content.Context,
    /** Where a version hint goes; only the API client reports. */
    messages: MessageChannel? = null,
    /** Waits for the decision about an unknown certificate. */
    question: CertificateQuestion,
    /** Swaps the token when the server requires it; only for clients with a token. */
    rotation: RotationReason? = null,
    /** Only the API client: the admin calls arrive there. */
    rights: RightsSignal? = null,
    /** Only the API client: with a start password the server rejects every fetch. */
    required: PasswordRequired? = null,
    /** Only the API client: the server rejects admin rights without a second factor. */
    factorRequired: SecondFactorRequired? = null,
): OkHttpClient {
    val versionsMessage: ((VersionsHint) -> Unit)? = messages?.let { channel ->
        { hint: VersionsHint ->
            channel.show(Message.Resource(
                if (hint == VersionsHint.APP_TOO_OLD) R.string.api_app_too_old
                else R.string.api_server_too_old))
        }
    }
    val client = OkHttpClient.Builder()
        .apply {
            // The image client too: otherwise image requests would be missing in logcat, and their
            // absence would look like a finding instead of a gap in observation.
            if (BuildConfig.DEBUG) {
                addInterceptor(networkRecording())
            }
        }
        // No redirect past the guard: it only sees what it sends itself, and
        // follows only within the same origin (ServerGuard's send).
        .followRedirects(false)
        .followSslRedirects(false)
        .addInterceptor(ServerGuard(DevicesAccess(prefs.token), isApiClient, NetworkPolicy.development,
            sessionExpired = { sessionExpired.notifyExpired() }, versionsMessage = versionsMessage,
            // The language from the resources: the server answers in the one the UI shows.
            ownHeaders = { original, target ->
                if (original.header("Accept-Language") == null) target.header("Accept-Language",
                    LanguageManager.localizedContext(ctx)
                        .getString(R.string.lang_code))
            }, rotation = rotation, rightsRevoked = { rights?.report() },
            passwordSwitchNeeded = { required?.report() }, secondFactorRequired = { factorRequired?.report() }))
        .apply {
            val tm = trustServer(prefs, question)
            sslSocketFactory(serverTls(prefs.trust, tm), tm)
        }
        .connectionSpecs(serverConnectionSpecs())
        .connectTimeout(15, TimeUnit.SECONDS)
        // An inter-byte timeout; PDF generation runs via job polling.
        .readTimeout(60, TimeUnit.SECONDS)
        .build()
    followsTheServer(prefs, client)
    return client
}

/**
 * The same TLS path as the server clients (pins, user CAs only for the own
 * server), but without the app's guard: the canceller inserts it itself with the job's
 * token.
 */
internal fun buildRedemptionBase(
    prefs: NetworkStores,
    question: CertificateQuestion,
): OkHttpClient = OkHttpClient.Builder()
    .followRedirects(false)
    .followSslRedirects(false)
    .apply {
        val tm = trustServer(prefs, question)
        sslSocketFactory(serverTls(prefs.trust, tm), tm)
    }
    .connectionSpecs(serverConnectionSpecs())
    .connectTimeout(15, TimeUnit.SECONDS)
    .readTimeout(30, TimeUnit.SECONDS)
    .build()

/**
 * Trust per invalidation job (data/Redemption.kt): the pin from the job,
 * otherwise the remembered one — pins stay at sign-out. User CAs as for the
 * own server only by explicit setting.
 */
internal fun jobTrustFactory(prefs: NetworkTrust): (String, String?) -> javax.net.ssl.X509ExtendedTrustManager {
    val system = trust(null)
    val userCaTrust = ChoiceTrust(
        system = system,
        withUser = lazy { trust(java.security.KeyStore.getInstance("AndroidCAStore").apply { load(null) }) },
        userAllowed = { prefs.userCaAllowed() },
    )
    return { key, pin -> trustJob(userCaTrust, system, key, pin ?: prefs.pin(key)) }
}

/**
 * When switching to a different server, cancel running calls; after
 * switching the user CAs, do not keep using a connection with the old trust.
 * For every client with its own dispatcher or pool (the image client has one).
 */
internal fun followsTheServer(prefs: NetworkStores, client: OkHttpClient) {
    prefs.token.onServerSwitch { client.dispatcher.cancelAll() }
    prefs.trust.onUserCaSwitch { client.connectionPool.evictAll() }
}
