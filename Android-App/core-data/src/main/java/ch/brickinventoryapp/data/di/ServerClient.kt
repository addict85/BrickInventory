package ch.brickinventoryapp.data.di

import ch.brickinventoryapp.model.ui.Meldung
import javax.inject.Inject
import android.os.Build
import ch.brickinventoryapp.core.data.BuildConfig
import ch.brickinventoryapp.data.Netzvertrauen
import ch.brickinventoryapp.data.Tokenspiegel
import ch.brickinventoryapp.data.TokenAblage
import java.io.IOException
import ch.brickinventoryapp.network.util.NetworkPolicy
import ch.brickinventoryapp.network.util.VersionsHint
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.PasswordRequired
import ch.brickinventoryapp.data.RightsSignal
import ch.brickinventoryapp.data.SessionExpiredSignal
import ch.brickinventoryapp.data.SecondFactorRequired
import ch.brickinventoryapp.network.util.RenewableTlsFactory
import ch.brickinventoryapp.data.util.LanguageManager
import ch.brickinventoryapp.security.PinTrust
import ch.brickinventoryapp.security.ChoiceTrust
import ch.brickinventoryapp.security.CertificateQuestion
import ch.brickinventoryapp.security.trustJob
import ch.brickinventoryapp.data.util.networkRecording
import ch.brickinventoryapp.security.pinKey
import ch.brickinventoryapp.security.spkiFingerprint
import ch.brickinventoryapp.security.SystemRoots
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.network.di.Rotationsanlass
import ch.brickinventoryapp.network.di.ServerWaechter
import ch.brickinventoryapp.network.di.Zugangslage

/**
 * The device's access situation. The values come from the in-memory mirror of the
 * TokenAblage; only at cold start is the disk waited for, without
 * runBlocking (TokenAblage.waitOnStart).
 */
private class DevicesAccess(private val prefs: Tokenspiegel) : Zugangslage {
    // Always wait, not only without a mirror value: only afterwards is the old
    // state of the user CAs reset too. After the cold start it returns immediately.
    private fun bereit() = prefs.waitOnStart()
    // A QR pairing already talks to the new server; the token stays bound to its
    // origin and does not go there (ServerWaechter.setHeaders).
    override fun serverUrl(): String { bereit(); return prefs.kopplungszielState.value ?: prefs.serverUrlState.value.orEmpty() }
    // Locked the mirror holds a placeholder: the request fails like a network error and is
    // retried later, instead of going out without a token and reading as „signed out“.
    override fun token(): String {
        bereit()
        val token = prefs.authTokenState.value.orEmpty()
        if (token == TokenAblage.TOKEN_WIPED) {
            prefs.restoreAfterLock()
            throw IOException("Gerät gesperrt")
        }
        return token
    }
    override fun tokenOrigin(): String? { bereit(); return prefs.tokenOriginState.value }
    override fun generation(): Long { bereit(); return prefs.tokenGeneration() }
}

private fun vertrauen(ks: java.security.KeyStore?): javax.net.ssl.X509ExtendedTrustManager {
    val tmf = javax.net.ssl.TrustManagerFactory.getInstance(javax.net.ssl.TrustManagerFactory.getDefaultAlgorithm())
    tmf.init(ks)
    return tmf.trustManagers.filterIsInstance<javax.net.ssl.X509ExtendedTrustManager>().first()
}

/** The same system roots as in pinning (without user CAs), read only on first need. */
internal fun systemRoots(): SystemRoots {
    val fingerabdruecke by lazy { vertrauen(null).acceptedIssuers.map { spkiFingerprint(it) }.toSet() }
    return SystemRoots { it in fingerabdruecke }
}

/**
 * System CAs per network_security_config (without user CAs), plus the
 * AndroidCAStore including user CAs for the explicit setting — only for the
 * own server; above that its pinning (util/ServerVertrauen.kt).
 */
private var trustShared: PinTrust? = null
private var sharedTls: RenewableTlsFactory? = null

/** One SSLContext for all server clients; new as soon as the user CAs switch. */
@Synchronized
private fun serverTls(prefs: Netzvertrauen, tm: PinTrust): RenewableTlsFactory {
    sharedTls?.let { return it }
    val factory = RenewableTlsFactory {
        javax.net.ssl.SSLContext.getInstance("TLS").apply { init(null, arrayOf(tm), null) }.socketFactory
    }
    prefs.onUserCaSwitch { factory.renew() }
    return factory.also { sharedTls = it }
}

@Synchronized
private fun trustServer(prefs: Netzablagen, frage: CertificateQuestion): PinTrust {
    trustShared?.let { return it }
    val system = vertrauen(null)
    return PinTrust(
        kette = ChoiceTrust(
            system = system,
            withUser = lazy { vertrauen(java.security.KeyStore.getInstance("AndroidCAStore").apply { load(null) }) },
            userAllowed = { prefs.vertrauen.userCaAllowed() },
        ),
        pins = prefs.vertrauen,
        ownServer = { pinKey(prefs.token.kopplungszielState.value ?: prefs.token.serverUrlState.value.orEmpty()) },
        frage = frage,
        foreignHosts = system,
        ctForced = Build.VERSION.SDK_INT >= ANDROID_16,
    ).also { trustShared = it }
}

/** From here on network_security_config requires Certificate Transparency for public CAs. */
private const val ANDROID_16 = 36

/** Token and trust together: the server clients need both, nothing else from the stores. */
class Netzablagen @Inject constructor(val token: Tokenspiegel, val vertrauen: Netzvertrauen)

/** API, image and SSE client: the same guard (ServerWaechter.kt), own timeouts. */
@Suppress("LongParameterList") // One building block for three clients; the parts differ per client.
internal fun buildInterceptorClient(
    prefs: Netzablagen,
    isApiClient: Boolean,
    sessionExpired: SessionExpiredSignal,
    ctx: android.content.Context,
    /** Where a version hint goes; only the API client reports. */
    meldungen: MeldungsKanal? = null,
    /** Waits for the decision about an unknown certificate. */
    frage: CertificateQuestion,
    /** Swaps the token when the server requires it; only for clients with a token. */
    rotation: Rotationsanlass? = null,
    /** Only the API client: the admin calls arrive there. */
    rights: RightsSignal? = null,
    /** Only the API client: with a start password the server rejects every fetch. */
    pflicht: PasswordRequired? = null,
    /** Only the API client: the server rejects admin rights without a second factor. */
    factorRequired: SecondFactorRequired? = null,
): OkHttpClient {
    val versionsMessage: ((VersionsHint) -> Unit)? = meldungen?.let { kanal ->
        { hinweis: VersionsHint ->
            kanal.zeige(Meldung.Resource(
                if (hinweis == VersionsHint.APP_ZU_ALT) R.string.api_app_zu_alt
                else R.string.api_server_zu_alt))
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
        // follows only within the same origin (ServerWaechter.senden).
        .followRedirects(false)
        .followSslRedirects(false)
        .addInterceptor(ServerWaechter(DevicesAccess(prefs.token), isApiClient, NetworkPolicy.entwicklung,
            sitzungAbgelaufen = { sessionExpired.notifyExpired() }, versionsMessage = versionsMessage,
            // The language from the resources: the server answers in the one the UI shows.
            ownHeaders = { original, ziel ->
                if (original.header("Accept-Language") == null) ziel.header("Accept-Language",
                    LanguageManager.localizedContext(ctx)
                        .getString(R.string.lang_code))
            }, rotation = rotation, rightsRevoked = { rights?.melde() },
            passwordSwitchNeeded = { pflicht?.melde() }, zweiterFaktorPflicht = { factorRequired?.melde() }))
        .apply {
            val tm = trustServer(prefs, frage)
            sslSocketFactory(serverTls(prefs.vertrauen, tm), tm)
        }
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
    prefs: Netzablagen,
    frage: CertificateQuestion,
): OkHttpClient = OkHttpClient.Builder()
    .followRedirects(false)
    .followSslRedirects(false)
    .apply {
        val tm = trustServer(prefs, frage)
        sslSocketFactory(serverTls(prefs.vertrauen, tm), tm)
    }
    .connectTimeout(15, TimeUnit.SECONDS)
    .readTimeout(30, TimeUnit.SECONDS)
    .build()

/**
 * Trust per invalidation job (data/Entwertung.kt): the pin from the job,
 * otherwise the remembered one — pins stay at sign-out. User CAs as for the
 * own server only by explicit setting.
 */
internal fun jobTrustFactory(prefs: Netzvertrauen): (String, String?) -> javax.net.ssl.X509ExtendedTrustManager {
    val system = vertrauen(null)
    val kette = ChoiceTrust(
        system = system,
        withUser = lazy { vertrauen(java.security.KeyStore.getInstance("AndroidCAStore").apply { load(null) }) },
        userAllowed = { prefs.userCaAllowed() },
    )
    return { schluessel, pin -> trustJob(kette, system, schluessel, pin ?: prefs.pin(schluessel)) }
}

/**
 * When switching to a different server, cancel running calls; after
 * switching the user CAs, do not keep using a connection with the old trust.
 * For every client with its own dispatcher or pool (the image client has one).
 */
internal fun followsTheServer(prefs: Netzablagen, client: OkHttpClient) {
    prefs.token.onServerwechsel { client.dispatcher.cancelAll() }
    prefs.vertrauen.onUserCaSwitch { client.connectionPool.evictAll() }
}
