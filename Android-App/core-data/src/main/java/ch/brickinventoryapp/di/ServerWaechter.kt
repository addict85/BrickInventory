package ch.brickinventoryapp.di

import ch.brickinventoryapp.data.api.Fehlerrumpf
import ch.brickinventoryapp.util.APP_API_VERSION
import ch.brickinventoryapp.util.KlartextAbgelehnt
import ch.brickinventoryapp.util.NetworkPolicy
import ch.brickinventoryapp.util.VersionsHinweis
import ch.brickinventoryapp.util.darfNachfassen
import ch.brickinventoryapp.util.versionsHinweis
import okhttp3.HttpUrl
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
    /**
     * Zählt Anmelden, Abmelden und Serverwechsel (data/TokenSchranke). Wird vor dem
     * Token gelesen und danach verglichen: Was eine Antwort auslöst, gilt nur der
     * Sitzung, in der die Anfrage hinausging.
     */
    fun generation(): Long
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
    /** Nur ein Token mit [herkunft] und aus [generation]; ein jüngerer gehört einer anderen Sitzung. */
    fun noetig(alterToken: String, herkunft: String?, generation: Long): String?
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

/** 403 mit diesem Code: Erst das Startpasswort ersetzen (data/PasswortPflicht). */
const val PASSWORT_WECHSEL_NOETIG = "passwort_wechsel_noetig"

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
    /** Ein 403 `passwort_wechsel_noetig`: Die App zeigt die Maske für das Startpasswort. */
    private val passwortWechselNoetig: () -> Unit = {},
) : Interceptor {

    private val versionGemeldet = AtomicBoolean(false)

    override fun intercept(chain: Interceptor.Chain): Response {
        val original = chain.request()
        // Zuerst: Ein Wechsel nach diesem Punkt zeigt sich als andere Generation.
        val generation = lage.generation()
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
        val unserServer = serverUrl.isNotBlank() && NetworkPolicy.isSameOrigin(finalUrl, serverUrl) &&
            NetworkPolicy.imBasisPfad(finalUrl, serverUrl)
        // Umleitungen eigener Anfragen nur innerhalb des Pfads: Sie tragen den Token weiter.
        val basis = if (unserServer) NetworkPolicy.basisPfad(serverUrl).orEmpty() else ""
        // Nach einem Serverwechsel trägt der alte Token nichts beim neuen aus.
        val herkunft = lage.tokenHerkunft()
        val tokenGehoertHierher = herkunft == null || herkunft == NetworkPolicy.herkunft(finalUrl.toString())
        val mitToken = token.isNotBlank() && unserServer && tokenGehoertHierher
        if (mitToken && original.header("Authorization") == null) {
            reqBuilder.header("Authorization", "Bearer $token")
        }
        // Selbst gesetzte Köpfe (Tausch, SSE, PDF) können einen älteren Token tragen
        // als den jetzigen — etwa den des vorigen Servers bei einem Tausch, der den
        // Wechsel überdauert. Darum gilt hier dieselbe Regel wie für mitToken.
        if (original.header("Authorization") != null && !mitToken) {
            reqBuilder.removeHeader("Authorization")
        }
        if (unserServer) {
            reqBuilder.header("X-App-Api", APP_API_VERSION.toString())
            eigeneKoepfe(original, reqBuilder)
        }

        val ausgehend = reqBuilder.build()
        var antwort = senden(chain, ausgehend, basis)
        var tokenMitgeschickt = mitToken && ausgehend.header("Authorization") != null
        // Die Sitzung des Tokens, der zuletzt hinausging; nur sie darf die Antwort auswerten.
        var sitzung = generation
        var gesendet = ausgehend

        // Die Anmeldung setzt den Token und feuert sofort Abrufe; einer kann noch
        // ohne Kopf hinausgegangen sein (util/Abgewiesen.kt). Der Token wird jetzt
        // gelesen, also gilt seine Bindung von jetzt, nicht die vom Senden.
        if (darfNachfassen(antwort.code, unserServer, ausgehend.header("Authorization") != null, ausgehend.method)) {
            tokenFuer(ausgehend.url)?.let { (jetzt, g) ->
                antwort.close()
                gesendet = ausgehend.newBuilder().header("Authorization", "Bearer $jetzt").build()
                antwort = senden(chain, gesendet, basis)
                tokenMitgeschickt = true
                sitzung = g
            }
        }

        val dieselbeSitzung = { lage.generation() == sitzung }
        val rotierbar = rotation != null && tokenMitgeschickt && unserServer &&
            !ausgehend.url.encodedPath.endsWith(ROTATIONS_PFAD)
        if (rotierbar && antwort.code == 401) {
            val code = runCatching { Fehlerrumpf.lies(antwort.peekBody(16_384).string()).code }.getOrNull()
            val alt = gesendet.header("Authorization")?.removePrefix("Bearer ")?.trim().orEmpty()
            val herkunftDerAnfrage = NetworkPolicy.herkunft(gesendet.url.toString())
            if (code == "token_rotation_noetig") rotation.noetig(alt, herkunftDerAnfrage, sitzung)
                ?.takeIf { dieselbeSitzung() }?.let { neu ->
                    // Der neue Token ist gespeichert; diese Anfrage geht einmal mit ihm.
                    antwort.close()
                    antwort = senden(chain, gesendet.newBuilder().header("Authorization", "Bearer $neu").build(), basis)
                }
        } else if (rotierbar && antwort.header("X-Token-Rotation") == "faellig" && dieselbeSitzung()) {
            gesendet.header("Authorization")?.removePrefix("Bearer ")?.trim()?.let { rotation.faellig(it) }
        }

        // Ein 401 oder 403 des vorigen Servers betrifft die neue Sitzung nicht.
        if ((antwort.code == 401 || antwort.code == 403) && tokenMitgeschickt && unserServer && dieselbeSitzung()) {
            val code = runCatching { Fehlerrumpf.lies(antwort.peekBody(16_384).string()).code }.getOrNull()
            if (antwort.code == 401 && code !in BESTAETIGUNG_NOETIG) sitzungAbgelaufen()
            if (antwort.code == 403 && code == NUR_ADMINS) rechteEntzogen()
            if (antwort.code == 403 && code == PASSWORT_WECHSEL_NOETIG) passwortWechselNoetig()
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

    /**
     * Der jetzige Token samt Generation, wenn er jetzt zu [ziel] gehört: eigener
     * Server und gebundene Herkunft, beides von jetzt. Ändert sich die Generation
     * während des Lesens, passen die Werte nicht sicher zusammen — dann keiner.
     */
    private fun tokenFuer(ziel: HttpUrl): Pair<String, Long>? {
        val g = lage.generation()
        val server = lage.serverUrl().trim().trimEnd('/')
        val token = lage.token()
        val herkunft = lage.tokenHerkunft() ?: NetworkPolicy.herkunft(server)
        val passt = token.isNotBlank() && server.isNotBlank() && NetworkPolicy.isSameOrigin(ziel, server) &&
            NetworkPolicy.imBasisPfad(ziel, server) && herkunft == NetworkPolicy.herkunft(ziel.toString())
        return if (passt && lage.generation() == g) token to g else null
    }

    /**
     * Umleitungen folgt der Client nicht (ServerClient.kt): Er schickte Methode und
     * Rumpf — Passwort, Gutschein-PIN — an jeden Host, auf den ein Proxy zeigt. Hier
     * nur innerhalb derselben Herkunft; jede andere Umleitung erreicht den Aufrufer
     * als 3xx und damit als Fehler.
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
 * Wohin eine Antwort umleitet, als nächste Anfrage — nur bei gleicher Herkunft
 * (Schema, Host, Port) und unter [basisPfad] (leer: der ganze Host). Wie ein
 * Browser: 307/308 behalten Methode und Rumpf, 301/302/303 werden zu GET ohne
 * Rumpf (HEAD bleibt HEAD).
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
