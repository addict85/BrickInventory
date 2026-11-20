package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.repository.AccountRepository
import ch.brickinventoryapp.netz.di.ServerWaechter
import ch.brickinventoryapp.netz.di.Zugangslage
import ch.brickinventoryapp.netz.util.PlaintextRejected
import ch.brickinventoryapp.netz.util.NetworkPolicy
import ch.brickinventoryapp.sicherheit.Tresorbefund
import ch.brickinventoryapp.sicherheit.CertificateUnresolved
import ch.brickinventoryapp.netz.util.ownAddress
import ch.brickinventoryapp.sicherheit.pinKey
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import javax.inject.Inject
import javax.net.ssl.SSLContext
import javax.net.ssl.X509ExtendedTrustManager

/** Legt einen Auftrag in die dauerhafte Warteschlange (data/lokal/EntwertungsWorker). */
fun interface RedemptionPlanner {
    fun plane(job: Entwertungsauftrag)
}

/** Der Auftrag für das jetzige Token, oder null ohne Token (TokenAblage). */
fun interface Entwertungsquelle {
    suspend fun entwertungsauftrag(): Entwertungsauftrag?
}

enum class Abmeldeweg { SOFORT, CAUGHT_UP, WITHOUT_JOB }

/**
 * Abmelden am Server: erst der kurze Versuch, und scheitert er, eine Warteschlange,
 * die wiederholt, bis der Server bestätigt. Sonst bliebe ein Token ohne Ablauf
 * gültig, sobald jemand ohne Netz abmeldet.
 */
class Abmeldung @Inject constructor(
    private val konto: AccountRepository,
    private val quelle: Entwertungsquelle,
    private val planner: RedemptionPlanner,
) {
    suspend fun atServer(): Abmeldeweg {
        // Vor dem Versuch: Danach räumt das Abmelden das Token weg.
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
 * 401 heisst: Das Token gilt schon nicht mehr, das Ziel ist erreicht. Eine
 * Umleitung (nur innerhalb des Servers verfolgt) oder ein anderer 4xx-Satz wird
 * auch beim zehnten Mal nicht anders; Zeitüberschreitung, 429 und 5xx schon.
 */
internal fun classifyRedemption(code: Int): Entwertungsergebnis = when {
    code in 200..299 || code == 401 -> Entwertungsergebnis.ENTWERTET
    code == 408 || code == 429 || code >= 500 -> Entwertungsergebnis.LATER
    else -> Entwertungsergebnis.GIVE_UP
}

/**
 * POST /auth/logout mit genau diesem Token an genau diesen Server. Über einen
 * eigenen Wächter: Der der App kennt nach dem Abmelden kein Token mehr und strich
 * den Kopf; dieser hält dieselben Regeln (https, Pfad, Umleitungen) für den Auftrag.
 */
class Redeemer(
    private val basis: OkHttpClient,
    private val entwicklung: Boolean,
    /**
     * TLS-Vertrauen für genau den Server des Auftrags ([pinKey]) mit seinem
     * Pin. Das gemeinsame der App kennt nur den jetzt eingerichteten Server.
     */
    private val trustFor: ((schluessel: String, pin: String?) -> X509ExtendedTrustManager)? = null,
) {

    /** [herkunft]: wohin das Token gehört; ein Auftrag an einen anderen Server sendet nichts. */
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
            // Ein Zertifikat, das nicht zum Pin passt, wird durch Warten nicht passender;
            // nachfragen kann im Hintergrund niemand.
            // Gemerkt statt in der Ursachenkette gesucht: Conscrypt reicht die Ausnahme des
            // Vertrauens nicht immer als Ursache weiter.
            if (abgelehnt.get() || generateSequence<Throwable>(e) { it.cause }.take(8).any { it is CertificateUnresolved }) Entwertungsergebnis.GIVE_UP
            else Entwertungsergebnis.LATER
        }
    }
}

internal enum class Entwertungsschritt { FERTIG, AGAIN, GIVEN_UP }

/** Etwa eine Woche bei WorkManagers Rückzug (30 s, verdoppelt, höchstens 5 h). */
internal const val REDEMPTION_MAX_ATTEMPTS = 40

/**
 * Ein Lauf des Arbeiters. Ein gesperrter Keystore ist wie ein fehlendes Netz ein
 * Grund zu warten (util/Tresorbefund); ein verlorener Schlüssel macht das Token
 * auch für einen Dieb unbrauchbar, also gibt es nichts mehr zu tun.
 */
// [deviceLocked]: Der Schlüssel des Tokens gibt erst nach dem Entsperren frei; Warten
// darauf ist kein Fehlversuch, sonst gäbe ein tagelang gesperrtes Gerät den Auftrag auf.
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

/** Reicht alles an [innen] weiter und merkt sich, ob ein Zertifikat ungeklärt abgelehnt wurde. */
// Prüft nichts selbst: jede Entscheidung trifft [innen] (PinTrust).
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
