package ch.brickinventoryapp.di

import ch.brickinventoryapp.data.api.Fehlerrumpf
import ch.brickinventoryapp.util.APP_API_VERSION
import ch.brickinventoryapp.util.KlartextAbgelehnt
import ch.brickinventoryapp.util.NetworkPolicy
import ch.brickinventoryapp.util.VersionsHinweis
import ch.brickinventoryapp.util.darfNachfassen
import ch.brickinventoryapp.util.versionsHinweis
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.Request
import okhttp3.Response
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Was der Wächter je Anfrage wissen muss. Im Gerät liefern es PreferencesManager
 * und Context (ServerClient.kt); als Schnittstelle läuft der Wächter auf der JVM
 * gegen einen Testserver.
 */
interface Zugangslage {
    fun serverUrl(): String
    fun token(): String
    /** Die Herkunft, an die der Token gebunden ist; null bei Altbestand ohne Bindung. */
    fun tokenHerkunft(): String?
}

/** Platzhalter, auf den Retrofit gebaut ist; der Wächter schreibt ihn auf den Server um. */
const val PLATZHALTER_BASIS = "http://localhost:3000/"

/**
 * Der Tausch des Tokens, von aussen gesehen (data/TokenTausch). [faellig]
 * wartet nicht — die Anfrage ist gelungen; [noetig] tauscht und liefert den
 * neuen Token, damit die abgewiesene Anfrage einmal wiederholt werden kann.
 */
interface Rotationsanlass {
    fun faellig(alterToken: String)
    fun noetig(alterToken: String): String?
}

/** Pfad des Tauschs selbst: Seine Antwort löst keinen weiteren aus. */
private const val ROTATIONS_PFAD = "/api/v1/auth/token-rotieren"

/**
 * 401 mit diesen Codes heisst „Bestätigung falsch oder fehlt“, nicht „Token
 * ungültig“: Der Dialog fragt erneut nach dem Passwort, statt abzumelden.
 */
private val BESTAETIGUNG_NOETIG = setOf("aktuelles_passwort_falsch", "aktuelles_passwort_erforderlich",
    "zweiter_faktor_falsch", "zweiter_faktor_noetig", "passkey_ungueltig")

/** 403 mit diesem Code: Das Konto oder der Token hat keine Verwalterrechte (mehr). */
const val NUR_ADMINS = "nur_admins"

/**
 * Token, Sprache und das Klartext-Verbot für alle Anfragen der Server-Clients.
 * Eine Anfrage ohne TLS bricht hier ab, bevor ein Kopf gebaut wird; die
 * Network-Security-Config des Release-Builds ist die zweite Linie dahinter.
 * [entwicklung]: Debug-Build, http nur zu NetworkPolicy.ENTWICKLUNGS_HOSTS.
 */
class ServerWaechter(
    private val lage: Zugangslage,
    private val istApiClient: Boolean,
    private val entwicklung: Boolean,
    private val sitzungAbgelaufen: () -> Unit,
    private val versionsMeldung: ((VersionsHinweis) -> Unit)? = null,
    /** Weitere Köpfe nur für den eigenen Server (die Anzeigesprache, ServerClient.kt). */
    private val eigeneKoepfe: (original: Request, ziel: Request.Builder) -> Unit = { _, _ -> },
    private val rotation: Rotationsanlass? = null,
    /** Ein 403 `nur_admins` auf einen Token: Die App zieht ihr Verwalterrecht nach. */
    private val rechteEntzogen: () -> Unit = {},
) : Interceptor {

    private val versionGemeldet = AtomicBoolean(false)

    override fun intercept(chain: Interceptor.Chain): Response {
        val original = chain.request()
        val serverUrl = lage.serverUrl().trim().trimEnd('/')
        val token = lage.token()
        val reqBuilder = original.newBuilder()

        if (istApiClient && original.url.toString().startsWith(PLATZHALTER_BASIS)) {
            // Unlesbar wirft hier eine IOException: Eine andere Ausnahme aus einem
            // Interceptor risse den OkHttp-Faden und damit die App mit.
            val ziel = serverUrl.ifBlank { PLATZHALTER_BASIS.trimEnd('/') }.toHttpUrlOrNull()
                ?: throw java.io.IOException("Server-Adresse unlesbar")
            // Ein Pfad-Präfix des Servers (Reverse-Proxy unter /brick) bleibt erhalten.
            val basisPfad = ziel.encodedPath.trimEnd('/')
            val neu = original.url.newBuilder().scheme(ziel.scheme).host(ziel.host).port(ziel.port)
            if (basisPfad.isNotEmpty()) neu.encodedPath(basisPfad + original.url.encodedPath)
            reqBuilder.url(neu.build())
        }

        val finalUrl = reqBuilder.build().url
        if (!NetworkPolicy.verbindungErlaubt(finalUrl, entwicklung)) throw KlartextAbgelehnt(finalUrl.host)
        val unserServer = serverUrl.isNotBlank() && NetworkPolicy.isSameOrigin(finalUrl, serverUrl)
        // Nach einem Serverwechsel trägt der alte Token nichts beim neuen aus.
        val herkunft = lage.tokenHerkunft()
        val tokenGehoertHierher = herkunft == null || herkunft == NetworkPolicy.herkunft(finalUrl.toString())
        val mitToken = token.isNotBlank() && unserServer && tokenGehoertHierher
        if (mitToken && original.header("Authorization") == null) {
            reqBuilder.header("Authorization", "Bearer $token")
        }
        // Dienste, die den Kopf selbst setzen (SSE, PDF-Export), lesen denselben Token.
        if (!tokenGehoertHierher && token.isNotBlank() && original.header("Authorization") == "Bearer $token") {
            reqBuilder.removeHeader("Authorization")
        }
        if (unserServer) {
            reqBuilder.header("X-App-Api", APP_API_VERSION.toString())
            eigeneKoepfe(original, reqBuilder)
        }

        val ausgehend = reqBuilder.build()
        var antwort = chain.proceed(ausgehend)
        var tokenMitgeschickt = mitToken && ausgehend.header("Authorization") != null

        // Die Anmeldung setzt den Token und feuert sofort Abrufe; einer kann noch
        // ohne Kopf hinausgegangen sein (util/Abgewiesen.kt).
        if (darfNachfassen(antwort.code, unserServer, ausgehend.header("Authorization") != null, ausgehend.method)) {
            val jetzt = lage.token()
            if (jetzt.isNotBlank() && tokenGehoertHierher) {
                antwort.close()
                val nachfass = ausgehend.newBuilder().header("Authorization", "Bearer $jetzt").build()
                antwort = chain.proceed(nachfass)
                tokenMitgeschickt = true
            }
        }

        val rotierbar = rotation != null && tokenMitgeschickt && unserServer &&
            !ausgehend.url.encodedPath.endsWith(ROTATIONS_PFAD)
        if (rotierbar && antwort.code == 401) {
            val code = runCatching { Fehlerrumpf.lies(antwort.peekBody(16_384).string()).code }.getOrNull()
            val gesendet = ausgehend.header("Authorization")?.removePrefix("Bearer ")?.trim().orEmpty()
            if (code == "token_rotation_noetig") rotation!!.noetig(gesendet)?.let { neu ->
                // Der neue Token ist gespeichert; diese Anfrage geht einmal mit ihm.
                antwort.close()
                val wieder = ausgehend.newBuilder().header("Authorization", "Bearer $neu").build()
                antwort = chain.proceed(wieder)
            }
        } else if (rotierbar && antwort.header("X-Token-Rotation") == "faellig") {
            ausgehend.header("Authorization")?.removePrefix("Bearer ")?.trim()?.let { rotation!!.faellig(it) }
        }

        if ((antwort.code == 401 || antwort.code == 403) && tokenMitgeschickt && unserServer) {
            val code = runCatching { Fehlerrumpf.lies(antwort.peekBody(16_384).string()).code }.getOrNull()
            if (antwort.code == 401 && code !in BESTAETIGUNG_NOETIG) sitzungAbgelaufen()
            if (antwort.code == 403 && code == NUR_ADMINS) rechteEntzogen()
        }

        val melden = versionsMeldung
        if (unserServer && melden != null && !versionGemeldet.get()) {
            versionsHinweis(
                antwort.header("X-Api-Version")?.toIntOrNull(),
                antwort.header("X-Api-Min-App")?.toIntOrNull(),
            )?.let { if (versionGemeldet.compareAndSet(false, true)) melden(it) }
        }
        return antwort
    }
}
