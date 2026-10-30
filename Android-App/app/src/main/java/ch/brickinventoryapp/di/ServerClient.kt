package ch.brickinventoryapp.di

import ch.brickinventoryapp.BuildConfig
import ch.brickinventoryapp.data.PreferencesManager
import ch.brickinventoryapp.util.BeweisSpeicher
import ch.brickinventoryapp.util.VersionsHinweis
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import java.util.concurrent.TimeUnit

/** Gemeinsam für API- und Bild-Client: ein Beweis je Server, Netz und Token. */
private val beweise = BeweisSpeicher()

/**
 * Die Zugangslage des Geräts. Die Werte kommen aus dem Speicherspiegel des
 * PreferencesManagers; nur beim Kaltstart wird auf die Platte gewartet, ohne
 * runBlocking (PreferencesManager.warteAufStart).
 */
private class GeraeteZugang(
    private val prefs: PreferencesManager,
    private val ctx: android.content.Context,
) : Zugangslage {
    private fun bereit() {
        if (prefs.serverUrlState.value == null || prefs.authTokenState.value == null ||
            prefs.klartextHostsState.value == null) prefs.warteAufStart()
    }
    override fun serverUrl(): String { bereit(); return prefs.serverUrlState.value.orEmpty() }
    override fun token(): String { bereit(); return prefs.authTokenState.value.orEmpty() }
    override fun tokenHerkunft(): String? { bereit(); return prefs.tokenHerkunftState.value }
    override fun klartextHosts(): Set<String> { bereit(); return prefs.klartextHostsState.value.orEmpty() }
    override fun netz(): String = runCatching {
        (ctx.getSystemService(android.content.Context.CONNECTIVITY_SERVICE) as? android.net.ConnectivityManager)
            ?.activeNetwork?.toString()
    }.getOrNull() ?: "?"
}

private fun vertrauen(ks: java.security.KeyStore?): javax.net.ssl.X509ExtendedTrustManager {
    val tmf = javax.net.ssl.TrustManagerFactory.getInstance(javax.net.ssl.TrustManagerFactory.getDefaultAlgorithm())
    tmf.init(ks)
    return tmf.trustManagers.filterIsInstance<javax.net.ssl.X509ExtendedTrustManager>().first()
}

/**
 * System-CAs nach network_security_config (ohne Nutzer-CAs), dazu der
 * AndroidCAStore samt Nutzer-CAs für die ausdrückliche Einstellung.
 */
private var gemeinsamesVertrauen: ch.brickinventoryapp.util.WahlVertrauen? = null

@Synchronized
private fun serverVertrauen(prefs: PreferencesManager): ch.brickinventoryapp.util.WahlVertrauen =
    gemeinsamesVertrauen ?: ch.brickinventoryapp.util.WahlVertrauen(
        system = vertrauen(null),
        mitNutzer = lazy { vertrauen(java.security.KeyStore.getInstance("AndroidCAStore").apply { load(null) }) },
        nutzerErlaubt = { prefs.nutzerCaErlaubt() },
    ).also { gemeinsamesVertrauen = it }

/** API-, Bild- und SSE-Client: derselbe Wächter (ServerWaechter.kt), eigene Zeitgrenzen. */
internal fun buildInterceptorClient(
    prefs: PreferencesManager,
    isApiClient: Boolean,
    sessionExpired: ch.brickinventoryapp.data.SessionExpiredSignal,
    ctx: android.content.Context,
    /** Wohin ein Versionshinweis geht; nur der API-Client meldet. */
    meldungen: ch.brickinventoryapp.data.MeldungsKanal? = null,
): OkHttpClient {
    val versionsMeldung: ((VersionsHinweis) -> Unit)? = meldungen?.let { kanal ->
        { hinweis: VersionsHinweis ->
            kanal.fluss.value = ch.brickinventoryapp.util.LanguageManager.localizedContext(ctx).getString(
                if (hinweis == VersionsHinweis.APP_ZU_ALT) ch.brickinventoryapp.R.string.api_app_zu_alt
                else ch.brickinventoryapp.R.string.api_server_zu_alt)
        }
    }
    return OkHttpClient.Builder()
        .apply {
            // Auch der Bild-Client: Sonst fehlten Bildanfragen im Logcat, und ihr
            // Fehlen sähe aus wie ein Befund statt wie eine Lücke der Beobachtung.
            if (BuildConfig.DEBUG) {
                addInterceptor(HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.BASIC })
            }
        }
        .addInterceptor(ServerWaechter(GeraeteZugang(prefs, ctx), isApiClient, beweise,
            sitzungAbgelaufen = { sessionExpired.notifyExpired() }, versionsMeldung = versionsMeldung,
            // Die Sprache aus den Ressourcen: Der Server antwortet in der, die die Oberfläche zeigt.
            eigeneKoepfe = { original, ziel ->
                if (original.header("Accept-Language") == null) ziel.header("Accept-Language",
                    ch.brickinventoryapp.util.LanguageManager.localizedContext(ctx)
                        .getString(ch.brickinventoryapp.R.string.lang_code))
            }))
        .apply {
            val tm = serverVertrauen(prefs)
            val tls = javax.net.ssl.SSLContext.getInstance("TLS").apply { init(null, arrayOf(tm), null) }
            sslSocketFactory(tls.socketFactory, tm)
        }
        .connectTimeout(15, TimeUnit.SECONDS)
        // Ein Zwischen-Byte-Timeout; die PDF-Erzeugung läuft über Job-Polling.
        .readTimeout(60, TimeUnit.SECONDS)
        .build()
}
