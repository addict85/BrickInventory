package ch.brickinventoryapp.network.di

import ch.brickinventoryapp.model.domain.ErrorCode
import ch.brickinventoryapp.network.data.api.ErrorBody
import ch.brickinventoryapp.network.util.APP_API_VERSION
import ch.brickinventoryapp.network.util.NetworkPolicy
import ch.brickinventoryapp.network.util.PlaintextRejected
import ch.brickinventoryapp.network.util.VersionsHint
import ch.brickinventoryapp.network.util.followUpMay
import ch.brickinventoryapp.network.util.versionsHint
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.Request
import okhttp3.Response
import java.util.concurrent.atomic.AtomicBoolean

/**
 * What the guard needs to know per request. On the device, TokenStore and
 * Context provide it (ServerClient.kt); as an interface, the guard runs on
 * the JVM against a test server.
 */
interface AccessState {
    fun serverUrl(): String
    fun token(): String
    /** The origin the token is bound to; null means: send to no server. */
    fun tokenOrigin(): String?
    /**
     * Counts sign-in, sign-out and server changes (data/TokenLimit). Read
     * before the token and compared afterwards: what a response triggers only
     * applies to the session the request went out in.
     */
    fun generation(): Long
}

/** The placeholder Retrofit is built against; the guard rewrites it to the server. */
const val PLACEHOLDER_BASE = "http://localhost:3000/"

/**
 * The token's rotation, seen from outside (data/TokenSwap). [due] does
 * not wait — the request succeeded; [needed] rotates and returns the new
 * token so the rejected request can be retried once.
 */
interface RotationReason {
    fun due(oldToken: String)
    /** Only a token with [origin] and from [generation]; a newer one belongs to another session. */
    fun needed(oldToken: String, origin: String?, generation: Long): String?
}

/** Path of the rotation itself: its own response triggers no further one. */
private const val ROTATIONS_PATH = "/api/v2/auth/rotate-token"

/**
 * A 401 with these codes means "confirmation wrong or missing", not "token
 * invalid": the dialog asks for the password again instead of signing out.
 */
private val CONFIRMATION_NEEDED = setOf(ErrorCode.CURRENT_PASSWORD_WRONG, ErrorCode.CURRENT_PASSWORD_REQUIRED,
    ErrorCode.SECOND_FACTOR_WRONG, ErrorCode.SECOND_FACTOR_NEEDED, ErrorCode.PASSKEY_INVALID)

/**
 * Token, language and the plain-text ban for every request of the server
 * clients. A request without TLS stops here before a header is built; the
 * release build's network-security-config is the second line behind it.
 * [development]: debug build, http only to NetworkPolicy.DEVELOPMENT_HOSTS.
 */
class ServerGuard(
    private val situation: AccessState,
    private val isApiClient: Boolean,
    private val development: Boolean,
    private val sessionExpired: () -> Unit,
    private val versionsMessage: ((VersionsHint) -> Unit)? = null,
    /** Extra headers only for our own server (the display language, ServerClient.kt). */
    private val ownHeaders: (original: Request, target: Request.Builder) -> Unit = { _, _ -> },
    private val rotation: RotationReason? = null,
    /** A 403 `only_admins` on a token: the app pulls in its loss of admin rights. */
    private val rightsRevoked: () -> Unit = {},
    /** A 403 `password_switch_needed`: the app shows the screen for the initial password. */
    private val passwordSwitchNeeded: () -> Unit = {},
    /** A 403 `second_factor_required`: the app shows two-factor setup. */
    private val secondFactorRequired: () -> Unit = {},
) : Interceptor {

    private val versionReported = AtomicBoolean(false)

    override fun intercept(chain: Interceptor.Chain): Response {
        val original = chain.request()
        // First: a change after this point shows up as a different generation.
        val generation = situation.generation()
        val serverUrl = situation.serverUrl().trim().trimEnd('/')
        val token = situation.token()
        val reqBuilder = toServer(original, serverUrl)
        val finalUrl = reqBuilder.build().url
        if (!NetworkPolicy.connectionAllowed(finalUrl, development)) throw PlaintextRejected(finalUrl.host)
        val ourServer = isOurServer(finalUrl, serverUrl)
        // Redirects of our own requests only within the path: they carry the token along.
        val basis = if (ourServer) NetworkPolicy.basePath(serverUrl).orEmpty() else ""
        val withToken = setHeaders(original, reqBuilder, token, ourServer, finalUrl)

        val outgoing = reqBuilder.build()
        // The session of the token that last went out; only it may evaluate the response.
        val jobRun = JobRun(outgoing, send(chain, outgoing, basis), withToken && outgoing.header("Authorization") != null, generation)
        followUp(chain, jobRun, basis, ourServer)

        val sameSession = { situation.generation() == jobRun.session }
        val evaluable = jobRun.tokenSentAlong && ourServer
        val swapping = rotation
        if (swapping != null && evaluable && !outgoing.url.encodedPath.endsWith(ROTATIONS_PATH)) {
            jobRun.response = exchanged(chain, jobRun, basis, swapping, sameSession)
        }
        // A 401 or 403 from the previous server does not concern the new session.
        if (evaluable && jobRun.response.code in setOf(401, 403) && sameSession()) reportRejection(jobRun.response)
        if (ourServer) reportVersion(jobRun.response)
        return jobRun.response
    }

    private fun isOurServer(target: HttpUrl, serverUrl: String): Boolean =
        serverUrl.isNotBlank() && NetworkPolicy.isSameOrigin(target, serverUrl) && NetworkPolicy.inBasePath(target, serverUrl)

    /**
     * Retrofit is built against [PLACEHOLDER_BASE]; here the request is rewritten to the
     * configured server. A path prefix (reverse proxy under /brick) is kept. Unreadable throws
     * an IOException: any other exception would tear down the OkHttp thread along with the app.
     */
    private fun toServer(original: Request, serverUrl: String): Request.Builder {
        val reqBuilder = original.newBuilder()
        if (!isApiClient || !original.url.toString().startsWith(PLACEHOLDER_BASE)) return reqBuilder
        val target = serverUrl.ifBlank { PLACEHOLDER_BASE.trimEnd('/') }.toHttpUrlOrNull()
            ?: throw java.io.IOException("Server-Adresse unlesbar")
        val basePath = target.encodedPath.trimEnd('/')
        val newValue = original.url.newBuilder().scheme(target.scheme).host(target.host).port(target.port)
        if (basePath.isNotEmpty()) newValue.encodedPath(basePath + original.url.encodedPath)
        return reqBuilder.url(newValue.build())
    }

    /** Token, API version and our own headers, only for our own server. Returns whether the current token goes along. */
    private fun setHeaders(original: Request, reqBuilder: Request.Builder, token: String, ourServer: Boolean, finalUrl: HttpUrl): Boolean {
        // A token only goes to the origin it is bound to; unbound, it goes to none.
        val origin = situation.tokenOrigin()
        val tokenBelongsHere = origin != null && origin == NetworkPolicy.origin(finalUrl.toString())
        val withToken = token.isNotBlank() && ourServer && tokenBelongsHere
        if (withToken && original.header("Authorization") == null) {
            reqBuilder.header("Authorization", "Bearer $token")
        }
        // Headers set by hand (rotation, SSE, PDF) can carry a token older than the
        // current one — e.g. the previous server's, on a rotation that outlives the
        // switch. So the same rule as for withToken applies here.
        if (original.header("Authorization") != null && !withToken) {
            reqBuilder.removeHeader("Authorization")
        }
        if (ourServer) {
            reqBuilder.header("X-App-Api", APP_API_VERSION.toString())
            ownHeaders(original, reqBuilder)
        }
        return withToken
    }

    /** What last went out and came back, whether with the token, and which session it stems from. */
    private class JobRun(var sent: Request, var response: Response, var tokenSentAlong: Boolean, var session: Long)

    /**
     * Signing in sets the token and immediately fires requests; one can still
     * have gone out without a header (util/Rejected.kt). The token is read
     * now, so its binding is the current one, not the one at send time.
     */
    private fun followUp(chain: Interceptor.Chain, jobRun: JobRun, basis: String, ourServer: Boolean) {
        val outgoing = jobRun.sent
        if (!followUpMay(jobRun.response.code, ourServer, outgoing.header("Authorization") != null, outgoing.method)) return
        val (now, g) = tokenFor(outgoing.url) ?: return
        jobRun.response.close()
        jobRun.sent = outgoing.newBuilder().header("Authorization", "Bearer $now").build()
        jobRun.response = send(chain, jobRun.sent, basis)
        jobRun.tokenSentAlong = true
        jobRun.session = g
    }

    /**
     * The token's rotation: a 401 `token_rotation_noetig` rotates and sends the request once more
     * with the new token; "faellig" only triggers the rotation. Both only for the session the
     * request went out in. Returns the response the caller gets.
     */
    private fun exchanged(chain: Interceptor.Chain, jobRun: JobRun, basis: String, swapping: RotationReason,
                          sameSession: () -> Boolean): Response {
        val old = jobRun.sent.header("Authorization")?.removePrefix("Bearer ")?.trim()
        if (jobRun.response.code == 401) {
            if (errorCode(jobRun.response) != ErrorCode.TOKEN_ROTATION_NEEDED) return jobRun.response
            val newValue = swapping.needed(old.orEmpty(), NetworkPolicy.origin(jobRun.sent.url.toString()), jobRun.session)
                ?.takeIf { sameSession() } ?: return jobRun.response
            // The new token is already stored; this request goes out once with it.
            jobRun.response.close()
            return send(chain, jobRun.sent.newBuilder().header("Authorization", "Bearer $newValue").build(), basis)
        }
        if (jobRun.response.header("X-Token-Rotation") == "faellig" && sameSession()) old?.let { swapping.due(it) }
        return jobRun.response
    }

    /** 401 means signed out, unless the server only wants a confirmation; 403 names what's missing. */
    private fun reportRejection(response: Response) {
        val code = errorCode(response)
        if (response.code == 401 && code !in CONFIRMATION_NEEDED) sessionExpired()
        if (response.code == 403 && code == ErrorCode.ONLY_ADMINS) rightsRevoked()
        if (response.code == 403 && code == ErrorCode.PASSWORD_SWITCH_NEEDED) passwordSwitchNeeded()
        if (response.code == 403 && code == ErrorCode.SECOND_FACTOR_REQUIRED) secondFactorRequired()
    }

    /** A notice about too old an app or too old a server, once per run. */
    private fun reportVersion(response: Response) {
        val report = versionsMessage ?: return
        if (versionReported.get()) return
        versionsHint(
            response.header("X-Api-Version")?.toIntOrNull(),
            response.header("X-Api-Min-App")?.toIntOrNull(),
        )?.let { if (versionReported.compareAndSet(false, true)) report(it) }
    }

    private fun errorCode(response: Response): ErrorCode? =
        runCatching { ErrorBody.read(response.peekBody(16_384).string()).errorCode }.getOrNull()

    /**
     * The current token together with its generation, if it currently belongs to
     * [target]: our own server and the bound origin, both as of now. If the
     * generation changes while reading, the values do not reliably match — then neither.
     */
    private fun tokenFor(target: HttpUrl): Pair<String, Long>? {
        val g = situation.generation()
        val server = situation.serverUrl().trim().trimEnd('/')
        val token = situation.token()
        val origin = situation.tokenOrigin() ?: return null
        val matches = token.isNotBlank() && server.isNotBlank() && NetworkPolicy.isSameOrigin(target, server) &&
            NetworkPolicy.inBasePath(target, server) && origin == NetworkPolicy.origin(target.toString())
        return if (matches && situation.generation() == g) token to g else null
    }

    /**
     * The client does not follow redirects (ServerClient.kt): it would send
     * method and body — password, voucher PIN — to any host a proxy points to.
     * Here only within the same origin; any other redirect reaches the caller
     * as 3xx and so as an error.
     */
    private fun send(chain: Interceptor.Chain, request: Request, basePath: String): Response {
        var out = request
        var response = chain.proceed(out)
        repeat(MAX_REDIRECTS) {
            val target = nextRedirect(out, response, basePath) ?: return response
            response.close()
            out = target
            response = chain.proceed(out)
        }
        return response
    }

    private companion object {
        const val MAX_REDIRECTS = 5
    }
}

/**
 * Where a response redirects to, as the next request — only for the same origin
 * (scheme, host, port) and under [basePath] (empty: the whole host). Like a
 * browser: 307/308 keep method and body, 301/302/303 become GET without a
 * body (HEAD stays HEAD).
 */
internal fun nextRedirect(request: Request, response: Response, basePath: String = ""): Request? {
    if (response.code !in setOf(301, 302, 303, 307, 308)) return null
    val target = response.header("Location")?.let(request.url::resolve) ?: return null
    if (target.scheme != request.url.scheme || !target.host.equals(request.url.host, ignoreCase = true) ||
        target.port != request.url.port) return null
    if (basePath.isNotEmpty() && target.encodedPath != basePath && !target.encodedPath.startsWith("$basePath/")) return null
    val newValue = request.newBuilder().url(target)
    val keep = response.code == 307 || response.code == 308 || request.method == "GET" || request.method == "HEAD"
    if (!keep) newValue.method("GET", null).removeHeader("Content-Type").removeHeader("Content-Length")
    return newValue.build()
}
