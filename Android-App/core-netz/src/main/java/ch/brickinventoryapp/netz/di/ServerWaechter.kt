package ch.brickinventoryapp.netz.di

import ch.brickinventoryapp.netz.data.api.Fehlerrumpf
import ch.brickinventoryapp.vertrag.Fehlercode
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
 * Was der Wächter je Anfrage wissen muss. Im Gerät liefern es TokenAblage
 * und Context (ServerClient.kt); als Schnittstelle läuft der Wächter auf der JVM
 * gegen einen Testserver.
 */
interface Zugangslage {
    fun serverUrl(): String
    fun token(): String
    /** Die Herkunft, an die der Token gebunden ist; null heisst: an keinen Server senden. */
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
private val BESTAETIGUNG_NOETIG = setOf(Fehlercode.AKTUELLES_PASSWORT_FALSCH, Fehlercode.AKTUELLES_PASSWORT_ERFORDERLICH,
    Fehlercode.ZWEITER_FAKTOR_FALSCH, Fehlercode.ZWEITER_FAKTOR_NOETIG, Fehlercode.PASSKEY_UNGUELTIG)

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
    /** Ein 403 `zweiter_faktor_pflicht`: Die App zeigt die Einrichtung des zweiten Faktors. */
    private val zweiterFaktorPflicht: () -> Unit = {},
) : Interceptor {

    private val versionGemeldet = AtomicBoolean(false)

    override fun intercept(chain: Interceptor.Chain): Response {
        val original = chain.request()
        // Zuerst: Ein Wechsel nach diesem Punkt zeigt sich als andere Generation.
        val generation = lage.generation()
        val serverUrl = lage.serverUrl().trim().trimEnd('/')
        val token = lage.token()
        val reqBuilder = zumServer(original, serverUrl)
        val finalUrl = reqBuilder.build().url
        if (!NetworkPolicy.verbindungErlaubt(finalUrl, entwicklung)) throw KlartextAbgelehnt(finalUrl.host)
        val unserServer = istUnserServer(finalUrl, serverUrl)
        // Umleitungen eigener Anfragen nur innerhalb des Pfads: Sie tragen den Token weiter.
        val basis = if (unserServer) NetworkPolicy.basisPfad(serverUrl).orEmpty() else ""
        val mitToken = setzeKoepfe(original, reqBuilder, token, unserServer, finalUrl)

        val ausgehend = reqBuilder.build()
        // Die Sitzung des Tokens, der zuletzt hinausging; nur sie darf die Antwort auswerten.
        val lauf = Lauf(ausgehend, senden(chain, ausgehend, basis), mitToken && ausgehend.header("Authorization") != null, generation)
        nachfassen(chain, lauf, basis, unserServer)

        val dieselbeSitzung = { lage.generation() == lauf.sitzung }
        val auswertbar = lauf.tokenMitgeschickt && unserServer
        val tausch = rotation
        if (tausch != null && auswertbar && !ausgehend.url.encodedPath.endsWith(ROTATIONS_PFAD)) {
            lauf.antwort = getauscht(chain, lauf, basis, tausch, dieselbeSitzung)
        }
        // Ein 401 oder 403 des vorigen Servers betrifft die neue Sitzung nicht.
        if (auswertbar && lauf.antwort.code in setOf(401, 403) && dieselbeSitzung()) meldeAbweisung(lauf.antwort)
        if (unserServer) meldeVersion(lauf.antwort)
        return lauf.antwort
    }

    private fun istUnserServer(ziel: HttpUrl, serverUrl: String): Boolean =
        serverUrl.isNotBlank() && NetworkPolicy.isSameOrigin(ziel, serverUrl) && NetworkPolicy.imBasisPfad(ziel, serverUrl)

    /**
     * Retrofit ist auf [PLATZHALTER_BASIS] gebaut; hier wird die Anfrage auf den eingetragenen
     * Server umgeschrieben. Ein Pfad-Präfix (Reverse-Proxy unter /brick) bleibt erhalten.
     * Unlesbar wirft eine IOException: Eine andere Ausnahme risse den OkHttp-Faden und die App mit.
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

    /** Token, API-Fassung und eigene Köpfe, nur für den eigenen Server. Liefert, ob der jetzige Token mitgeht. */
    private fun setzeKoepfe(original: Request, reqBuilder: Request.Builder, token: String, unserServer: Boolean, finalUrl: HttpUrl): Boolean {
        // Ein Token geht nur an die Herkunft, an die er gebunden ist; ohne Bindung an keine.
        val herkunft = lage.tokenHerkunft()
        val tokenGehoertHierher = herkunft != null && herkunft == NetworkPolicy.herkunft(finalUrl.toString())
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
        return mitToken
    }

    /** Was zuletzt hinausging und zurückkam, ob mit dem Token, und aus welcher Sitzung er stammt. */
    private class Lauf(var gesendet: Request, var antwort: Response, var tokenMitgeschickt: Boolean, var sitzung: Long)

    /**
     * Die Anmeldung setzt den Token und feuert sofort Abrufe; einer kann noch
     * ohne Kopf hinausgegangen sein (util/Abgewiesen.kt). Der Token wird jetzt
     * gelesen, also gilt seine Bindung von jetzt, nicht die vom Senden.
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
     * Der Tausch des Tokens: Ein 401 `token_rotation_noetig` tauscht und schickt die Anfrage einmal
     * mit dem neuen Token; „faellig“ stösst den Tausch nur an. Beides nur für die Sitzung, in der
     * die Anfrage hinausging. Liefert die Antwort, die der Aufrufer bekommt.
     */
    private fun getauscht(chain: Interceptor.Chain, lauf: Lauf, basis: String, tausch: Rotationsanlass,
                          dieselbeSitzung: () -> Boolean): Response {
        val alt = lauf.gesendet.header("Authorization")?.removePrefix("Bearer ")?.trim()
        if (lauf.antwort.code == 401) {
            if (fehlercode(lauf.antwort) != Fehlercode.TOKEN_ROTATION_NOETIG) return lauf.antwort
            val neu = tausch.noetig(alt.orEmpty(), NetworkPolicy.herkunft(lauf.gesendet.url.toString()), lauf.sitzung)
                ?.takeIf { dieselbeSitzung() } ?: return lauf.antwort
            // Der neue Token ist gespeichert; diese Anfrage geht einmal mit ihm.
            lauf.antwort.close()
            return senden(chain, lauf.gesendet.newBuilder().header("Authorization", "Bearer $neu").build(), basis)
        }
        if (lauf.antwort.header("X-Token-Rotation") == "faellig" && dieselbeSitzung()) alt?.let { tausch.faellig(it) }
        return lauf.antwort
    }

    /** 401 heisst abgemeldet, ausser der Server will nur eine Bestätigung; 403 nennt, was fehlt. */
    private fun meldeAbweisung(antwort: Response) {
        val code = fehlercode(antwort)
        if (antwort.code == 401 && code !in BESTAETIGUNG_NOETIG) sitzungAbgelaufen()
        if (antwort.code == 403 && code == Fehlercode.NUR_ADMINS) rechteEntzogen()
        if (antwort.code == 403 && code == Fehlercode.PASSWORT_WECHSEL_NOETIG) passwortWechselNoetig()
        if (antwort.code == 403 && code == Fehlercode.ZWEITER_FAKTOR_PFLICHT) zweiterFaktorPflicht()
    }

    /** Ein Hinweis auf zu alte App oder zu alten Server, einmal je Lauf. */
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
     * Der jetzige Token samt Generation, wenn er jetzt zu [ziel] gehört: eigener
     * Server und gebundene Herkunft, beides von jetzt. Ändert sich die Generation
     * während des Lesens, passen die Werte nicht sicher zusammen — dann keiner.
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
