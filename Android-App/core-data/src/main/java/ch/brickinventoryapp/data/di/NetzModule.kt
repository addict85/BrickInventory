package ch.brickinventoryapp.data.di

import ch.brickinventoryapp.data.util.UpdateRedirects
import ch.brickinventoryapp.network.util.NetworkPolicy
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Dispatcher
import okhttp3.ResponseBody.Companion.toResponseBody
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import java.io.IOException
import java.util.concurrent.TimeUnit
import javax.inject.Singleton
import okio.Path.Companion.toOkioPath
import ch.brickinventoryapp.data.Redeemer
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.PasswordRequired
import ch.brickinventoryapp.data.RightsSignal
import ch.brickinventoryapp.data.SessionExpiredSignal
import ch.brickinventoryapp.data.TokenSwap
import ch.brickinventoryapp.data.SecondFactorRequired
import ch.brickinventoryapp.data.cache.VorschauSpeicher
import ch.brickinventoryapp.data.cache.WarmUp
import ch.brickinventoryapp.security.StoreCipher
import ch.brickinventoryapp.security.Ablageschluessel
import ch.brickinventoryapp.network.util.ImageHostGuard
import ch.brickinventoryapp.security.EncryptedFileSystem
import ch.brickinventoryapp.security.CertificateQuestion
import ch.brickinventoryapp.network.util.isOwnImageServer
import ch.brickinventoryapp.data.Verbindungsabwurf
import ch.brickinventoryapp.security.SystemRoots

/** OkHttp clients, image loader and Retrofit — everything that goes over the network. */
@Module
@InstallIn(SingletonComponent::class)
internal object NetzModule {

    @Provides
    @Singleton
    @ApiClient
    fun provideApiOkHttpClient(
        @dagger.hilt.android.qualifiers.ApplicationContext context: android.content.Context,
        prefs: Netzablagen,
        sessionExpired: SessionExpiredSignal,
        meldungen: MeldungsKanal,
        frage: CertificateQuestion,
        tausch: TokenSwap,
        rights: RightsSignal,
        pflicht: PasswordRequired,
        factorRequired: SecondFactorRequired,
    ): OkHttpClient =
        buildInterceptorClient(prefs, isApiClient = true, sessionExpired = sessionExpired, ctx = context,
            meldungen = meldungen, frage = frage, rotation = tausch, rights = rights, pflicht = pflicht,
            factorRequired = factorRequired)

    /**
     * The client for the self-update — deliberately bare: server, bearer token
     * and display language are none of GitHub's business, and „never saw it“ is stronger
     * than „holds it back“ on a path over which foreign code gets onto the device.
     * No cache (an APK would displace the thumbnails) and a read timeout
     * for a download, not for a query.
     */
    @Provides
    @Singleton
    @UpdateClient
    fun provideUpdateOkHttpClient(): OkHttpClient =
        OkHttpClient.Builder()
            // Redirects (github.com → *.githubusercontent.com) are followed by the guard itself,
            // only to GitHub via https; OkHttp would otherwise follow them to any host.
            .followRedirects(false)
            .followSslRedirects(false)
            .addInterceptor(UpdateRedirects())
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(120, TimeUnit.SECONDS)
            .build()

    @Provides
    @Singleton
    @ImageClient
    fun provideImageOkHttpClient(
        // Context for the HTTP cache below — the same notation
        // as for provideImageLoader in this file.
        @dagger.hilt.android.qualifiers.ApplicationContext context: android.content.Context,
        prefs: Netzablagen,
        sessionExpired: SessionExpiredSignal,
        vorschau: VorschauSpeicher,
        frage: CertificateQuestion,
        ablage: Ablageschluessel,
    ): OkHttpClient =
        buildInterceptorClient(prefs, isApiClient = false, sessionExpired = sessionExpired, ctx = context, frage = frage)
            .newBuilder()
            // ── Persistent store of the thumbnails ──
            //
            // First in the chain so that the tap sees the end result — the
            // offline fallback below is the inner one. It complements the
            // LRU cache under `cacheDir`, which Android may empty at any time; this
            // store lies under `filesDir` and only cleans up itself (VorschauSpeicher).
            .addInterceptor(vorschauAbgriff(vorschau))
            // Only the own server (util/BildHosts.kt); redirects are checked by
            // the guard itself, OkHttp would otherwise follow them past it.
            .addInterceptor(ImageHostGuard(
                ownServer = { url ->
                    isOwnImageServer(url, prefs.token.serverUrlState.value ?: "", NetworkPolicy.entwicklung)
                },
                basePath = { NetworkPolicy.basePath(prefs.token.serverUrlState.value.orEmpty()).orEmpty() },
            ))
            .followRedirects(false)
            // Throttle image downloads, but not so tightly that tiles starve: this is
            // the app's one ImageLoader. With 3 connections per host tiles waited, Coil
            // cancelled them while scrolling past, and they stayed empty. 6 per host, 12 total
            // protects the API requests and leaves a wall of tiles enough slots.
            .dispatcher(Dispatcher().apply {
                maxRequests = 12
                maxRequestsPerHost = 6
            })
            // HTTP cache for images: conditional requests and the offline fallback
            // need ETag and expiry date. Encrypted like stock and responses, because the
            // images show which sets someone owns.
            .cache(context.cacheDir.resolve("image_http_cache").toOkioPath().let { folder ->
                okhttp3.Cache(
                    EncryptedFileSystem(okio.FileSystem.SYSTEM, StoreCipher { ablage.fuer("bilder") }, "bilder",
                        EncryptedFileSystem.Jitter(folder) { ablage.fuer("namen") }),
                    folder,
                    50L * 1024 * 1024,
                )
            })
            // Offline fallback: if the server is unreachable, the images come from the
            // cache. Tied to the error, not to the connection status — on Wi-Fi the
            // home server can be silent anyway. FORCE_CACHE delivers the copy regardless of
            // its expiry date; without a copy 504 comes and the placeholder.
            .addInterceptor { chain ->
                val req = chain.request()
                try {
                    chain.proceed(req)
                } catch (_: java.io.IOException) {
                    chain.proceed(
                        req.newBuilder()
                            .cacheControl(okhttp3.CacheControl.FORCE_CACHE)
                            .build()
                    )
                }
            }
            .build()
            // Own dispatcher: the cancellation on server switch must know it specifically.
            .also { followsTheServer(prefs, it) }

    /**
     * One ImageLoader for the whole runtime: built in the activity, a second one arose
     * on the same disk cache with every rotation, and the memory cache was
     * empty.
     */
    @Provides
    @Singleton
    fun provideImageLoader(
        @dagger.hilt.android.qualifiers.ApplicationContext context: android.content.Context,
        @ImageClient client: OkHttpClient
    ): coil3.ImageLoader =
        coil3.ImageLoader.Builder(context)
            // ── In Coil 3 the network is a separate component ──
            //
            // Without this fetcher Coil 3 silently loads no images.
            // OkHttpNetworkFetcherFactory(Call.Factory) is a free function;
            // `OkHttpNetworkFetcher.factory` is only the Java view. Via the client,
            // authentication, timeouts and the offline fallback hang on the image path.
            .components { add(coil3.network.okhttp.OkHttpNetworkFetcherFactory(client)) }
            .memoryCache {
                // Builder() without Context in Coil 3; the context moves to
                // maxSizePercent, because only there the device's memory
                // is needed.
                coil3.memory.MemoryCache.Builder()
                    .maxSizePercent(context, 0.15) // 15 % of the app memory
                    .build()
            }
            // No own disk cache: it would hold the same bytes as the client's HTTP cache,
            // but in plaintext. Without this line Coil 3 created its own.
            .diskCache { null }
            // Respecting cache headers (a wrong image should be renewable from the server)
            // is no longer a setting in Coil 3: the only CacheStrategy, DEFAULT, is
            // the default of the factory above. Whether in detail it behaves like
            // respectCacheHeaders(true) can only be checked on a device.
            .build()

    /**
     * Separate client for server-sent events: readTimeout = 0 (infinite),
     * so that the open stream connection is not cut after 60s.
     * pingInterval keeps the connection alive through NAT/proxies.
     */
    @Provides
    @Singleton
    @SseClient
    fun provideSseOkHttpClient(
        @dagger.hilt.android.qualifiers.ApplicationContext context: android.content.Context,
        prefs: Netzablagen,
        sessionExpired: SessionExpiredSignal,
        frage: CertificateQuestion,
        tausch: TokenSwap,
    ): OkHttpClient =
        buildInterceptorClient(prefs, isApiClient = true, sessionExpired = sessionExpired, ctx = context, frage = frage,
            rotation = tausch)
            .newBuilder()
            .readTimeout(0, TimeUnit.SECONDS)
            .pingInterval(20, TimeUnit.SECONDS)
            .build()

    /** For sign-outs that only reach the server later (data/Entwertung.kt). */
    @Provides
    @Singleton
    fun provideRedeemer(
        prefs: Netzablagen,
        frage: CertificateQuestion,
    ): Redeemer =
        Redeemer(buildRedemptionBase(prefs, frage), NetworkPolicy.entwicklung,
            trustFor = jobTrustFactory(prefs.vertrauen))

    /** For the QR sign-in: an `fp` on a system root applies without typing. */
    @Provides
    @Singleton
    fun provideSystemRoots(): SystemRoots = systemRoots()

    // No unqualified OkHttpClient binding: it silently delivered the api client
    // to the image and SSE paths too. Whoever needs a client names @ApiClient,
    // @ImageClient or @SseClient.

    /** After a change of trust: open connections carried the old one. */
    @Provides
    fun provideVerbindungsabwurf(@ApiClient client: OkHttpClient): Verbindungsabwurf =
        Verbindungsabwurf { client.connectionPool.evictAll() }

    @Provides
    @Singleton
    fun provideRetrofit(json: Json, @ApiClient client: OkHttpClient): Retrofit =
        Retrofit.Builder()
            .baseUrl("http://localhost:3000/")
            .client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
}

/**
 * The preview store's tap in the image client: stores successful previews and
 * steps in with them when network and cache deliver nothing.
 */
internal fun vorschauAbgriff(vorschau: VorschauSpeicher): Interceptor = Interceptor { chain ->
    val anfrage = chain.request()
    val adresse = anfrage.url.toString()
    if (!vorschau.isPreview(adresse)) {
        chain.proceed(anfrage)
    } else {
        // No own If-None-Match: OkHttp performs the conditional request itself; a header
        // set by hand would make it bypass its cache. The store fills up
        // on success and steps in only when nothing else works.
        val antwort = try {
            chain.proceed(anfrage)
        } catch (e: java.io.IOException) {
            previewResponse(anfrage, vorschau.lies(adresse)) ?: throw e
        }
        when {
            antwort.isSuccessful -> {
                // peekBody instead of body.bytes(): the body may only be read
                // ONCE, and the caller still needs
                // it. A preview is small enough to take it along
                // on the side.
                val bytes = runCatching {
                    antwort.peekBody(2L * 1024 * 1024).bytes()
                }.getOrNull()
                if (bytes != null && bytes.isNotEmpty()) {
                    // Speculative or used? Only the warmer's requests carry
                    // the tag (VorschauVorwaermer); a warmed image becomes a used one
                    // by itself on the first real call.
                    val speculative = anfrage.tag(
                        WarmUp::class.java
                    ) != null
                    vorschau.schreibe(adresse, bytes, speculative)
                }
                antwort
            }
            // 504 comes from the forced cache further
            // down if nothing lay there. That too is a case
            // for the store.
            antwort.code == 504 ->
                previewResponse(anfrage, vorschau.lies(adresse))
                    ?.also { antwort.close() } ?: antwort
            else -> antwort
        }
    }
}

/**
 * Build a response from stored bytes, or null. Status 200 so that Coil and
 * the HTTP cache treat it like any other; `X-Vorschau-Ablage`
 * shows in the log that it came from the store.
 */
private fun previewResponse(anfrage: okhttp3.Request, bytes: ByteArray?): okhttp3.Response? {
    if (bytes == null || bytes.isEmpty()) return null
    return okhttp3.Response.Builder()
        .request(anfrage)
        .protocol(okhttp3.Protocol.HTTP_1_1)
        .code(200)
        .message("aus der Vorschau-Ablage")
        .header("X-Vorschau-Ablage", "1")
        // no-store: this response already comes from a persistent
        // store. Putting it into the HTTP cache a second time would
        // need space for the same bytes.
        .header("Cache-Control", "no-store")
        .body(bytes.toResponseBody("image/jpeg".toMediaTypeOrNull()))
        .build()
}
