package ch.brickinventoryapp.di

import ch.brickinventoryapp.BuildConfig
import ch.brickinventoryapp.data.PreferencesManager
import ch.brickinventoryapp.data.api.BrickApiService
import ch.brickinventoryapp.util.KeystoreTokenTresor
import ch.brickinventoryapp.util.NetworkPolicy
import ch.brickinventoryapp.util.TokenVerschluesselung
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Dispatcher
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import java.io.IOException
import java.util.concurrent.TimeUnit
import javax.inject.Named
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object AppModule {

    /**
     * Die Token-Verschlüsselung als Schnittstelle bereitstellen, nicht als
     * konkrete Klasse (Nachtrag 155).
     *
     * Grund: Die Umsetzung braucht den Android-Keystore und läuft deshalb NUR
     * auf einem Gerät. Wäre PreferencesManager fest daran gebunden, liesse
     * sich seine Übernahme-Logik auf der JVM überhaupt nicht prüfen — und
     * genau die entscheidet, ob bestehende Installationen beim Update
     * angemeldet bleiben.
     */
    @Provides
    @Singleton
    fun provideTokenVerschluesselung(): TokenVerschluesselung = KeystoreTokenTresor()

    @Provides
    @Singleton
    fun provideJson() = Json {
        ignoreUnknownKeys = true
        isLenient = true
        encodeDefaults = true
        coerceInputValues = true  // handles type mismatches (e.g. "f" for Int field)
    }

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
    private fun buildInterceptorClient(
        prefs: PreferencesManager,
        isApiClient: Boolean,
        sessionExpired: ch.brickinventoryapp.data.SessionExpiredSignal,
        /** Nur, um die Anzeigesprache aus den Ressourcen zu lesen (Nachtrag 130). */
        ctx: android.content.Context,
    ): OkHttpClient {
        return OkHttpClient.Builder()
            .apply {
                // Vorher nur für den API-Client (isApiClient) protokolliert.
                // Genau deshalb zeigte das zuletzt gelieferte Logcat KEINE
                // einzige Bildanfrage — nicht weil keine gemacht wurden,
                // sondern weil der Bild-Client (isApiClient = false, von Coil
                // benutzt) gar keinen Logging-Interceptor hatte. Das Fehlen
                // von Bildanfragen im Log war also kein Befund, sondern eine
                // Lücke in der Beobachtbarkeit selbst.
                if (BuildConfig.DEBUG) {
                    addInterceptor(HttpLoggingInterceptor().apply {
                        level = HttpLoggingInterceptor.Level.BASIC
                    })
                }
            }
            .addInterceptor { chain ->
                val original = chain.request()
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
                val isOurServer = (serverUrl.isNotBlank() && NetworkPolicy.isSameOrigin(finalUrl, serverUrl)) ||
                    (finalUrl.host == "localhost" && finalUrl.port == 3000)
                if (token.isNotBlank() && isOurServer && original.header("Authorization") == null) {
                    reqBuilder.header("Authorization", "Bearer $token")
                }

                // ── Und in welcher Sprache soll der Server antworten? ────────
                //
                // Der Server hat seine Fehlermeldungen seit Nachtrag 130 in
                // beiden Sprachen (utils/fehlerTexte.ts) und nimmt die aus
                // diesem Kopf. Vorher waren alle achtzig deutsch — auch in
                // einer vollstaendig englischen Oberflaeche.
                //
                // Die Kennung kommt aus den RESSOURCEN (lang_code), nicht aus
                // einer eigenen Ermittlung: So sagt sie genau das, was die
                // Oberflaeche gerade zeigt, samt der per-App-Sprache, die der
                // Nutzer in den Einstellungen waehlen kann.
                //
                // Nur an unseren Server: Ein Bildabruf bei BrickLink hat mit
                // unserer Anzeigesprache nichts zu tun.
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
                if (!NetworkPolicy.isCleartextAllowed(outgoing.url)) {
                    throw IOException(
                        "Unverschlüsselte Verbindung zu ${outgoing.url.host} abgebrochen — " +
                        "bitte https verwenden (oder eine Adresse im lokalen Netz)."
                    )
                }

                val response = chain.proceed(outgoing)

                // Sitzung abgelaufen (Token ungültig gemacht, Nutzer gelöscht,
                // Server-Neustart mit neuem SESSION_SECRET, …): nur melden, wenn
                // wir überhaupt einen Token mitgeschickt haben und es tatsächlich
                // unser Server war — sonst würde ein 401 vom Login-Versuch selbst
                // (kein Token vorhanden) oder von einem fremden Host (CDN) fälschlich
                // als abgelaufene Sitzung gewertet.
                if (response.code == 401 && token.isNotBlank() && isOurServer) {
                    sessionExpired.notifyExpired()
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

    @Provides
    @Singleton
    @Named("api")
    fun provideApiOkHttpClient(
        @dagger.hilt.android.qualifiers.ApplicationContext context: android.content.Context,
        prefs: PreferencesManager,
        sessionExpired: ch.brickinventoryapp.data.SessionExpiredSignal
    ): OkHttpClient =
        buildInterceptorClient(prefs, isApiClient = true, sessionExpired = sessionExpired, ctx = context)

    @Provides
    @Singleton
    @Named("image")
    fun provideImageOkHttpClient(
        // Context für den HTTP-Zwischenspeicher unten — dieselbe Schreibweise
        // wie bei provideImageLoader in dieser Datei.
        @dagger.hilt.android.qualifiers.ApplicationContext context: android.content.Context,
        prefs: PreferencesManager,
        sessionExpired: ch.brickinventoryapp.data.SessionExpiredSignal
    ): OkHttpClient =
        buildInterceptorClient(prefs, isApiClient = false, sessionExpired = sessionExpired, ctx = context)
            .newBuilder()
            // Browser-ähnliche Kennung für Bildanfragen an FREMDE Hosts
            // (Rebrickable-CDN & Co.), nicht an den eigenen Server.
            //
            // OkHttps Standard-User-Agent ("okhttp/4.x") identifiziert die
            // Anfrage eindeutig als Nicht-Browser-Client. Cloudflare — es
            // steht vor Rebrickables CDN, siehe die Recherche zum
            // Bild-Proxy der Webapp in dieser Sitzung — kann solche
            // Anfragen dauerhaft blockieren oder mit einer HTML-Challenge
            // statt des Bildes beantworten, die Coil nicht als Bild
            // entpacken kann. Ein Wiederholversuch hilft dagegen NICHT,
            // weil die Sperre nicht transient ist, sondern an jeder
            // Anfrage neu greift — was genau zu der Beobachtung passt,
            // dass weder die Warteschlangen-Verbreiterung noch der
            // Wiederholversuch etwas verändert haben.
            //
            // Der eigene Server bekommt weiterhin keine besonderen
            // Kopfzeilen — dort ist es unnötig, und der schlanke
            // OkHttp-Header stört dort nicht.
            .addInterceptor { chain ->
                val req = chain.request()
                val host = req.url.host
                val isOwnServer = host == "localhost" ||
                    NetworkPolicy.isSameOrigin(req.url, prefs.serverUrlState.value ?: "")
                if (isOwnServer) {
                    chain.proceed(req)
                } else {
                    chain.proceed(
                        req.newBuilder()
                            .header(
                                "User-Agent",
                                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
                                "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                            )
                            .header("Referer", "https://rebrickable.com/")
                            // KEIN "image/avif" hier: Das war der Fehler dieser
                            // Zeile in der vorigen Fassung. Mit avif in Accept
                            // meldet der Client dem CDN, AVIF verarbeiten zu
                            // können — Rebrickable/Cloudflare antwortete
                            // daraufhin mit einer AVIF-Datei statt JPEG. Auf
                            // Android übernimmt ImageDecoder das Dekodieren
                            // nativer Formate; nicht jedes Gerät hat trotz
                            // ausreichendem API-Level tatsächlich einen
                            // AV1-Decoder, und genau das führt zu
                            // "Failed to create image decoder with message
                            // 'unimplemented'" statt zu einem angezeigten Bild.
                            // JPEG/PNG/WebP sind auf jedem Android-Gerät
                            // zuverlässig dekodierbar; das reicht hier.
                            .header("Accept", "image/webp,image/apng,image/*,*/*;q=0.8")
                            .build()
                    )
                }
            }
            // Bild-Downloads drosseln, aber nicht so eng, dass Kacheln
            // verhungern.
            //
            // Dieser OkHttpClient ist die EINE ImageLoader-Instanz der ganzen
            // App (siehe MainActivity) — die Drosselung für den Katalog
            // (bis zu 60 CDN-Bilder pro Seite, auf langsamen Verbindungen
            // sonst blockierte API-Calls) traf dadurch auch die Galerie mit.
            // Bei 3 gleichzeitigen Verbindungen pro Host standen die übrigen
            // Kacheln einer Seite in einer Warteschlange; scrollt man daran
            // vorbei, bricht Coil die wartende Anfrage ab, und die Kachel
            // bleibt dauerhaft leer — genau das gemeldete „teilweise nicht
            // geladen". Dieselbe Fehlerklasse wie beim Server-seitigen
            // Bild-Proxy in dieser Sitzung: eine zu enge Warteschlange lässt
            // spät dran kommende Anfragen verhungern, nicht scheitern.
            //
            // 6 statt 3, 12 statt 6 gesamt: immer noch deutlich unter den
            // OkHttp-Standardwerten (5/64), schützt die API-Anfragen auf
            // langsamen Verbindungen weiterhin, lässt einer üblichen
            // Kachelwand aber genug gleichzeitige Slots.
            .dispatcher(Dispatcher().apply {
                maxRequests = 12
                maxRequestsPerHost = 6
            })
            // HTTP-Zwischenspeicher für Bilder (Nachtrag 37). Coil hat einen
            // eigenen Plattencache, der aber nur die fertig geladenen Bytes
            // hält — für eine BEDINGTE Anfrage und für den Offline-Rückfall
            // braucht es die HTTP-Ebene mit ETag und Ablaufdatum.
            .cache(okhttp3.Cache(context.cacheDir.resolve("image_http_cache"), 50L * 1024 * 1024))
            // Offline-Rückfall: „Wenn der Server nicht erreichbar ist, sollen
            // alle aus dem Cache kommen" (Marcos Anforderung).
            //
            // Bewusst am FEHLER festgemacht statt am Verbindungsstatus des
            // Geräts: Ein Gerät kann mit einem WLAN verbunden sein, in dem der
            // Heimserver trotzdem nicht antwortet (unterwegs, VPN aus, Server
            // neu startend). Beobachtet wird also, was tatsächlich passiert —
            // eine IOException —, nicht was das System über die Verbindung
            // behauptet.
            //
            // FORCE_CACHE liefert die gespeicherte Kopie ohne jede
            // Netzwerkanfrage und OHNE Rücksicht auf ihr Ablaufdatum. Gibt es
            // keine Kopie, antwortet OkHttp mit 504 — dann greift der
            // Platzhalter wie bisher.
            .addInterceptor { chain ->
                val req = chain.request()
                try {
                    chain.proceed(req)
                } catch (e: java.io.IOException) {
                    chain.proceed(
                        req.newBuilder()
                            .cacheControl(okhttp3.CacheControl.FORCE_CACHE)
                            .build()
                    )
                }
            }
            .build()

    /**
     * Eine einzige ImageLoader-Instanz für die ganze App-Laufzeit statt einer
     * pro Activity-Erzeugung.
     *
     * Vorher baute MainActivity.onCreate() den ImageLoader lokal — bei jeder
     * Konfigurationsänderung (Bildschirmdrehung), die die Activity neu
     * erzeugt, entstand ein zweiter ImageLoader auf demselben Disk-Cache-
     * Verzeichnis, während der alte eventuell noch offene Handles hielt, und
     * der In-Memory-Cache war jedes Mal wieder leer — alle sichtbaren
     * Thumbnails wurden neu dekodiert. Als Hilt-Singleton bleibt Cache und
     * Verzeichnis über die gesamte Prozesslaufzeit stabil.
     */
    @Provides
    @Singleton
    fun provideImageLoader(
        @dagger.hilt.android.qualifiers.ApplicationContext context: android.content.Context,
        @Named("image") client: OkHttpClient
    ): coil.ImageLoader =
        coil.ImageLoader.Builder(context)
            .okHttpClient(client)
            .memoryCache {
                coil.memory.MemoryCache.Builder(context)
                    .maxSizePercent(0.15) // use 15% of app memory for image cache
                    .build()
            }
            .diskCache {
                coil.disk.DiskCache.Builder()
                    .directory(context.cacheDir.resolve("image_cache"))
                    .maxSizeBytes(50L * 1024 * 1024) // 50 MB disk cache
                    .build()
            }
            // respectCacheHeaders(true) — Nachtrag 37, Marcos Anforderung:
            // „Wenn ein falsches Bild heruntergeladen wurde, soll geprüft
            // werden, ob ein neues auf dem Server vorhanden ist."
            //
            // Vorher stand hier false mit der Begründung „auch dann
            // zwischenspeichern, wenn der Server no-cache schickt". Die Folge
            // war die andere Hälfte davon: Coil lieferte ein einmal geladenes
            // Bild AUF IMMER aus seinem Plattencache und fragte nie wieder
            // nach — ein falsches oder veraltetes Bild liess sich nur noch
            // durch Löschen der App-Daten beseitigen.
            //
            // Mit true stellt Coil eine bedingte Anfrage (If-None-Match mit
            // dem ETag). Unverändert → 304 ohne Rumpf, die vorhandene Kopie
            // wird weiterverwendet; geändert → neue Bytes. Die Sorge von
            // damals trägt der Interceptor unten: Ist der Server nicht
            // erreichbar, kommt alles aus dem Cache.
            .respectCacheHeaders(true)
            .build()

    /**
     * Separater Client für Server-Sent-Events: readTimeout = 0 (unendlich),
     * damit die offene Stream-Verbindung nicht nach 60s gekappt wird.
     * pingInterval hält die Verbindung durch NAT/Proxies am Leben.
     */
    @Provides
    @Singleton
    @Named("sse")
    fun provideSseOkHttpClient(
        @dagger.hilt.android.qualifiers.ApplicationContext context: android.content.Context,
        prefs: PreferencesManager,
        sessionExpired: ch.brickinventoryapp.data.SessionExpiredSignal
    ): OkHttpClient =
        buildInterceptorClient(prefs, isApiClient = true, sessionExpired = sessionExpired, ctx = context)
            .newBuilder()
            .readTimeout(0, TimeUnit.SECONDS)
            .pingInterval(20, TimeUnit.SECONDS)
            .build()

    // Kein unqualifiziertes OkHttpClient-Binding mehr: Es hat still den
    // api-Client (60s readTimeout, kein Dispatcher-Limit) an jeden ausgeliefert,
    // der ein OkHttpClient injiziert hat — inklusive der Bild- und SSE-Pfade,
    // für die es eigene, bewusst anders konfigurierte Clients gibt.
    // Konsumenten geben ihren Qualifier jetzt explizit an: @Named("api"),
    // @Named("image") oder @Named("sse").

    @Provides
    @Singleton
    fun provideRetrofit(json: Json, @Named("api") client: OkHttpClient): Retrofit =
        Retrofit.Builder()
            .baseUrl("http://localhost:3000/")
            .client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()

    @Provides
    @Singleton
    fun provideApiService(retrofit: Retrofit): BrickApiService =
        retrofit.create(BrickApiService::class.java)
}
