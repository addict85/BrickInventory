package ch.brickinventoryapp.data.di

import ch.brickinventoryapp.model.ui.Meldung
import javax.inject.Inject
import ch.brickinventoryapp.core.data.BuildConfig
import ch.brickinventoryapp.data.Netzvertrauen
import ch.brickinventoryapp.data.Tokenspiegel
import ch.brickinventoryapp.netz.util.NetworkPolicy
import ch.brickinventoryapp.netz.util.VersionsHinweis
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.PasswortPflicht
import ch.brickinventoryapp.data.RechteSignal
import ch.brickinventoryapp.data.SessionExpiredSignal
import ch.brickinventoryapp.data.ZweiterFaktorPflicht
import ch.brickinventoryapp.netz.util.ErneuerbareTlsFabrik
import ch.brickinventoryapp.data.util.LanguageManager
import ch.brickinventoryapp.sicherheit.PinVertrauen
import ch.brickinventoryapp.sicherheit.WahlVertrauen
import ch.brickinventoryapp.sicherheit.ZertifikatsFrage
import ch.brickinventoryapp.sicherheit.auftragsVertrauen
import ch.brickinventoryapp.data.util.netzMitschnitt
import ch.brickinventoryapp.sicherheit.pinSchluessel
import ch.brickinventoryapp.sicherheit.spkiFingerabdruck
import ch.brickinventoryapp.sicherheit.SystemWurzeln
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.netz.di.Rotationsanlass
import ch.brickinventoryapp.netz.di.ServerWaechter
import ch.brickinventoryapp.netz.di.Zugangslage

/**
 * Die Zugangslage des Geräts. Die Werte kommen aus dem Speicherspiegel der
 * TokenAblage; nur beim Kaltstart wird auf die Platte gewartet, ohne
 * runBlocking (TokenAblage.warteAufStart).
 */
private class GeraeteZugang(private val prefs: Tokenspiegel) : Zugangslage {
    // Immer warten, nicht nur ohne Spiegelwert: Erst danach ist auch der alte
    // Stand der Nutzer-CAs zurückgesetzt. Nach dem Kaltstart kehrt es sofort zurück.
    private fun bereit() = prefs.warteAufStart()
    override fun serverUrl(): String { bereit(); return prefs.serverUrlState.value.orEmpty() }
    override fun token(): String { bereit(); return prefs.authTokenState.value.orEmpty() }
    override fun tokenHerkunft(): String? { bereit(); return prefs.tokenHerkunftState.value }
    override fun generation(): Long { bereit(); return prefs.tokenGeneration() }
}

private fun vertrauen(ks: java.security.KeyStore?): javax.net.ssl.X509ExtendedTrustManager {
    val tmf = javax.net.ssl.TrustManagerFactory.getInstance(javax.net.ssl.TrustManagerFactory.getDefaultAlgorithm())
    tmf.init(ks)
    return tmf.trustManagers.filterIsInstance<javax.net.ssl.X509ExtendedTrustManager>().first()
}

/** Dieselben System-Wurzeln wie im Pinning (ohne Nutzer-CAs), erst beim ersten Bedarf gelesen. */
internal fun systemWurzeln(): SystemWurzeln {
    val fingerabdruecke by lazy { vertrauen(null).acceptedIssuers.map { spkiFingerabdruck(it) }.toSet() }
    return SystemWurzeln { it in fingerabdruecke }
}

/**
 * System-CAs nach network_security_config (ohne Nutzer-CAs), dazu der
 * AndroidCAStore samt Nutzer-CAs für die ausdrückliche Einstellung — nur für den
 * eigenen Server; darüber dessen Pinning (util/ServerVertrauen.kt).
 */
private var gemeinsamesVertrauen: PinVertrauen? = null
private var gemeinsameTls: ErneuerbareTlsFabrik? = null

/** Ein SSLContext für alle Server-Clients; neu, sobald die Nutzer-CAs umschalten. */
@Synchronized
private fun serverTls(prefs: Netzvertrauen, tm: PinVertrauen): ErneuerbareTlsFabrik {
    gemeinsameTls?.let { return it }
    val fabrik = ErneuerbareTlsFabrik {
        javax.net.ssl.SSLContext.getInstance("TLS").apply { init(null, arrayOf(tm), null) }.socketFactory
    }
    prefs.beimNutzerCaWechsel { fabrik.erneuere() }
    return fabrik.also { gemeinsameTls = it }
}

@Synchronized
private fun serverVertrauen(prefs: Netzablagen, frage: ZertifikatsFrage): PinVertrauen {
    gemeinsamesVertrauen?.let { return it }
    val system = vertrauen(null)
    return PinVertrauen(
        kette = WahlVertrauen(
            system = system,
            mitNutzer = lazy { vertrauen(java.security.KeyStore.getInstance("AndroidCAStore").apply { load(null) }) },
            nutzerErlaubt = { prefs.vertrauen.nutzerCaErlaubt() },
        ),
        pins = prefs.vertrauen,
        eigenerServer = { pinSchluessel(prefs.token.serverUrlState.value.orEmpty()) },
        frage = frage,
        fremdeHosts = system,
    ).also { gemeinsamesVertrauen = it }
}

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
    frage: ZertifikatsFrage,
    /** Tauscht den Token, wenn der Server es verlangt; nur für Clients mit Token. */
    rotation: Rotationsanlass? = null,
    /** Nur der API-Client: Dort kommen die Verwalteraufrufe an. */
    rechte: RechteSignal? = null,
    /** Nur der API-Client: Mit Startpasswort weist der Server jeden Abruf ab. */
    pflicht: PasswortPflicht? = null,
    /** Nur der API-Client: Verwalterrechte ohne zweiten Faktor weist der Server ab. */
    faktorPflicht: ZweiterFaktorPflicht? = null,
): OkHttpClient {
    val versionsMeldung: ((VersionsHinweis) -> Unit)? = meldungen?.let { kanal ->
        { hinweis: VersionsHinweis ->
            kanal.zeige(Meldung.Ressource(
                if (hinweis == VersionsHinweis.APP_ZU_ALT) R.string.api_app_zu_alt
                else R.string.api_server_zu_alt))
        }
    }
    val client = OkHttpClient.Builder()
        .apply {
            // Auch der Bild-Client: Sonst fehlten Bildanfragen im Logcat, und ihr
            // Fehlen sähe aus wie ein Befund statt wie eine Lücke der Beobachtung.
            if (BuildConfig.DEBUG) {
                addInterceptor(netzMitschnitt())
            }
        }
        // Keine Umleitung am Wächter vorbei: Er sieht nur, was er selbst schickt, und
        // folgt nur innerhalb derselben Herkunft (ServerWaechter.senden).
        .followRedirects(false)
        .followSslRedirects(false)
        .addInterceptor(ServerWaechter(GeraeteZugang(prefs.token), isApiClient, NetworkPolicy.entwicklung,
            sitzungAbgelaufen = { sessionExpired.notifyExpired() }, versionsMeldung = versionsMeldung,
            // Die Sprache aus den Ressourcen: Der Server antwortet in der, die die Oberfläche zeigt.
            eigeneKoepfe = { original, ziel ->
                if (original.header("Accept-Language") == null) ziel.header("Accept-Language",
                    LanguageManager.localizedContext(ctx)
                        .getString(R.string.lang_code))
            }, rotation = rotation, rechteEntzogen = { rechte?.melde() },
            passwortWechselNoetig = { pflicht?.melde() }, zweiterFaktorPflicht = { faktorPflicht?.melde() }))
        .apply {
            val tm = serverVertrauen(prefs, frage)
            sslSocketFactory(serverTls(prefs.vertrauen, tm), tm)
        }
        .connectTimeout(15, TimeUnit.SECONDS)
        // Ein Zwischen-Byte-Timeout; die PDF-Erzeugung läuft über Job-Polling.
        .readTimeout(60, TimeUnit.SECONDS)
        .build()
    folgtDemServer(prefs, client)
    return client
}

/**
 * Derselbe TLS-Weg wie die Server-Clients (Pins, Nutzer-CAs nur für den eigenen
 * Server), aber ohne den Wächter der App: Den setzt der Entwerter mit dem Token
 * des Auftrags selbst ein.
 */
internal fun buildEntwertungsBasis(
    prefs: Netzablagen,
    frage: ZertifikatsFrage,
): OkHttpClient = OkHttpClient.Builder()
    .followRedirects(false)
    .followSslRedirects(false)
    .apply {
        val tm = serverVertrauen(prefs, frage)
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
internal fun auftragsVertrauenFabrik(prefs: Netzvertrauen): (String, String?) -> javax.net.ssl.X509ExtendedTrustManager {
    val system = vertrauen(null)
    val kette = WahlVertrauen(
        system = system,
        mitNutzer = lazy { vertrauen(java.security.KeyStore.getInstance("AndroidCAStore").apply { load(null) }) },
        nutzerErlaubt = { prefs.nutzerCaErlaubt() },
    )
    return { schluessel, pin -> auftragsVertrauen(kette, system, schluessel, pin ?: prefs.pin(schluessel)) }
}

/**
 * Beim Wechsel auf einen anderen Server laufende Aufrufe abbrechen; nach dem
 * Umschalten der Nutzer-CAs keine Verbindung mit dem alten Vertrauen weiterbenutzen.
 * Für jeden Client mit eigenem Dispatcher oder Pool (der Bild-Client hat einen).
 */
internal fun folgtDemServer(prefs: Netzablagen, client: OkHttpClient) {
    prefs.token.beimServerwechsel { client.dispatcher.cancelAll() }
    prefs.vertrauen.beimNutzerCaWechsel { client.connectionPool.evictAll() }
}
