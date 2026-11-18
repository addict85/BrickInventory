package ch.brickinventoryapp.netz.di

import ch.brickinventoryapp.netz.data.api.Fehlerrumpf
import ch.brickinventoryapp.model.fach.Fehlercode
import ch.brickinventoryapp.netz.util.APP_API_VERSION
import ch.brickinventoryapp.netz.util.KlartextAbgelehnt
import ch.brickinventoryapp.netz.util.NetworkPolicy
import ch.brickinventoryapp.netz.util.VersionsHinweis
import ch.brickinventoryapp.netz.util.darfNachfassen
import ch.brickinventoryapp.netz.util.versionsHinweis
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.Request
import okhttp3.Response
import java.util.concurrent.atomic.AtomicBoolean

/**
 * What the guard needs to know per request. On the device, TokenAblage and
 * Context provide it (ServerClient.kt); as an interface, the guard runs on
 * the JVM against a test server.
 */
interface Zugangslage {
    fun serverUrl(): String
    fun token(): String
    /** The origin the token is bound to; null means: send to no server. */
    fun tokenHerkunft(): String?
    /**
     * Counts sign-in, sign-out and server changes (data/TokenSchranke). Read
     * before the token and compared afterwards: what a response triggers only
     * applies to the session the request went out in.
     */
    fun generation(): Long
}

/** The placeholder Retrofit is built against; the guard rewrites it to the server. */
const val PLATZHALTER_BASIS = "http://localhost:3000/"

/**
 * The token's rotation, seen from outside (data/TokenTausch). [faellig] does
 * not wait — the request succeeded; [noetig] rotates and returns the new
 * token so the rejected request can be retried once.
 */
interface Rotationsanlass {
    fun faellig(alterToken: String)
    /** Only a token with [herkunft] and from [generation]; a newer one belongs to another session. */
    fun noetig(alterToken: String, herkunft: String?, generation: Long): String?
}

/** Path of the rotation itself: its own response triggers no further one. */
private const val ROTATIONS_PFAD = "/api/v1/auth/token-rotieren"

/**
 * A 401 with these codes means "confirmation wrong or missing", not "token
 * invalid": the dialog asks for the password again instead of signing out.
 */
private val BESTAETIGUNG_NOETIG = setOf(Fehlercode.AKTUELLES_PASSWORT_FALSCH, Fehlercode.AKTUELLES_PASSWORT_ERFORDERLICH,
    Fehlercode.ZWEITER_FAKTOR_FALSCH, Fehlercode.ZWEITER_FAKTOR_NOETIG, Fehlercode.PASSKEY_UNGUELTIG)

/**
 * Token, language and the plain-text ban for every request of the server
 * clients. A request without TLS stops here before a header is built; the
 * release build's network-security-config is the second line behind it.
 * [entwicklung]: debug build, http only to NetworkPolicy.ENTWICKLUNGS_HOSTS.
 */
class ServerWaechter(
    private val lage: Zugangslage,
    private val istApiClient: Boolean,
    private val entwicklung: Boolean,
    private val sitzungAbgelaufen: () -> Unit,
    private val versionsMeldung: ((VersionsHinweis) -> Unit)? = null,
    /** Extra headers only for our own server (the display language, ServerClient.kt). */
    private val eigeneKoepfe: (original: Request, ziel: Request.Builder) -> Unit = { _, _ -> },
    private val rotation: Rotationsanlass? = null,
    /** A 403 `nur_admins` on a token: the app pulls in its loss of admin rights. */
    private val rechteEntzogen: () -> Unit = {},
    /** A 403 `passwort_wechsel_noetig`: the app shows the screen for the initial password. */
    private val passwortWechselNoetig: () -> Unit = {},
    /** A 403 `zweiter_faktor_pflicht`: the app shows two-factor setup. */
    private val zweiterFaktorPflicht: () -> Unit = {},
) : Interceptor {

    private val versionGemeldet = AtomicBoolean(false)

    override fun intercept(chain: Interceptor.Chain): Response {
        val original = chain.request()
        // First: a change after this point shows up as a different generation.
        val generation = lage.generation()
        val serverUrl = lage.serverUrl().trim().trimEnd('/')
        val token = lage.token()
        val reqBuilder = zumServer(original, serverUrl)
        val finalUrl = reqBuilder.build().url
        if (!NetworkPolicy.verbindungErlaubt(finalUrl, entwicklung)) throw KlartextAbgelehnt(finalUrl.host)
        val unserServer = istUnserServer(finalUrl, serverUrl)
        // Redirects of our own requests only within the path: they carry the token along.
        val basis = if (unserServer) NetworkPolicy.basisPfad(serverUrl).orEmpty() else ""
        val mitToken = setzeKoepfe(original, reqBuilder, token, unserServer, finalUrl)

        val ausgehend = reqBuilder.build()
        // The session of the token that last went out; only it may evaluate the response.
        val lauf = Lauf(ausgehend, senden(chain, ausgehend, basis), mitToken && ausgehend.header("Authorization") != null, generation)
        nachfassen(chain, lauf, basis, unserServer)

        val dieselbeSitzung = { lage.generation() == lauf.sitzung }
        val auswertbar = lauf.tokenMitgeschickt && unserServer
        val tausch = rotation
        if (tausch != null && auswertbar && !ausgehend.url.encodedPath.endsWith(ROTATIONS_PFAD)) {
            lauf.antwort = getauscht(chain, lauf, basis, tausch, dieselbeSitzung)
        }
        // A 401 or 403 from the previous server does not concern the new session.
        if (auswertbar && lauf.antwort.code in setOf(401, 403) && dieselbeSitzung()) meldeAbweisung(lauf.antwort)
        if (unserServer) meldeVersion(lauf.antwort)
        return lauf.antwort
    }

    private fun istUnserServer(ziel: HttpUrl, serverUrl: String): Boolean =
        serverUrl.isNotBlank() && NetworkPolicy.isSameOrigin(ziel, serverUrl) && NetworkPolicy.imBasisPfad(ziel, serverUrl)

    /**
     * Retrofit is built against [PLATZHALTER_BASIS]; here the request is rewritten to the
     * configured server. A path prefix (reverse proxy under /brick) is kept. Unreadable throws
     * an IOException: any other exception would tear down the OkHttp thread along with the app.
     */
    private fun zumServer(original: Request, serverUrl: String): Request.Builder {
        val reqBuilder = original.newBuilder()
        if (!istApiClient || !original.url.toString().startsWith(PLATZHALTER_BASIS)) return reqBuilder
        val ziel = serverUrl.ifBlank { PLATZHALTER_BASIS.trimEnd('/') }.toHttpUrlOrNull()
            ?: throw java.io.IOException("Server-Adresse unlesbar")
        val basisPfad = ziel.encodedPath.trimEnd('/')
        val neu = original.url.newBuilder().scheme(ziel.scheme).host(ziel.host).port(ziel.port)
        if (basisPfad.isNotEmpty()) neu.encodedPath(basisPfad + original.url.encodedPath)
        return reqBuilder.url(neu.build())
    }

    /** Token, API version and our own headers, only for our own server. Returns whether the current token goes along. */
    private fun setzeKoepfe(original: Request, reqBuilder: Request.Builder, token: String, unserServer: Boolean, finalUrl: HttpUrl): Boolean {
        // A token only goes to the origin it is bound to; unbound, it goes to none.
        val herkunft = lage.tokenHerkunft()
        val tokenGehoertHierher = herkunft != null && herkunft == NetworkPolicy.herkunft(finalUrl.toString())
        val mitToken = token.isNotBlank() && unserServer && tokenGehoertHierher
        if (mitToken && original.header("Authorization") == null) {
            reqBuilder.header("Authorization", "Bearer $token")
        }
        // Headers set by hand (rotation, SSE, PDF) can carry a token older than the
        // current one — e.g. the previous server's, on a rotation that outlives the
        // switch. So the same rule as for mitToken applies here.
        if (original.header("Authorization") != null && !mitToken) {
            reqBuilder.removeHeader("Authorization")
        }
        if (unserServer) {
            reqBuilder.header("X-App-Api", APP_API_VERSION.toString())
            eigeneKoepfe(original, reqBuilder)
        }
        return mitToken
    }

    /** What last went out and came back, whether with the token, and which session it stems from. */
    private class Lauf(var gesendet: Request, var antwort: Response, var tokenMitgeschickt: Boolean, var sitzung: Long)

    /**
     * Signing in sets the token and immediately fires requests; one can still
     * have gone out without a header (util/Abgewiesen.kt). The token is read
     * now, so its binding is the current one, not the one at send time.
     */
    private fun nachfassen(chain: Interceptor.Chain, lauf: Lauf, basis: String, unserServer: Boolean) {
        val ausgehend = lauf.gesendet
        if (!darfNachfassen(lauf.antwort.code, unserServer, ausgehend.header("Authorization") != null, ausgehend.method)) return
        val (jetzt, g) = tokenFuer(ausgehend.url) ?: return
        lauf.antwort.close()
        lauf.gesendet = ausgehend.newBuilder().header("Authorization", "Bearer $jetzt").build()
        lauf.antwort = senden(chain, lauf.gesendet, basis)
        lauf.tokenMitgeschickt = true
        lauf.sitzung = g
    }

    /**
     * The token's rotation: a 401 `token_rotation_noetig` rotates and sends the request once more
     * with the new token; "faellig" only triggers the rotation. Both only for the session the
     * request went out in. Returns the response the caller gets.
     */
    private fun getauscht(chain: Interceptor.Chain, lauf: Lauf, basis: String, tausch: Rotationsanlass,
                          dieselbeSitzung: () -> Boolean): Response {
        val alt = lauf.gesendet.header("Authorization")?.removePrefix("Bearer ")?.trim()
        if (lauf.antwort.code == 401) {
            if (fehlercode(lauf.antwort) != Fehlercode.TOKEN_ROTATION_NOETIG) return lauf.antwort
            val neu = tausch.noetig(alt.orEmpty(), NetworkPolicy.herkunft(lauf.gesendet.url.toString()), lauf.sitzung)
                ?.takeIf { dieselbeSitzung() } ?: return lauf.antwort
            // The new token is already stored; this request goes out once with it.
            lauf.antwort.close()
            return senden(chain, lauf.gesendet.newBuilder().header("Authorization", "Bearer $neu").build(), basis)
        }
        if (lauf.antwort.header("X-Token-Rotation") == "faellig" && dieselbeSitzung()) alt?.let { tausch.faellig(it) }
        return lauf.antwort
    }

    /** 401 means signed out, unless the server only wants a confirmation; 403 names what's missing. */
    private fun meldeAbweisung(antwort: Response) {
        val code = fehlercode(antwort)
        if (antwort.code == 401 && code !in BESTAETIGUNG_NOETIG) sitzungAbgelaufen()
        if (antwort.code == 403 && code == Fehlercode.NUR_ADMINS) rechteEntzogen()
        if (antwort.code == 403 && code == Fehlercode.PASSWORT_WECHSEL_NOETIG) passwortWechselNoetig()
        if (antwort.code == 403 && code == Fehlercode.ZWEITER_FAKTOR_PFLICHT) zweiterFaktorPflicht()
    }

    /** A notice about too old an app or too old a server, once per run. */
    private fun meldeVersion(antwort: Response) {
        val melden = versionsMeldung ?: return
        if (versionGemeldet.get()) return
        versionsHinweis(
            antwort.header("X-Api-Version")?.toIntOrNull(),
            antwort.header("X-Api-Min-App")?.toIntOrNull(),
        )?.let { if (versionGemeldet.compareAndSet(false, true)) melden(it) }
    }

    private fun fehlercode(antwort: Response): Fehlercode? =
        runCatching { Fehlerrumpf.lies(antwort.peekBody(16_384).string()).fehlercode }.getOrNull()

    /**
     * The current token together with its generation, if it currently belongs to
     * [ziel]: our own server and the bound origin, both as of now. If the
     * generation changes while reading, the values do not reliably match — then neither.
     */
    private fun tokenFuer(ziel: HttpUrl): Pair<String, Long>? {
        val g = lage.generation()
        val server = lage.serverUrl().trim().trimEnd('/')
        val token = lage.token()
        val herkunft = lage.tokenHerkunft() ?: return null
        val passt = token.isNotBlank() && server.isNotBlank() && NetworkPolicy.isSameOrigin(ziel, server) &&
            NetworkPolicy.imBasisPfad(ziel, server) && herkunft == NetworkPolicy.herkunft(ziel.toString())
        return if (passt && lage.generation() == g) token to g else null
    }

    /**
     * The client does not follow redirects (ServerClient.kt): it would send
     * method and body — password, voucher PIN — to any host a proxy points to.
     * Here only within the same origin; any other redirect reaches the caller
     * as 3xx and so as an error.
     */
    private fun senden(chain: Interceptor.Chain, anfrage: Request, basisPfad: String): Response {
        var raus = anfrage
        var antwort = chain.proceed(raus)
        repeat(MAX_UMLEITUNGEN) {
            val ziel = naechsteUmleitung(raus, antwort, basisPfad) ?: return antwort
            antwort.close()
            raus = ziel
            antwort = chain.proceed(raus)
        }
        return antwort
    }

    private companion object {
        const val MAX_UMLEITUNGEN = 5
    }
}

/**
 * Where a response redirects to, as the next request — only for the same origin
 * (scheme, host, port) and under [basisPfad] (empty: the whole host). Like a
 * browser: 307/308 keep method and body, 301/302/303 become GET without a
 * body (HEAD stays HEAD).
 */
internal fun naechsteUmleitung(anfrage: Request, antwort: Response, basisPfad: String = ""): Request? {
    if (antwort.code !in setOf(301, 302, 303, 307, 308)) return null
    val ziel = antwort.header("Location")?.let(anfrage.url::resolve) ?: return null
    if (ziel.scheme != anfrage.url.scheme || !ziel.host.equals(anfrage.url.host, ignoreCase = true) ||
        ziel.port != anfrage.url.port) return null
    if (basisPfad.isNotEmpty() && ziel.encodedPath != basisPfad && !ziel.encodedPath.startsWith("$basisPfad/")) return null
    val neu = anfrage.newBuilder().url(ziel)
    val behalten = antwort.code == 307 || antwort.code == 308 || anfrage.method == "GET" || anfrage.method == "HEAD"
    if (!behalten) neu.method("GET", null).removeHeader("Content-Type").removeHeader("Content-Length")
    return neu.build()
}
