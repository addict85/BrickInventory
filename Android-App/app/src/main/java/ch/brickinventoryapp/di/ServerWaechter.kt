package ch.brickinventoryapp.di

import ch.brickinventoryapp.data.api.Fehlerrumpf
import ch.brickinventoryapp.util.APP_API_VERSION
import ch.brickinventoryapp.util.BeweisSpeicher
import ch.brickinventoryapp.util.NetworkPolicy
import ch.brickinventoryapp.util.ServerBeweis
import ch.brickinventoryapp.util.VersionsHinweis
import ch.brickinventoryapp.util.darfNachfassen
import ch.brickinventoryapp.util.versionsHinweis
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
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
    fun klartextHosts(): Set<String>
    /** Kennung des aktiven Netzes; ein WLAN-Wechsel ergibt eine neue. */
    fun netz(): String
}

/** Platzhalter, auf den Retrofit gebaut ist; der Wächter schreibt ihn auf den Server um. */
const val PLATZHALTER_BASIS = "http://localhost:3000/"

/**
 * Token, Sprache und Klartextregel für alle Anfragen an den eigenen Server.
 *
 * Ein 401 meldet die abgelaufene Sitzung nur, wenn der Token tatsächlich an einen
 * Server ging, der sich ausgewiesen hat (https oder Serverbeweis). Ein Server, der
 * den Beweis verweigert, kann so keine Abmeldung erzwingen — sonst tippte der
 * Nutzer sein Passwort danach in genau diesen Server.
 */
class ServerWaechter(
    private val lage: Zugangslage,
    private val istApiClient: Boolean,
    private val beweise: BeweisSpeicher,
    private val sitzungAbgelaufen: () -> Unit,
    private val versionsMeldung: ((VersionsHinweis) -> Unit)? = null,
    /** Weitere Köpfe nur für den eigenen Server (die Anzeigesprache, ServerClient.kt). */
    private val eigeneKoepfe: (original: Request, ziel: Request.Builder) -> Unit = { _, _ -> },
) : Interceptor {

    private val versionGemeldet = AtomicBoolean(false)

    override fun intercept(chain: Interceptor.Chain): Response {
        val original = chain.request()
        val serverUrl = lage.serverUrl().trim().trimEnd('/')
        val token = lage.token()
        val reqBuilder = original.newBuilder()

        if (istApiClient && original.url.toString().startsWith(PLATZHALTER_BASIS)) {
            val ziel = serverUrl.ifBlank { PLATZHALTER_BASIS.trimEnd('/') }.toHttpUrl()
            // Ein Pfad-Präfix des Servers (Reverse-Proxy unter /brick) bleibt erhalten.
            val basisPfad = ziel.encodedPath.trimEnd('/')
            val neu = original.url.newBuilder().scheme(ziel.scheme).host(ziel.host).port(ziel.port)
            if (basisPfad.isNotEmpty()) neu.encodedPath(basisPfad + original.url.encodedPath)
            reqBuilder.url(neu.build())
        }

        val finalUrl = reqBuilder.build().url
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
        if (!NetworkPolicy.isCleartextAllowed(ausgehend.url, lage.klartextHosts())) {
            throw IOException(
                "Unverschlüsselte Verbindung zu ${ausgehend.url.host} abgebrochen — " +
                    "bitte https verwenden, eine Adresse im lokalen Netz, oder den Server " +
                    "in der Einrichtung ausdrücklich für Klartext bestätigen."
            )
        }

        pruefeServer(chain, ausgehend, serverUrl, unserServer)
        var antwort = chain.proceed(ausgehend)
        var tokenMitgeschickt = mitToken && ausgehend.header("Authorization") != null

        // Die Anmeldung setzt den Token und feuert sofort Abrufe; einer kann noch
        // ohne Kopf hinausgegangen sein (util/Abgewiesen.kt).
        if (darfNachfassen(antwort.code, unserServer, ausgehend.header("Authorization") != null, ausgehend.method)) {
            val jetzt = lage.token()
            if (jetzt.isNotBlank() && tokenGehoertHierher) {
                antwort.close()
                val nachfass = ausgehend.newBuilder().header("Authorization", "Bearer $jetzt").build()
                pruefeServer(chain, nachfass, serverUrl, unserServer)
                antwort = chain.proceed(nachfass)
                tokenMitgeschickt = true
            }
        }

        if (antwort.code == 401 && tokenMitgeschickt && unserServer) sitzungAbgelaufen()

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
     * Vor einem Token im Klartext muss sich der Server in diesem Netz ausweisen
     * (util/ServerBeweis.kt). Scheitert das, geht weder der Token hinaus, noch
     * wird abgemeldet: Ein fremder Server darf die Sitzung nicht beenden können.
     */
    private fun pruefeServer(chain: Interceptor.Chain, anfrage: Request, serverUrl: String, unserServer: Boolean) {
        val kopf = anfrage.header("Authorization") ?: return
        if (anfrage.url.isHttps || !unserServer) return
        val mitToken = kopf.removePrefix("Bearer ").trim()
        val schluessel = beweise.schluessel(anfrage.url.host, anfrage.url.port, lage.netz(), mitToken)
        if (beweise.bekannt(schluessel)) return
        val nonce = ServerBeweis.neueNonce()
        val frage = Request.Builder()
            .url("$serverUrl/api/v1/auth/serverbeweis")
            .header("X-App-Api", APP_API_VERSION.toString())
            .post("""{"kennung":"${ServerBeweis.kennung(mitToken)}","nonce":"$nonce"}"""
                .toRequestBody("application/json".toMediaType()))
            .build()
        val (code, text) = chain.proceed(frage).use { it.code to it.body.string() }
        if (code == 200 && ServerBeweis.stimmt(mitToken, nonce, ServerBeweis.ausAntwort(text))) {
            beweise.merke(schluessel)
            return
        }
        val grund = Fehlerrumpf.lies(text).code
        throw IOException(
            "Der Server unter ${anfrage.url.host} hat sich in diesem Netz nicht ausgewiesen" +
                (if (grund != null) " ($grund)" else "") +
                " — die Anmeldung wurde nicht unverschlüsselt gesendet."
        )
    }
}
