package ch.brickinventoryapp.data.di

import ch.brickinventoryapp.model.ui.Meldung
import javax.inject.Inject
import android.os.Build
import ch.brickinventoryapp.core.data.BuildConfig
import ch.brickinventoryapp.data.Netzvertrauen
import ch.brickinventoryapp.data.Tokenspiegel
import ch.brickinventoryapp.netz.util.NetworkPolicy
import ch.brickinventoryapp.netz.util.VersionsHint
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.PasswordRequired
import ch.brickinventoryapp.data.RightsSignal
import ch.brickinventoryapp.data.SessionExpiredSignal
import ch.brickinventoryapp.data.SecondFactorRequired
import ch.brickinventoryapp.netz.util.RenewableTlsFactory
import ch.brickinventoryapp.data.util.LanguageManager
import ch.brickinventoryapp.sicherheit.PinTrust
import ch.brickinventoryapp.sicherheit.ChoiceTrust
import ch.brickinventoryapp.sicherheit.CertificateQuestion
import ch.brickinventoryapp.sicherheit.trustJob
import ch.brickinventoryapp.data.util.networkRecording
import ch.brickinventoryapp.sicherheit.pinKey
import ch.brickinventoryapp.sicherheit.spkiFingerprint
import ch.brickinventoryapp.sicherheit.SystemRoots
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.netz.di.Rotationsanlass
import ch.brickinventoryapp.netz.di.ServerWaechter
import ch.brickinventoryapp.netz.di.Zugangslage

/**
 * Die Zugangslage des Geräts. Die Werte kommen aus dem Speicherspiegel der
 * TokenAblage; nur beim Kaltstart wird auf die Platte gewartet, ohne
 * runBlocking (TokenAblage.waitOnStart).
 */
private class DevicesAccess(private val prefs: Tokenspiegel) : Zugangslage {
    // Immer warten, nicht nur ohne Spiegelwert: Erst danach ist auch der alte
    // Stand der Nutzer-CAs zurückgesetzt. Nach dem Kaltstart kehrt es sofort zurück.
    private fun bereit() = prefs.waitOnStart()
    // Eine QR-Kopplung spricht schon den neuen Server an; der Token bleibt an seine
    // Herkunft gebunden und geht dorthin nicht mit (ServerWaechter.setHeaders).
    override fun serverUrl(): String { bereit(); return prefs.kopplungszielState.value ?: prefs.serverUrlState.value.orEmpty() }
    override fun token(): String { bereit(); return prefs.authTokenState.value.orEmpty() }
    override fun tokenOrigin(): String? { bereit(); return prefs.tokenOriginState.value }
    override fun generation(): Long { bereit(); return prefs.tokenGeneration() }
}

private fun vertrauen(ks: java.security.KeyStore?): javax.net.ssl.X509ExtendedTrustManager {
    val tmf = javax.net.ssl.TrustManagerFactory.getInstance(javax.net.ssl.TrustManagerFactory.getDefaultAlgorithm())
    tmf.init(ks)
    return tmf.trustManagers.filterIsInstance<javax.net.ssl.X509ExtendedTrustManager>().first()
}

/** Dieselben System-Wurzeln wie im Pinning (ohne Nutzer-CAs), erst beim ersten Bedarf gelesen. */
internal fun systemRoots(): SystemRoots {
    val fingerabdruecke by lazy { vertrauen(null).acceptedIssuers.map { spkiFingerprint(it) }.toSet() }
    return SystemRoots { it in fingerabdruecke }
}

/**
 * System-CAs nach network_security_config (ohne Nutzer-CAs), dazu der
 * AndroidCAStore samt Nutzer-CAs für die ausdrückliche Einstellung — nur für den
 * eigenen Server; darüber dessen Pinning (util/ServerVertrauen.kt).
 */
private var trustShared: PinTrust? = null
private var sharedTls: RenewableTlsFactory? = null

/** Ein SSLContext für alle Server-Clients; neu, sobald die Nutzer-CAs umschalten. */
@Synchronized
private fun serverTls(prefs: Netzvertrauen, tm: PinTrust): RenewableTlsFactory {
    sharedTls?.let { return it }
    val factory = RenewableTlsFactory {
        javax.net.ssl.SSLContext.getInstance("TLS").apply { init(null, arrayOf(tm), null) }.socketFactory
    }
    prefs.onUserCaSwitch { factory.renew() }
    return factory.also { sharedTls = it }
}

@Synchronized
private fun trustServer(prefs: Netzablagen, frage: CertificateQuestion): PinTrust {
    trustShared?.let { return it }
    val system = vertrauen(null)
    return PinTrust(
        kette = ChoiceTrust(
            system = system,
            withUser = lazy { vertrauen(java.security.KeyStore.getInstance("AndroidCAStore").apply { load(null) }) },
            userAllowed = { prefs.vertrauen.userCaAllowed() },
        ),
        pins = prefs.vertrauen,
        ownServer = { pinKey(prefs.token.kopplungszielState.value ?: prefs.token.serverUrlState.value.orEmpty()) },
        frage = frage,
        foreignHosts = system,
        ctForced = Build.VERSION.SDK_INT >= ANDROID_16,
    ).also { trustShared = it }
}

/** Ab hier verlangt network_security_config Certificate Transparency für öffentliche CAs. */
private const val ANDROID_16 = 36

/** Token und Vertrauen zusammen: Die Server-Clients brauchen beides, sonst nichts aus den Ablagen. */
class Netzablagen @Inject constructor(val token: Tokenspiegel, val vertrauen: Netzvertrauen)

/** API-, Bild- und SSE-Client: derselbe Wächter (ServerWaechter.kt), eigene Zeitgrenzen. */
@Suppress("LongParameterList") // Ein Baustein für drei Clients; die Teile unterscheiden sich je Client.
internal fun buildInterceptorClient(
    prefs: Netzablagen,
    isApiClient: Boolean,
    sessionExpired: SessionExpiredSignal,
    ctx: android.content.Context,
    /** Wohin ein Versionshinweis geht; nur der API-Client meldet. */
    meldungen: MeldungsKanal? = null,
    /** Wartet auf die Entscheidung über ein unbekanntes Zertifikat. */
    frage: CertificateQuestion,
    /** Tauscht den Token, wenn der Server es verlangt; nur für Clients mit Token. */
    rotation: Rotationsanlass? = null,
    /** Nur der API-Client: Dort kommen die Verwalteraufrufe an. */
    rights: RightsSignal? = null,
    /** Nur der API-Client: Mit Startpasswort weist der Server jeden Abruf ab. */
    pflicht: PasswordRequired? = null,
    /** Nur der API-Client: Verwalterrechte ohne zweiten Faktor weist der Server ab. */
    factorRequired: SecondFactorRequired? = null,
): OkHttpClient {
    val versionsMessage: ((VersionsHint) -> Unit)? = meldungen?.let { kanal ->
        { hinweis: VersionsHint ->
            kanal.zeige(Meldung.Resource(
                if (hinweis == VersionsHint.APP_ZU_ALT) R.string.api_app_zu_alt
                else R.string.api_server_zu_alt))
        }
    }
    val client = OkHttpClient.Builder()
        .apply {
            // Auch der Bild-Client: Sonst fehlten Bildanfragen im Logcat, und ihr
            // Fehlen sähe aus wie ein Befund statt wie eine Lücke der Beobachtung.
            if (BuildConfig.DEBUG) {
                addInterceptor(networkRecording())
            }
        }
        // Keine Umleitung am Wächter vorbei: Er sieht nur, was er selbst schickt, und
        // folgt nur innerhalb derselben Herkunft (ServerWaechter.senden).
        .followRedirects(false)
        .followSslRedirects(false)
        .addInterceptor(ServerWaechter(DevicesAccess(prefs.token), isApiClient, NetworkPolicy.entwicklung,
            sitzungAbgelaufen = { sessionExpired.notifyExpired() }, versionsMessage = versionsMessage,
            // Die Sprache aus den Ressourcen: Der Server antwortet in der, die die Oberfläche zeigt.
            ownHeaders = { original, ziel ->
                if (original.header("Accept-Language") == null) ziel.header("Accept-Language",
                    LanguageManager.localizedContext(ctx)
                        .getString(R.string.lang_code))
            }, rotation = rotation, rightsRevoked = { rights?.melde() },
            passwordSwitchNeeded = { pflicht?.melde() }, zweiterFaktorPflicht = { factorRequired?.melde() }))
        .apply {
            val tm = trustServer(prefs, frage)
            sslSocketFactory(serverTls(prefs.vertrauen, tm), tm)
        }
        .connectTimeout(15, TimeUnit.SECONDS)
        // Ein Zwischen-Byte-Timeout; die PDF-Erzeugung läuft über Job-Polling.
        .readTimeout(60, TimeUnit.SECONDS)
        .build()
    followsTheServer(prefs, client)
    return client
}

/**
 * Derselbe TLS-Weg wie die Server-Clients (Pins, Nutzer-CAs nur für den eigenen
 * Server), aber ohne den Wächter der App: Den setzt der Entwerter mit dem Token
 * des Auftrags selbst ein.
 */
internal fun buildRedemptionBase(
    prefs: Netzablagen,
    frage: CertificateQuestion,
): OkHttpClient = OkHttpClient.Builder()
    .followRedirects(false)
    .followSslRedirects(false)
    .apply {
        val tm = trustServer(prefs, frage)
        sslSocketFactory(serverTls(prefs.vertrauen, tm), tm)
    }
    .connectTimeout(15, TimeUnit.SECONDS)
    .readTimeout(30, TimeUnit.SECONDS)
    .build()

/**
 * Vertrauen je Entwertungsauftrag (data/Entwertung.kt): der Pin aus dem Auftrag,
 * sonst der gemerkte — Pins bleiben beim Abmelden stehen. Nutzer-CAs wie beim
 * eigenen Server nur auf ausdrückliche Einstellung.
 */
internal fun jobTrustFactory(prefs: Netzvertrauen): (String, String?) -> javax.net.ssl.X509ExtendedTrustManager {
    val system = vertrauen(null)
    val kette = ChoiceTrust(
        system = system,
        withUser = lazy { vertrauen(java.security.KeyStore.getInstance("AndroidCAStore").apply { load(null) }) },
        userAllowed = { prefs.userCaAllowed() },
    )
    return { schluessel, pin -> trustJob(kette, system, schluessel, pin ?: prefs.pin(schluessel)) }
}

/**
 * Beim Wechsel auf einen anderen Server laufende Aufrufe abbrechen; nach dem
 * Umschalten der Nutzer-CAs keine Verbindung mit dem alten Vertrauen weiterbenutzen.
 * Für jeden Client mit eigenem Dispatcher oder Pool (der Bild-Client hat einen).
 */
internal fun followsTheServer(prefs: Netzablagen, client: OkHttpClient) {
    prefs.token.onServerwechsel { client.dispatcher.cancelAll() }
    prefs.vertrauen.onUserCaSwitch { client.connectionPool.evictAll() }
}
