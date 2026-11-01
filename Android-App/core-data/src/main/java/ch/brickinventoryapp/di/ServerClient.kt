package ch.brickinventoryapp.di

import ch.brickinventoryapp.core.data.BuildConfig
import ch.brickinventoryapp.data.PreferencesManager
import ch.brickinventoryapp.util.NetworkPolicy
import ch.brickinventoryapp.util.VersionsHinweis
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/**
 * Die Zugangslage des Geräts. Die Werte kommen aus dem Speicherspiegel des
 * PreferencesManagers; nur beim Kaltstart wird auf die Platte gewartet, ohne
 * runBlocking (PreferencesManager.warteAufStart).
 */
private class GeraeteZugang(private val prefs: PreferencesManager) : Zugangslage {
    // Immer warten, nicht nur ohne Spiegelwert: Erst danach ist auch der alte
    // Stand der Nutzer-CAs zurückgesetzt. Nach dem Kaltstart kehrt es sofort zurück.
    private fun bereit() = prefs.warteAufStart()
    override fun serverUrl(): String { bereit(); return prefs.serverUrlState.value.orEmpty() }
    override fun token(): String { bereit(); return prefs.authTokenState.value.orEmpty() }
    override fun tokenHerkunft(): String? { bereit(); return prefs.tokenHerkunftState.value }
}

private fun vertrauen(ks: java.security.KeyStore?): javax.net.ssl.X509ExtendedTrustManager {
    val tmf = javax.net.ssl.TrustManagerFactory.getInstance(javax.net.ssl.TrustManagerFactory.getDefaultAlgorithm())
    tmf.init(ks)
    return tmf.trustManagers.filterIsInstance<javax.net.ssl.X509ExtendedTrustManager>().first()
}

/**
 * System-CAs nach network_security_config (ohne Nutzer-CAs), dazu der
 * AndroidCAStore samt Nutzer-CAs für die ausdrückliche Einstellung — nur für den
 * eigenen Server; darüber dessen Pinning (util/ServerVertrauen.kt).
 */
private var gemeinsamesVertrauen: ch.brickinventoryapp.util.PinVertrauen? = null

@Synchronized
private fun serverVertrauen(prefs: PreferencesManager, frage: ch.brickinventoryapp.util.ZertifikatsFrage): ch.brickinventoryapp.util.PinVertrauen {
    gemeinsamesVertrauen?.let { return it }
    val system = vertrauen(null)
    return ch.brickinventoryapp.util.PinVertrauen(
        kette = ch.brickinventoryapp.util.WahlVertrauen(
            system = system,
            mitNutzer = lazy { vertrauen(java.security.KeyStore.getInstance("AndroidCAStore").apply { load(null) }) },
            nutzerErlaubt = { prefs.nutzerCaErlaubt() },
        ),
        pins = prefs,
        eigenerServer = { ch.brickinventoryapp.util.pinSchluessel(prefs.serverUrlState.value.orEmpty()) },
        frage = frage,
        fremdeHosts = system,
    ).also { gemeinsamesVertrauen = it }
}

/** API-, Bild- und SSE-Client: derselbe Wächter (ServerWaechter.kt), eigene Zeitgrenzen. */
internal fun buildInterceptorClient(
    prefs: PreferencesManager,
    isApiClient: Boolean,
    sessionExpired: ch.brickinventoryapp.data.SessionExpiredSignal,
    ctx: android.content.Context,
    /** Wohin ein Versionshinweis geht; nur der API-Client meldet. */
    meldungen: ch.brickinventoryapp.data.MeldungsKanal? = null,
    /** Wartet auf die Entscheidung über ein unbekanntes Zertifikat. */
    frage: ch.brickinventoryapp.util.ZertifikatsFrage,
    /** Tauscht den Token, wenn der Server es verlangt; nur für Clients mit Token. */
    rotation: Rotationsanlass? = null,
    /** Nur der API-Client: Dort kommen die Verwalteraufrufe an. */
    rechte: ch.brickinventoryapp.data.RechteSignal? = null,
    /** Nur der API-Client: Mit Startpasswort weist der Server jeden Abruf ab. */
    pflicht: ch.brickinventoryapp.data.PasswortPflicht? = null,
): OkHttpClient {
    val versionsMeldung: ((VersionsHinweis) -> Unit)? = meldungen?.let { kanal ->
        { hinweis: VersionsHinweis ->
            kanal.fluss.value = ch.brickinventoryapp.util.LanguageManager.localizedContext(ctx).getString(
                if (hinweis == VersionsHinweis.APP_ZU_ALT) ch.brickinventoryapp.ressourcen.R.string.api_app_zu_alt
                else ch.brickinventoryapp.ressourcen.R.string.api_server_zu_alt)
        }
    }
    return OkHttpClient.Builder()
        .apply {
            // Auch der Bild-Client: Sonst fehlten Bildanfragen im Logcat, und ihr
            // Fehlen sähe aus wie ein Befund statt wie eine Lücke der Beobachtung.
            if (BuildConfig.DEBUG) {
                addInterceptor(ch.brickinventoryapp.util.netzMitschnitt())
            }
        }
        // Eine Umleitung von https auf http liefe am Wächter vorbei, der nur die
        // erste Anfrage sieht.
        .followSslRedirects(false)
        .addInterceptor(ServerWaechter(GeraeteZugang(prefs), isApiClient, NetworkPolicy.entwicklung,
            sitzungAbgelaufen = { sessionExpired.notifyExpired() }, versionsMeldung = versionsMeldung,
            // Die Sprache aus den Ressourcen: Der Server antwortet in der, die die Oberfläche zeigt.
            eigeneKoepfe = { original, ziel ->
                if (original.header("Accept-Language") == null) ziel.header("Accept-Language",
                    ch.brickinventoryapp.util.LanguageManager.localizedContext(ctx)
                        .getString(ch.brickinventoryapp.ressourcen.R.string.lang_code))
            }, rotation = rotation, rechteEntzogen = { rechte?.melde() },
            passwortWechselNoetig = { pflicht?.melde() }))
        .apply {
            val tm = serverVertrauen(prefs, frage)
            val tls = javax.net.ssl.SSLContext.getInstance("TLS").apply { init(null, arrayOf(tm), null) }
            sslSocketFactory(tls.socketFactory, tm)
        }
        .connectTimeout(15, TimeUnit.SECONDS)
        // Ein Zwischen-Byte-Timeout; die PDF-Erzeugung läuft über Job-Polling.
        .readTimeout(60, TimeUnit.SECONDS)
        .build()
}
