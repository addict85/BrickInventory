package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.repository.AccountRepository
import ch.brickinventoryapp.network.di.ServerWaechter
import ch.brickinventoryapp.network.di.Zugangslage
import ch.brickinventoryapp.network.util.PlaintextRejected
import ch.brickinventoryapp.network.util.NetworkPolicy
import ch.brickinventoryapp.security.Tresorbefund
import ch.brickinventoryapp.security.CertificateUnresolved
import ch.brickinventoryapp.network.util.ownAddress
import ch.brickinventoryapp.security.pinKey
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import javax.inject.Inject
import javax.net.ssl.SSLContext
import javax.net.ssl.X509ExtendedTrustManager

/** Puts a job into the persistent queue (data/local/EntwertungsWorker). */
fun interface RedemptionPlanner {
    fun plane(job: Entwertungsauftrag)
}

/** The job for the current token, or null without a token (TokenAblage). */
fun interface Entwertungsquelle {
    suspend fun entwertungsauftrag(): Entwertungsauftrag?
}

enum class Abmeldeweg { SOFORT, CAUGHT_UP, WITHOUT_JOB }

/**
 * Sign-out at the server: first the short attempt, and if it fails, a queue
 * that retries until the server confirms. Otherwise a token without expiry would stay
 * valid as soon as someone signs out without network.
 */
class Abmeldung @Inject constructor(
    private val konto: AccountRepository,
    private val quelle: Entwertungsquelle,
    private val planner: RedemptionPlanner,
) {
    suspend fun atServer(): Abmeldeweg {
        // Before the attempt: afterwards sign-out clears the token away.
        val job = quelle.entwertungsauftrag()
        return when (konto.redeemAtServer()) {
            Entwertungsergebnis.ENTWERTET -> Abmeldeweg.SOFORT
            Entwertungsergebnis.GIVE_UP -> Abmeldeweg.WITHOUT_JOB
            Entwertungsergebnis.LATER -> if (job == null) Abmeldeweg.WITHOUT_JOB
                else Abmeldeweg.CAUGHT_UP.also { planner.plane(job) }
        }
    }
}

enum class Entwertungsergebnis { ENTWERTET, LATER, GIVE_UP }

/**
 * 401 means: the token is already no longer valid, the goal is reached. A
 * redirect (only followed within the server) or another 4xx sentence does not become
 * different the tenth time either; timeout, 429 and 5xx do.
 */
internal fun classifyRedemption(code: Int): Entwertungsergebnis = when {
    code in 200..299 || code == 401 -> Entwertungsergebnis.ENTWERTET
    code == 408 || code == 429 || code >= 500 -> Entwertungsergebnis.LATER
    else -> Entwertungsergebnis.GIVE_UP
}

/**
 * POST /auth/logout with exactly this token to exactly this server. Via an
 * own guard: the app's one knows no token after sign-out and dropped
 * the header; this one keeps the same rules (https, path, redirects) for the job.
 */
class Redeemer(
    private val basis: OkHttpClient,
    private val entwicklung: Boolean,
    /**
     * TLS trust for exactly the job's server ([pinKey]) with its
     * pin. The app's common one only knows the currently set up server.
     */
    private val trustFor: ((schluessel: String, pin: String?) -> X509ExtendedTrustManager)? = null,
) {

    /** [herkunft]: where the token belongs; a job for a different server sends nothing. */
    fun redeem(serverUrl: String, token: String, pin: String? = null,
                 herkunft: String? = NetworkPolicy.herkunft(serverUrl)): Entwertungsergebnis {
        val ziel = ownAddress(serverUrl, "api/v1/auth/logout")
        if (token.isBlank() || ziel == null) return Entwertungsergebnis.GIVE_UP
        if (herkunft == null || herkunft != NetworkPolicy.herkunft(serverUrl)) return Entwertungsergebnis.GIVE_UP
        val situation = object : Zugangslage {
            override fun serverUrl() = serverUrl
            override fun token() = token
            override fun tokenOrigin() = herkunft
            override fun generation() = 0L
        }
        val abgelehnt = java.util.concurrent.atomic.AtomicBoolean(false)
        val client = basis.newBuilder()
            .followRedirects(false).followSslRedirects(false)
            .addInterceptor(ServerWaechter(situation, isApiClient = false, entwicklung = entwicklung, sitzungAbgelaufen = {}))
            .apply {
                val schluessel = pinKey(serverUrl)
                if (trustFor != null && schluessel != null) {
                    val tm = RemembersRejection(trustFor(schluessel, pin), abgelehnt)
                    sslSocketFactory(SSLContext.getInstance("TLS").apply { init(null, arrayOf(tm), null) }.socketFactory, tm)
                }
            }
            .build()
        val anfrage = Request.Builder().url(ziel).post("{}".toRequestBody("application/json".toMediaType())).build()
        return try {
            client.newCall(anfrage).execute().use { classifyRedemption(it.code) }
        } catch (_: PlaintextRejected) {
            Entwertungsergebnis.GIVE_UP
        } catch (e: java.io.IOException) {
            // A certificate that does not match the pin does not become more matching by waiting;
            // nobody can ask in the background.
            // Remembered instead of searched in the cause chain: Conscrypt does not always pass on
            // the trust's exception as cause.
            if (abgelehnt.get() || generateSequence<Throwable>(e) { it.cause }.take(8).any { it is CertificateUnresolved }) Entwertungsergebnis.GIVE_UP
            else Entwertungsergebnis.LATER
        }
    }
}

internal enum class Entwertungsschritt { FERTIG, AGAIN, GIVEN_UP }

/** About one week with WorkManager's backoff (30 s, doubled, at most 5 h). */
internal const val REDEMPTION_MAX_ATTEMPTS = 40

/**
 * One run of the worker. A locked keystore is, like a missing network, a
 * reason to wait (util/Tresorbefund); a lost key makes the token
 * unusable for a thief too, so there is nothing left to do.
 */
// [deviceLocked]: the token's key only releases after unlocking; waiting
// for it is no failed attempt, otherwise a device locked for days would give up the job.
internal fun redemptionStep(
    finding: Tresorbefund,
    attempt: Int,
    deviceLocked: Boolean = false,
    redeem: (String) -> Entwertungsergebnis,
): Entwertungsschritt =
    when (finding) {
        Tresorbefund.Weg -> Entwertungsschritt.GIVEN_UP
        Tresorbefund.Gesperrt ->
            if (!deviceLocked && attempt + 1 >= REDEMPTION_MAX_ATTEMPTS) Entwertungsschritt.GIVEN_UP
            else Entwertungsschritt.AGAIN
        is Tresorbefund.Readable -> when (redeem(finding.klartext)) {
            Entwertungsergebnis.ENTWERTET -> Entwertungsschritt.FERTIG
            Entwertungsergebnis.GIVE_UP -> Entwertungsschritt.GIVEN_UP
            Entwertungsergebnis.LATER ->
                if (attempt + 1 >= REDEMPTION_MAX_ATTEMPTS) Entwertungsschritt.GIVEN_UP else Entwertungsschritt.AGAIN
        }
    }

/** Passes everything on to [innen] and remembers whether a certificate was rejected without clarification. */
// Checks nothing itself: [innen] (PinTrust) makes every decision.
@Suppress("CustomX509TrustManager")
private class RemembersRejection(
    private val innen: X509ExtendedTrustManager,
    private val abgelehnt: java.util.concurrent.atomic.AtomicBoolean,
) : X509ExtendedTrustManager() {
    private inline fun <T> merke(block: () -> T): T =
        try { block() } catch (e: CertificateUnresolved) { abgelehnt.set(true); throw e }

    override fun checkServerTrusted(chain: Array<java.security.cert.X509Certificate>, authType: String) =
        merke { innen.checkServerTrusted(chain, authType) }
    override fun checkServerTrusted(chain: Array<java.security.cert.X509Certificate>, authType: String, socket: java.net.Socket?) =
        merke { innen.checkServerTrusted(chain, authType, socket) }
    override fun checkServerTrusted(chain: Array<java.security.cert.X509Certificate>, authType: String, engine: javax.net.ssl.SSLEngine?) =
        merke { innen.checkServerTrusted(chain, authType, engine) }
    override fun checkClientTrusted(chain: Array<java.security.cert.X509Certificate>, authType: String) =
        innen.checkClientTrusted(chain, authType)
    override fun checkClientTrusted(chain: Array<java.security.cert.X509Certificate>, authType: String, socket: java.net.Socket?) =
        innen.checkClientTrusted(chain, authType, socket)
    override fun checkClientTrusted(chain: Array<java.security.cert.X509Certificate>, authType: String, engine: javax.net.ssl.SSLEngine?) =
        innen.checkClientTrusted(chain, authType, engine)
    override fun getAcceptedIssuers(): Array<java.security.cert.X509Certificate> = innen.acceptedIssuers
}
