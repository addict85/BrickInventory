package ch.brickinventoryapp.data.di

import ch.brickinventoryapp.data.util.UpdateUmleitungen
import ch.brickinventoryapp.netz.util.NetworkPolicy
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
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import java.io.IOException
import java.util.concurrent.TimeUnit
import javax.inject.Singleton
import okio.Path.Companion.toOkioPath
import ch.brickinventoryapp.data.Entwerter
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.PasswortPflicht
import ch.brickinventoryapp.data.RechteSignal
import ch.brickinventoryapp.data.SessionExpiredSignal
import ch.brickinventoryapp.data.TokenTausch
import ch.brickinventoryapp.data.ZweiterFaktorPflicht
import ch.brickinventoryapp.data.cache.VorschauSpeicher
import ch.brickinventoryapp.data.cache.Vorwaermung
import ch.brickinventoryapp.data.util.AblageChiffre
import ch.brickinventoryapp.data.util.Ablageschluessel
import ch.brickinventoryapp.netz.util.BildHostWaechter
import ch.brickinventoryapp.data.util.VerschluesseltesDateisystem
import ch.brickinventoryapp.data.util.ZertifikatsFrage
import ch.brickinventoryapp.netz.util.istEigenerBildServer
import ch.brickinventoryapp.data.Verbindungsabwurf
import ch.brickinventoryapp.data.util.SystemWurzeln

/** OkHttp-Clients, Bildlader und Retrofit — alles, was über das Netz geht. */
@Module
@InstallIn(SingletonComponent::class)
object NetzModule {

    @Provides
    @Singleton
    @ApiClient
    fun provideApiOkHttpClient(
        @dagger.hilt.android.qualifiers.ApplicationContext context: android.content.Context,
        prefs: Netzablagen,
        sessionExpired: SessionExpiredSignal,
        meldungen: MeldungsKanal,
        frage: ZertifikatsFrage,
        tausch: TokenTausch,
        rechte: RechteSignal,
        pflicht: PasswortPflicht,
        faktorPflicht: ZweiterFaktorPflicht,
    ): OkHttpClient =
        buildInterceptorClient(prefs, isApiClient = true, sessionExpired = sessionExpired, ctx = context,
            meldungen = meldungen, frage = frage, rotation = tausch, rechte = rechte, pflicht = pflicht,
            faktorPflicht = faktorPflicht)

    /**
     * Der Client für die Selbstaktualisierung — bewusst blank: Server, Bearer-Token
     * und Anzeigesprache gehen GitHub nichts an, und „hat ihn nie gesehen“ ist stärker
     * als „hält ihn zurück“ auf einem Weg, über den fremder Code aufs Gerät kommt.
     * Kein Zwischenspeicher (ein APK verdrängte die Vorschauen) und ein Lesezeitlimit
     * für einen Download, nicht für eine Abfrage.
     */
    @Provides
    @Singleton
    @UpdateClient
    fun provideUpdateOkHttpClient(): OkHttpClient =
        OkHttpClient.Builder()
            // Umleitungen (github.com → *.githubusercontent.com) folgt der Wächter selbst,
            // nur zu GitHub über https; OkHttp folgte ihnen sonst zu jedem Host.
            .followRedirects(false)
            .followSslRedirects(false)
            .addInterceptor(UpdateUmleitungen())
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(120, TimeUnit.SECONDS)
            .build()

    /**
     * Aus abgelegten Bytes eine Antwort bauen, oder null. Status 200, damit Coil und
     * der HTTP-Zwischenspeicher sie wie jede andere behandeln; `X-Vorschau-Ablage`
     * zeigt im Protokoll, dass sie aus der Ablage kam.
     */
    private fun vorschauAntwort(anfrage: okhttp3.Request, bytes: ByteArray?): okhttp3.Response? {
        if (bytes == null || bytes.isEmpty()) return null
        return okhttp3.Response.Builder()
            .request(anfrage)
            .protocol(okhttp3.Protocol.HTTP_1_1)
            .code(200)
            .message("aus der Vorschau-Ablage")
            .header("X-Vorschau-Ablage", "1")
            // no-store: Diese Antwort stammt bereits aus einer dauerhaften
            // Ablage. Sie ein zweites Mal in den HTTP-Zwischenspeicher zu
            // legen brauchte Platz fuer dieselben Bytes.
            .header("Cache-Control", "no-store")
            .body(bytes.toResponseBody("image/jpeg".toMediaTypeOrNull()))
            .build()
    }

    @Provides
    @Singleton
    @BildClient
    fun provideImageOkHttpClient(
        // Context für den HTTP-Zwischenspeicher unten — dieselbe Schreibweise
        // wie bei provideImageLoader in dieser Datei.
        @dagger.hilt.android.qualifiers.ApplicationContext context: android.content.Context,
        prefs: Netzablagen,
        sessionExpired: SessionExpiredSignal,
        vorschau: VorschauSpeicher,
        frage: ZertifikatsFrage,
        ablage: Ablageschluessel,
    ): OkHttpClient =
        buildInterceptorClient(prefs, isApiClient = false, sessionExpired = sessionExpired, ctx = context, frage = frage)
            .newBuilder()
            // ── Dauerhafte Ablage der Vorschaubilder ──
            //
            // Zuerst in der Kette, damit der Abgriff das Endergebnis sieht — der
            // Offline-Rückfall unten ist der innere. Er ergänzt den
            // LRU-Zwischenspeicher unter `cacheDir`, den Android jederzeit leeren darf; diese
            // Ablage liegt unter `filesDir` und räumt nur selbst (VorschauSpeicher).
            .addInterceptor { chain ->
                val anfrage = chain.request()
                val adresse = anfrage.url.toString()
                if (!vorschau.istVorschau(adresse)) {
                    chain.proceed(anfrage)
                } else {
                    // Kein eigenes If-None-Match: OkHttp führt die bedingte Anfrage selbst; ein von
                    // Hand gesetzter Kopf liesse es seinen Cache übergehen. Die Ablage füllt sich
                    // bei Erfolg und springt nur ein, wenn nichts mehr geht.
                    val antwort = try {
                        chain.proceed(anfrage)
                    } catch (e: java.io.IOException) {
                        vorschauAntwort(anfrage, vorschau.lies(adresse)) ?: throw e
                    }
                    when {
                        antwort.isSuccessful -> {
                            // peekBody statt body.bytes(): Der Rumpf darf nur
                            // EINMAL gelesen werden, und der Aufrufer braucht
                            // ihn noch. Eine Vorschau ist klein genug, um sie
                            // nebenbei mitzunehmen.
                            val bytes = runCatching {
                                antwort.peekBody(2L * 1024 * 1024).bytes()
                            }.getOrNull()
                            if (bytes != null && bytes.isNotEmpty()) {
                                // Spekulativ oder gebraucht? Nur die Anfragen des Vorwärmers tragen
                                // das Tag (VorschauVorwaermer); ein vorgewärmtes Bild wird beim
                                // ersten echten Aufruf von selbst zu einem gebrauchten.
                                val spekulativ = anfrage.tag(
                                    Vorwaermung::class.java
                                ) != null
                                vorschau.schreibe(adresse, bytes, spekulativ)
                            }
                            antwort
                        }
                        // 504 kommt vom erzwungenen Zwischenspeicher weiter
                        // unten, wenn dort nichts lag. Auch das ist ein Fall
                        // fuer die Ablage.
                        antwort.code == 504 ->
                            vorschauAntwort(anfrage, vorschau.lies(adresse))
                                ?.also { antwort.close() } ?: antwort
                        else -> antwort
                    }
                }
            }
            // Nur der eigene Server (util/BildHosts.kt); Umleitungen prüft
            // der Wächter selbst, OkHttp folgte ihnen sonst an ihm vorbei.
            .addInterceptor(BildHostWaechter(
                eigenerServer = { url ->
                    istEigenerBildServer(url, prefs.token.serverUrlState.value ?: "", NetworkPolicy.entwicklung)
                },
                basisPfad = { NetworkPolicy.basisPfad(prefs.token.serverUrlState.value.orEmpty()).orEmpty() },
            ))
            .followRedirects(false)
            // Bild-Downloads drosseln, aber nicht so eng, dass Kacheln verhungern: Dies ist
            // der eine ImageLoader der App. Bei 3 Verbindungen je Host warteten Kacheln, Coil
            // brach sie beim Vorbeirollen ab, und sie blieben leer. 6 je Host, 12 gesamt
            // schützt die API-Anfragen und lässt einer Kachelwand genug Plätze.
            .dispatcher(Dispatcher().apply {
                maxRequests = 12
                maxRequestsPerHost = 6
            })
            // HTTP-Zwischenspeicher für Bilder: Für bedingte Anfragen und den Offline-Rückfall
            // braucht es ETag und Ablaufdatum. Verschlüsselt wie Bestand und Antworten, denn die
            // Bilder zeigen, welche Sets jemand besitzt.
            .cache(okhttp3.Cache(
                VerschluesseltesDateisystem(
                    okio.FileSystem.SYSTEM, AblageChiffre { ablage.fuer("bilder") }, "bilder"),
                context.cacheDir.resolve("image_http_cache").toOkioPath(),
                50L * 1024 * 1024,
            ))
            // Offline-Rückfall: Ist der Server nicht erreichbar, kommen die Bilder aus dem
            // Cache. Am Fehler festgemacht, nicht am Verbindungsstatus — im WLAN kann der
            // Heimserver trotzdem schweigen. FORCE_CACHE liefert die Kopie ohne Rücksicht auf
            // ihr Ablaufdatum; ohne Kopie kommt 504 und der Platzhalter.
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
            // Eigener Dispatcher: Der Abbruch beim Serverwechsel muss ihn eigens kennen.
            .also { folgtDemServer(prefs, it) }

    /**
     * Ein ImageLoader für die ganze Laufzeit: In der Activity gebaut, entstand bei
     * jeder Drehung ein zweiter auf demselben Plattencache, und der Speicher-Cache war
     * leer.
     */
    @Provides
    @Singleton
    fun provideImageLoader(
        @dagger.hilt.android.qualifiers.ApplicationContext context: android.content.Context,
        @BildClient client: OkHttpClient
    ): coil3.ImageLoader =
        coil3.ImageLoader.Builder(context)
            // ── Das Netz ist in Coil 3 ein eigenes Bauteil ──
            //
            // Ohne diesen Fetcher lädt Coil 3 stumm keine Bilder.
            // OkHttpNetworkFetcherFactory(Call.Factory) ist eine freie Funktion;
            // `OkHttpNetworkFetcher.factory` ist nur die Java-Sicht. Über den Client hängen
            // Authentifizierung, Zeitgrenzen und der Offline-Rückfall am Bildweg.
            .components { add(coil3.network.okhttp.OkHttpNetworkFetcherFactory(client)) }
            .memoryCache {
                // Builder() ohne Context in Coil 3; der Context wandert an
                // maxSizePercent, weil nur dort der Speicher des Geraets
                // gebraucht wird.
                coil3.memory.MemoryCache.Builder()
                    .maxSizePercent(context, 0.15) // 15 % des App-Speichers
                    .build()
            }
            // Kein eigener Plattencache: Er hielte dieselben Bytes wie der HTTP-Zwischenspeicher
            // des Clients, aber im Klartext. Ohne diese Zeile legte Coil 3 seinen eigenen an.
            .diskCache { null }
            // Cache-Köpfe beachten (ein falsches Bild soll sich vom Server erneuern lassen)
            // ist in Coil 3 keine Einstellung mehr: Die einzige CacheStrategy, DEFAULT, ist
            // die Vorgabe der Fabrik oben. Ob sie sich im Einzelnen wie
            // respectCacheHeaders(true) verhält, ist nur auf einem Gerät zu prüfen.
            .build()

    /**
     * Separater Client für Server-Sent-Events: readTimeout = 0 (unendlich),
     * damit die offene Stream-Verbindung nicht nach 60s gekappt wird.
     * pingInterval hält die Verbindung durch NAT/Proxies am Leben.
     */
    @Provides
    @Singleton
    @SseClient
    fun provideSseOkHttpClient(
        @dagger.hilt.android.qualifiers.ApplicationContext context: android.content.Context,
        prefs: Netzablagen,
        sessionExpired: SessionExpiredSignal,
        frage: ZertifikatsFrage,
        tausch: TokenTausch,
    ): OkHttpClient =
        buildInterceptorClient(prefs, isApiClient = true, sessionExpired = sessionExpired, ctx = context, frage = frage,
            rotation = tausch)
            .newBuilder()
            .readTimeout(0, TimeUnit.SECONDS)
            .pingInterval(20, TimeUnit.SECONDS)
            .build()

    /** Für Abmeldungen, die erst später den Server erreichen (data/Entwertung.kt). */
    @Provides
    @Singleton
    fun provideEntwerter(
        prefs: Netzablagen,
        frage: ZertifikatsFrage,
    ): Entwerter =
        Entwerter(buildEntwertungsBasis(prefs, frage), NetworkPolicy.entwicklung,
            vertrauenFuer = auftragsVertrauenFabrik(prefs.vertrauen))

    /** Für die QR-Anmeldung: Ein `fp` auf eine System-Wurzel gilt ohne Abtippen. */
    @Provides
    @Singleton
    fun provideSystemWurzeln(): SystemWurzeln = systemWurzeln()

    // Kein unqualifiziertes OkHttpClient-Binding: Es lieferte still den api-Client
    // auch an Bild- und SSE-Wege aus. Wer einen Client braucht, nennt @ApiClient,
    // @BildClient oder @SseClient.

    /** Nach einer Änderung des Vertrauens: Offene Verbindungen trugen das alte. */
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
