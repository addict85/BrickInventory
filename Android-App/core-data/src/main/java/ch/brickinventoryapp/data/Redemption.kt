package ch.brickinventoryapp.data

import ch.brickinventoryapp.dataapi.account.AccountRepository
import ch.brickinventoryapp.dataapi.account.RedemptionOutcome
import ch.brickinventoryapp.network.di.AccessState
import ch.brickinventoryapp.network.di.ServerGuard
import ch.brickinventoryapp.network.util.NetworkPolicy
import ch.brickinventoryapp.network.util.PlaintextRejected
import ch.brickinventoryapp.network.util.ownAddress
import ch.brickinventoryapp.security.CertificateUnresolved
import ch.brickinventoryapp.security.VaultFinding
import ch.brickinventoryapp.security.pinKey
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import javax.inject.Inject
import javax.net.ssl.SSLContext
import javax.net.ssl.X509ExtendedTrustManager

/** Puts a job into the persistent queue (data/local/RedemptionWorker). */
fun interface RedemptionPlanner {
    fun plane(job: RedemptionJob)
}

/** The job for the current token, or null without a token (TokenStore). */
fun interface RedemptionSource {
    suspend fun redemptionJob(): RedemptionJob?
}

enum class LogoutPath { IMMEDIATE, CAUGHT_UP, WITHOUT_JOB }

/**
 * Sign-out at the server: first the short attempt, and if it fails, a queue
 * that retries until the server confirms. Otherwise a token without expiry would stay
 * valid as soon as someone signs out without network.
 */
class LogoutState @Inject constructor(
    private val account: AccountRepository,
    private val source: RedemptionSource,
    private val planner: RedemptionPlanner,
) {
    suspend fun atServer(): LogoutPath {
        // Before the attempt: afterwards sign-out clears the token away.
        val job = source.redemptionJob()
        return when (account.redeemAtServer()) {
            RedemptionOutcome.REDEEMED -> LogoutPath.IMMEDIATE
            RedemptionOutcome.GIVE_UP -> LogoutPath.WITHOUT_JOB
            RedemptionOutcome.LATER -> if (job == null) LogoutPath.WITHOUT_JOB
                else LogoutPath.CAUGHT_UP.also { planner.plane(job) }
        }
    }
}

/**
 * 401 means: the token is already no longer valid, the goal is reached. A
 * redirect (only followed within the server) or another 4xx sentence does not become
 * different the tenth time either; timeout, 429 and 5xx do.
 */
internal fun classifyRedemption(code: Int): RedemptionOutcome = when {
    code in 200..299 || code == 401 -> RedemptionOutcome.REDEEMED
    code == 408 || code == 429 || code >= 500 -> RedemptionOutcome.LATER
    else -> RedemptionOutcome.GIVE_UP
}

/**
 * POST /auth/logout with exactly this token to exactly this server. Via an
 * own guard: the app's one knows no token after sign-out and dropped
 * the header; this one keeps the same rules (https, path, redirects) for the job.
 */
class Redeemer(
    private val basis: OkHttpClient,
    private val development: Boolean,
    /**
     * TLS trust for exactly the job's server ([pinKey]) with its
     * pin. The app's common one only knows the currently set up server.
     */
    private val trustFor: ((key: String, pin: String?) -> X509ExtendedTrustManager)? = null,
) {

    /** [origin]: where the token belongs; a job for a different server sends nothing. */
    fun redeem(serverUrl: String, token: String, pin: String? = null,
                 origin: String? = NetworkPolicy.origin(serverUrl)): RedemptionOutcome {
        val target = ownAddress(serverUrl, "api/v2/auth/logout")
        if (token.isBlank() || target == null) return RedemptionOutcome.GIVE_UP
        if (origin == null || origin != NetworkPolicy.origin(serverUrl)) return RedemptionOutcome.GIVE_UP
        val situation = object : AccessState {
            override fun serverUrl() = serverUrl
            override fun token() = token
            override fun tokenOrigin() = origin
            override fun generation() = 0L
        }
        val declined = java.util.concurrent.atomic.AtomicBoolean(false)
        val client = basis.newBuilder()
            .followRedirects(false).followSslRedirects(false)
            .addInterceptor(ServerGuard(situation, isApiClient = false, development = development, sessionExpired = {}))
            .apply {
                val key = pinKey(serverUrl)
                if (trustFor != null && key != null) {
                    val tm = RemembersRejection(trustFor(key, pin), declined)
                    sslSocketFactory(SSLContext.getInstance("TLS").apply { init(null, arrayOf(tm), null) }.socketFactory, tm)
                }
            }
            .build()
        val request = Request.Builder().url(target).post("{}".toRequestBody("application/json".toMediaType())).build()
        return try {
            client.newCall(request).execute().use { classifyRedemption(it.code) }
        } catch (_: PlaintextRejected) {
            RedemptionOutcome.GIVE_UP
        } catch (e: java.io.IOException) {
            // A certificate that does not match the pin does not become more matching by waiting;
            // nobody can ask in the background.
            // Remembered instead of searched in the cause chain: Conscrypt does not always pass on
            // the trust's exception as cause.
            if (declined.get() || generateSequence<Throwable>(e) { it.cause }.take(8).any { it is CertificateUnresolved }) RedemptionOutcome.GIVE_UP
            else RedemptionOutcome.LATER
        }
    }
}

internal enum class RedemptionStep { DONE, AGAIN, GIVEN_UP }

/** About one week with WorkManager's backoff (30 s, doubled, at most 5 h). */
internal const val REDEMPTION_MAX_ATTEMPTS = 40

/**
 * One run of the worker. A locked keystore is, like a missing network, a
 * reason to wait (util/VaultFinding); a lost key makes the token
 * unusable for a thief too, so there is nothing left to do.
 */
// [deviceLocked]: the token's key only releases after unlocking; waiting
// for it is no failed attempt, otherwise a device locked for days would give up the job.
internal fun redemptionStep(
    finding: VaultFinding,
    attempt: Int,
    deviceLocked: Boolean = false,
    redeem: (String) -> RedemptionOutcome,
): RedemptionStep =
    when (finding) {
        VaultFinding.Gone -> RedemptionStep.GIVEN_UP
        VaultFinding.LockedState ->
            if (!deviceLocked && attempt + 1 >= REDEMPTION_MAX_ATTEMPTS) RedemptionStep.GIVEN_UP
            else RedemptionStep.AGAIN
        is VaultFinding.Readable -> when (redeem(finding.plaintext)) {
            RedemptionOutcome.REDEEMED -> RedemptionStep.DONE
            RedemptionOutcome.GIVE_UP -> RedemptionStep.GIVEN_UP
            RedemptionOutcome.LATER ->
                if (attempt + 1 >= REDEMPTION_MAX_ATTEMPTS) RedemptionStep.GIVEN_UP else RedemptionStep.AGAIN
        }
    }

/** Passes everything on to [inner] and remembers whether a certificate was rejected without clarification. */
// Checks nothing itself: [inner] (PinTrust) makes every decision.
@Suppress("CustomX509TrustManager")
private class RemembersRejection(
    private val inner: X509ExtendedTrustManager,
    private val declined: java.util.concurrent.atomic.AtomicBoolean,
) : X509ExtendedTrustManager() {
    private inline fun <T> track(block: () -> T): T =
        try { block() } catch (e: CertificateUnresolved) { declined.set(true); throw e }

    override fun checkServerTrusted(chain: Array<java.security.cert.X509Certificate>, authType: String) =
        track { inner.checkServerTrusted(chain, authType) }
    override fun checkServerTrusted(chain: Array<java.security.cert.X509Certificate>, authType: String, socket: java.net.Socket?) =
        track { inner.checkServerTrusted(chain, authType, socket) }
    override fun checkServerTrusted(chain: Array<java.security.cert.X509Certificate>, authType: String, engine: javax.net.ssl.SSLEngine?) =
        track { inner.checkServerTrusted(chain, authType, engine) }
    override fun checkClientTrusted(chain: Array<java.security.cert.X509Certificate>, authType: String) =
        inner.checkClientTrusted(chain, authType)
    override fun checkClientTrusted(chain: Array<java.security.cert.X509Certificate>, authType: String, socket: java.net.Socket?) =
        inner.checkClientTrusted(chain, authType, socket)
    override fun checkClientTrusted(chain: Array<java.security.cert.X509Certificate>, authType: String, engine: javax.net.ssl.SSLEngine?) =
        inner.checkClientTrusted(chain, authType, engine)
    override fun getAcceptedIssuers(): Array<java.security.cert.X509Certificate> = inner.acceptedIssuers
}
