package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.repository.KontoRepository
import ch.brickinventoryapp.netz.di.ServerWaechter
import ch.brickinventoryapp.netz.di.Zugangslage
import ch.brickinventoryapp.netz.util.KlartextAbgelehnt
import ch.brickinventoryapp.netz.util.NetworkPolicy
import ch.brickinventoryapp.data.util.Tresorbefund
import ch.brickinventoryapp.data.util.ZertifikatUngeklaert
import ch.brickinventoryapp.netz.util.eigeneAdresse
import ch.brickinventoryapp.data.util.pinSchluessel
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import javax.inject.Inject
import javax.net.ssl.SSLContext
import javax.net.ssl.X509ExtendedTrustManager

/**
 * Was eine spätere Entwertung braucht: der Server, dem das Token gehört, das Token
 * nur verschlüsselt (der Auftrag liegt in der Datenbank von WorkManager), der Pin
 * dieses Servers und die Herkunft, an die das Token gebunden ist. Passt [herkunft]
 * nicht zu [serverUrl], geht das Token nirgends hin (Entwerter).
 */
data class Entwertungsauftrag(
    val serverUrl: String,
    val tokenGeheim: String,
    val pin: String? = null,
    val herkunft: String? = NetworkPolicy.herkunft(serverUrl),
)

/** Legt einen Auftrag in die dauerhafte Warteschlange (data/lokal/EntwertungsWorker). */
fun interface EntwertungsPlaner {
    fun plane(auftrag: Entwertungsauftrag)
}

/** Der Auftrag für das jetzige Token, oder null ohne Token (TokenAblage). */
fun interface Entwertungsquelle {
    suspend fun entwertungsauftrag(): Entwertungsauftrag?
}

enum class Abmeldeweg { SOFORT, NACHGEHOLT, OHNE_AUFTRAG }

/**
 * Abmelden am Server: erst der kurze Versuch, und scheitert er, eine Warteschlange,
 * die wiederholt, bis der Server bestätigt. Sonst bliebe ein Token ohne Ablauf
 * gültig, sobald jemand ohne Netz abmeldet.
 */
class Abmeldung @Inject constructor(
    private val konto: KontoRepository,
    private val quelle: Entwertungsquelle,
    private val planer: EntwertungsPlaner,
) {
    suspend fun amServer(): Abmeldeweg {
        // Vor dem Versuch: Danach räumt das Abmelden das Token weg.
        val auftrag = quelle.entwertungsauftrag()
        return when (konto.entwertenAmServer()) {
            Entwertungsergebnis.ENTWERTET -> Abmeldeweg.SOFORT
            Entwertungsergebnis.AUFGEBEN -> Abmeldeweg.OHNE_AUFTRAG
            Entwertungsergebnis.SPAETER -> if (auftrag == null) Abmeldeweg.OHNE_AUFTRAG
                else Abmeldeweg.NACHGEHOLT.also { planer.plane(auftrag) }
        }
    }
}

enum class Entwertungsergebnis { ENTWERTET, SPAETER, AUFGEBEN }

/**
 * 401 heisst: Das Token gilt schon nicht mehr, das Ziel ist erreicht. Eine
 * Umleitung (nur innerhalb des Servers verfolgt) oder ein anderer 4xx-Satz wird
 * auch beim zehnten Mal nicht anders; Zeitüberschreitung, 429 und 5xx schon.
 */
internal fun einordnenEntwertung(code: Int): Entwertungsergebnis = when {
    code in 200..299 || code == 401 -> Entwertungsergebnis.ENTWERTET
    code == 408 || code == 429 || code >= 500 -> Entwertungsergebnis.SPAETER
    else -> Entwertungsergebnis.AUFGEBEN
}

/**
 * POST /auth/logout mit genau diesem Token an genau diesen Server. Über einen
 * eigenen Wächter: Der der App kennt nach dem Abmelden kein Token mehr und strich
 * den Kopf; dieser hält dieselben Regeln (https, Pfad, Umleitungen) für den Auftrag.
 */
class Entwerter(
    private val basis: OkHttpClient,
    private val entwicklung: Boolean,
    /**
     * TLS-Vertrauen für genau den Server des Auftrags ([pinSchluessel]) mit seinem
     * Pin. Das gemeinsame der App kennt nur den jetzt eingerichteten Server.
     */
    private val vertrauenFuer: ((schluessel: String, pin: String?) -> X509ExtendedTrustManager)? = null,
) {

    /** [herkunft]: wohin das Token gehört; ein Auftrag an einen anderen Server sendet nichts. */
    fun entwerte(serverUrl: String, token: String, pin: String? = null,
                 herkunft: String? = NetworkPolicy.herkunft(serverUrl)): Entwertungsergebnis {
        val ziel = eigeneAdresse(serverUrl, "api/v1/auth/logout")
        if (token.isBlank() || ziel == null) return Entwertungsergebnis.AUFGEBEN
        if (herkunft == null || herkunft != NetworkPolicy.herkunft(serverUrl)) return Entwertungsergebnis.AUFGEBEN
        val lage = object : Zugangslage {
            override fun serverUrl() = serverUrl
            override fun token() = token
            override fun tokenHerkunft() = herkunft
            override fun generation() = 0L
        }
        val abgelehnt = java.util.concurrent.atomic.AtomicBoolean(false)
        val client = basis.newBuilder()
            .followRedirects(false).followSslRedirects(false)
            .addInterceptor(ServerWaechter(lage, istApiClient = false, entwicklung = entwicklung, sitzungAbgelaufen = {}))
            .apply {
                val schluessel = pinSchluessel(serverUrl)
                if (vertrauenFuer != null && schluessel != null) {
                    val tm = MerktAblehnung(vertrauenFuer(schluessel, pin), abgelehnt)
                    sslSocketFactory(SSLContext.getInstance("TLS").apply { init(null, arrayOf(tm), null) }.socketFactory, tm)
                }
            }
            .build()
        val anfrage = Request.Builder().url(ziel).post("{}".toRequestBody("application/json".toMediaType())).build()
        return try {
            client.newCall(anfrage).execute().use { einordnenEntwertung(it.code) }
        } catch (_: KlartextAbgelehnt) {
            Entwertungsergebnis.AUFGEBEN
        } catch (e: java.io.IOException) {
            // Ein Zertifikat, das nicht zum Pin passt, wird durch Warten nicht passender;
            // nachfragen kann im Hintergrund niemand.
            // Gemerkt statt in der Ursachenkette gesucht: Conscrypt reicht die Ausnahme des
            // Vertrauens nicht immer als Ursache weiter.
            if (abgelehnt.get() || generateSequence<Throwable>(e) { it.cause }.take(8).any { it is ZertifikatUngeklaert }) Entwertungsergebnis.AUFGEBEN
            else Entwertungsergebnis.SPAETER
        }
    }
}

internal enum class Entwertungsschritt { FERTIG, NOCHMAL, AUFGEGEBEN }

/** Etwa eine Woche bei WorkManagers Rückzug (30 s, verdoppelt, höchstens 5 h). */
internal const val ENTWERTUNG_HOECHSTVERSUCHE = 40

/**
 * Ein Lauf des Arbeiters. Ein gesperrter Keystore ist wie ein fehlendes Netz ein
 * Grund zu warten (util/Tresorbefund); ein verlorener Schlüssel macht das Token
 * auch für einen Dieb unbrauchbar, also gibt es nichts mehr zu tun.
 */
// [geraetGesperrt]: Der Schlüssel des Tokens gibt erst nach dem Entsperren frei; Warten
// darauf ist kein Fehlversuch, sonst gäbe ein tagelang gesperrtes Gerät den Auftrag auf.
internal fun entwertungsSchritt(
    befund: Tresorbefund,
    versuch: Int,
    geraetGesperrt: Boolean = false,
    entwerte: (String) -> Entwertungsergebnis,
): Entwertungsschritt =
    when (befund) {
        Tresorbefund.Weg -> Entwertungsschritt.AUFGEGEBEN
        Tresorbefund.Gesperrt ->
            if (!geraetGesperrt && versuch + 1 >= ENTWERTUNG_HOECHSTVERSUCHE) Entwertungsschritt.AUFGEGEBEN
            else Entwertungsschritt.NOCHMAL
        is Tresorbefund.Lesbar -> when (entwerte(befund.klartext)) {
            Entwertungsergebnis.ENTWERTET -> Entwertungsschritt.FERTIG
            Entwertungsergebnis.AUFGEBEN -> Entwertungsschritt.AUFGEGEBEN
            Entwertungsergebnis.SPAETER ->
                if (versuch + 1 >= ENTWERTUNG_HOECHSTVERSUCHE) Entwertungsschritt.AUFGEGEBEN else Entwertungsschritt.NOCHMAL
        }
    }

/** Reicht alles an [innen] weiter und merkt sich, ob ein Zertifikat ungeklärt abgelehnt wurde. */
// Prüft nichts selbst: jede Entscheidung trifft [innen] (PinVertrauen).
@Suppress("CustomX509TrustManager")
private class MerktAblehnung(
    private val innen: X509ExtendedTrustManager,
    private val abgelehnt: java.util.concurrent.atomic.AtomicBoolean,
) : X509ExtendedTrustManager() {
    private inline fun <T> merke(block: () -> T): T =
        try { block() } catch (e: ZertifikatUngeklaert) { abgelehnt.set(true); throw e }

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
