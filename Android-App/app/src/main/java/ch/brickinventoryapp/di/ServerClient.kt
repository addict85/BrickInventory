package ch.brickinventoryapp.di

import ch.brickinventoryapp.BuildConfig
import ch.brickinventoryapp.data.PreferencesManager
import ch.brickinventoryapp.util.NetworkPolicy
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.toRequestBody
import ch.brickinventoryapp.util.BeweisSpeicher
import ch.brickinventoryapp.util.ServerBeweis
import okhttp3.logging.HttpLoggingInterceptor
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Gemeinsam für API- und Bild-Client: ein Beweis je Server, Netz und Token. */
private val beweise = BeweisSpeicher()

/** Kennung des aktiven Netzes; ein WLAN-Wechsel ergibt eine neue. */
private fun netzKennung(ctx: android.content.Context): String = runCatching {
    (ctx.getSystemService(android.content.Context.CONNECTIVITY_SERVICE) as? android.net.ConnectivityManager)
        ?.activeNetwork?.toString()
}.getOrNull() ?: "?"

/**
 * Shared interceptor logic:
 * - API calls (localhost:3000) → rewrite to real server + add Bearer token
 * - Image calls (real server URL) → add Bearer token only
 * - External URLs (CDN) → pass through unchanged
 *
 * Liest URL/Token aus dem In-Memory-Cache des PreferencesManagers.
 * runBlocking wird nur noch als einmaliger Kaltstart-Fallback benutzt,
 * falls der DataStore beim allerersten Request noch nicht geladen ist.
 */
internal fun buildInterceptorClient(
    prefs: PreferencesManager,
    isApiClient: Boolean,
    sessionExpired: ch.brickinventoryapp.data.SessionExpiredSignal,
    /** Nur, um die Anzeigesprache aus den Ressourcen zu lesen. */
    ctx: android.content.Context,
    /** Wohin ein Versionshinweis geht; nur der API-Client meldet. */
    meldungen: ch.brickinventoryapp.data.MeldungsKanal? = null,
): OkHttpClient {
    val versionGemeldet = java.util.concurrent.atomic.AtomicBoolean(false)
    return OkHttpClient.Builder()
        .apply {
            // Für beide Clients protokolliert, auch den Bild-Client von Coil: Sonst fehlten
            // Bildanfragen im Logcat, und ihr Fehlen sähe aus wie ein Befund statt wie eine
            // Lücke in der Beobachtung.
            if (BuildConfig.DEBUG) {
                addInterceptor(HttpLoggingInterceptor().apply {
                    level = HttpLoggingInterceptor.Level.BASIC
                })
            }
        }
        .addInterceptor { chain ->
            val original = chain.request()
            // Dieselbe Regel wie PreferencesManager.tokenJetzt() /
            // serverUrlJetzt(): erst der fuehrende Speicherwert, und nur beim
            // Kaltstart die Platte. Hier steht sie ausgeschrieben statt als
            // Aufruf, weil der Interceptor auf OkHttp-Threads laeuft und dort
            // nicht suspendieren darf — `runBlocking` soll der Ausnahmefall
            // bleiben und nicht bei JEDER Anfrage durchlaufen werden.
            val serverUrl = (prefs.serverUrlState.value
                ?: runBlocking { prefs.serverUrl.first() }).trim().trimEnd('/')
            val token = prefs.authTokenState.value
                ?: runBlocking { prefs.authToken.first() }
            val urlStr = original.url.toString()

            val reqBuilder = original.newBuilder()

            // Rewrite localhost placeholder → real server (API client only)
            if (isApiClient && urlStr.startsWith("http://localhost:3000/")) {
                val parsed = serverUrl.ifBlank { "http://localhost:3000" }.toHttpUrl()
                // Pfad-Präfix des Servers erhalten (z. B. Reverse-Proxy unter /brick)
                val basePath = parsed.encodedPath.trimEnd('/')
                val newUrlBuilder = original.url.newBuilder()
                    .scheme(parsed.scheme)
                    .host(parsed.host)
                    .port(parsed.port)
                if (basePath.isNotEmpty()) {
                    newUrlBuilder.encodedPath(basePath + original.url.encodedPath)
                }
                reqBuilder.url(newUrlBuilder.build())
            }

            // Add Bearer token for all requests to our server.
            // Origin-Vergleich statt startsWith(): der frühere Präfixtest
            // hätte den Token auch an "https://<serverUrl>.angreifer.tld"
            // geschickt (siehe util/NetworkPolicy.kt).
            val finalUrl = reqBuilder.build().url
            // Kein Sonderfall für localhost:3000: Der Bild-Client schreibt
            // diese Adresse nicht um, der Token ginge sonst an das Gerät selbst.
            val isOurServer = serverUrl.isNotBlank() && NetworkPolicy.isSameOrigin(finalUrl, serverUrl)
            if (token.isNotBlank() && isOurServer && original.header("Authorization") == null) {
                reqBuilder.header("Authorization", "Bearer $token")
            }

            // ── Und in welcher Sprache soll der Server antworten? ──
            //
            // Der Server hat seine Fehlermeldungen in beiden Sprachen (utils/fehlerTexte.ts)
            // und wählt nach diesem Kopf. Die Kennung kommt aus den Ressourcen (lang_code),
            // damit sie genau das sagt, was die Oberfläche zeigt, samt der per-App-Sprache.
            // Nur an unseren Server: Ein Bildabruf bei BrickLink hat mit unserer
            // Anzeigesprache nichts zu tun.
            if (isOurServer) reqBuilder.header("X-App-Api", ch.brickinventoryapp.util.APP_API_VERSION.toString())
            if (isOurServer && original.header("Accept-Language") == null) {
                val sprache = ch.brickinventoryapp.util.LanguageManager
                    .localizedContext(ctx).getString(ch.brickinventoryapp.R.string.lang_code)
                reqBuilder.header("Accept-Language", sprache)
            }

            val outgoing = reqBuilder.build()
            // Kein Klartext zu öffentlichen Hosts: das Manifest erlaubt
            // cleartext weiterhin (die Server-URL ist frei konfigurierbar
            // und meist eine LAN-Adresse), aber ein nie ablaufender Bearer
            // Token darf nicht unverschlüsselt über das Internet gehen.
            val klartextHosts = prefs.klartextHostsState.value ?: runBlocking { prefs.klartextHostsJetzt() }
            if (!NetworkPolicy.isCleartextAllowed(outgoing.url, klartextHosts)) {
                throw IOException(
                    "Unverschlüsselte Verbindung zu ${outgoing.url.host} abgebrochen — " +
                    "bitte https verwenden, eine Adresse im lokalen Netz, oder den Server " +
                    "in der Einrichtung ausdrücklich für Klartext bestätigen."
                )
            }

            // Klartext mit Token: Erst muss sich der Server in diesem Netz
            // ausweisen (util/ServerBeweis.kt). Antwortet er, er kenne den
            // Token nicht, ist die Sitzung abgelaufen — oder es ist nicht
            // unser Server; in beiden Fällen geht der Token nicht hinaus.
            fun pruefeServer(anfrage: okhttp3.Request) {
                val kopf = anfrage.header("Authorization") ?: return
                if (anfrage.url.isHttps || !isOurServer) return
                val mitToken = kopf.removePrefix("Bearer ").trim()
                val schluessel = beweise.schluessel(anfrage.url.host, anfrage.url.port, netzKennung(ctx), mitToken)
                if (beweise.bekannt(schluessel)) return
                val nonce = ServerBeweis.neueNonce()
                val frage = okhttp3.Request.Builder()
                    .url("$serverUrl/api/v1/auth/serverbeweis")
                    .header("X-App-Api", ch.brickinventoryapp.util.APP_API_VERSION.toString())
                    .post("""{"kennung":"${ServerBeweis.kennung(mitToken)}","nonce":"$nonce"}"""
                        .toRequestBody("application/json".toMediaType()))
                    .build()
                val (code, text) = chain.proceed(frage).use { it.code to it.body.string() }
                if (code == 200 && ServerBeweis.stimmt(mitToken, nonce, ServerBeweis.ausAntwort(text))) {
                    beweise.merke(schluessel)
                    return
                }
                if (code != 200 && ch.brickinventoryapp.data.api.Fehlerrumpf.lies(text).code == "token_ungueltig") {
                    sessionExpired.notifyExpired()
                }
                throw IOException(
                    "Der Server unter ${anfrage.url.host} hat sich in diesem Netz nicht ausgewiesen — " +
                    "die Anmeldung wurde nicht unverschlüsselt gesendet."
                )
            }

            pruefeServer(outgoing)
            var response = chain.proceed(outgoing)
            var tokenMitgeschickt = token.isNotBlank()

            // ── Ein 401 auf eine Anfrage ohne Token: einmal nachfassen ──
            //
            // Die Regel steht als reine Funktion in util/Abgewiesen.kt, damit sie ohne
            // OkHttp-Stapel prüfbar ist. Hier nur die Ausführung: Liegt inzwischen ein Token
            // vor, geht dieselbe Anfrage mit ihm ein zweites Mal hinaus.
            if (ch.brickinventoryapp.util.darfNachfassen(
                    status = response.code,
                    unserServer = isOurServer,
                    hatteAuthKopf = outgoing.header("Authorization") != null,
                    methode = outgoing.method,
                )) {
                val jetzt = prefs.authTokenState.value.orEmpty()
                if (jetzt.isNotBlank()) {
                    response.close()
                    val nachfass = outgoing.newBuilder().header("Authorization", "Bearer $jetzt").build()
                    pruefeServer(nachfass)
                    response = chain.proceed(nachfass)
                    tokenMitgeschickt = true
                }
            }

            // Sitzung abgelaufen (Token ungültig gemacht, Nutzer gelöscht,
            // Server-Neustart mit neuem SESSION_SECRET, …): nur melden, wenn
            // wir überhaupt einen Token mitgeschickt haben und es tatsächlich
            // unser Server war — sonst würde ein 401 vom Login-Versuch selbst
            // (kein Token vorhanden) oder von einem fremden Host (CDN) fälschlich
            // als abgelaufene Sitzung gewertet.
            //
            // `tokenMitgeschickt` statt `token.isNotBlank()`: Nach einem
            // Nachfassen ist der Token draussen gewesen, auch wenn die erste
            // Anfrage ihn nicht trug. Bleibt es dann bei 401, ist es wirklich
            // eine abgelaufene Sitzung.
            if (response.code == 401 && tokenMitgeschickt && isOurServer) {
                sessionExpired.notifyExpired()
            }

            // Passen App und Server nicht zusammen, sagt die App es einmal je
            // Start, statt an fehlenden Feldern stumm zu scheitern.
            if (isOurServer && meldungen != null && !versionGemeldet.get()) {
                ch.brickinventoryapp.util.versionsHinweis(
                    response.header("X-Api-Version")?.toIntOrNull(),
                    response.header("X-Api-Min-App")?.toIntOrNull(),
                )?.let { hinweis ->
                    if (versionGemeldet.compareAndSet(false, true)) {
                        meldungen.fluss.value = ch.brickinventoryapp.util.LanguageManager.localizedContext(ctx)
                            .getString(if (hinweis == ch.brickinventoryapp.util.VersionsHinweis.APP_ZU_ALT)
                                ch.brickinventoryapp.R.string.api_app_zu_alt
                                else ch.brickinventoryapp.R.string.api_server_zu_alt)
                    }
                }
            }

            response
        }
        .connectTimeout(15, TimeUnit.SECONDS)
        // readTimeout ist ein Zwischen-Byte-Timeout, kein Gesamt-Timeout.
        // 60s reicht auch für grosse PDF-Downloads; die PDF-Erzeugung selbst
        // läuft asynchron über Job-Polling und braucht kein langes Timeout mehr.
        .readTimeout(60, TimeUnit.SECONDS)
        .build()
}
