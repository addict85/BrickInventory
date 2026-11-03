package ch.brickinventoryapp.util

import ch.brickinventoryapp.di.naechsteUmleitung
import okhttp3.HttpUrl
import okhttp3.Interceptor
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody

/** Dieselben Hosts wie ERLAUBTE_BILD_HOSTS der Webapp (src/infra/fremdeAdressen.ts). */
val ERLAUBTE_BILD_HOSTS = setOf(
    "cdn.rebrickable.com", "rebrickable.com",
    "images.brickset.com",
    "www.bricklink.com", "img.bricklink.com",
)

/** Genau ein Host der Liste, über https auf 443; Unterdomänen zählen nicht. */
fun istErlaubterBildHost(url: HttpUrl): Boolean = url.isHttps && url.port == 443 && url.host in ERLAUBTE_BILD_HOSTS

/**
 * Der eigene Server für den Bild-Client. localhost nur im Debug-Build ([entwicklung]):
 * Im Release-Build könnten Bild-Adressen aus einer Server-Antwort sonst Dienste
 * auf dem Gerät selbst ansprechen, an der Liste der erlaubten Hosts vorbei.
 */
fun istEigenerBildServer(url: HttpUrl, serverUrl: String, entwicklung: Boolean): Boolean =
    (entwicklung && url.host == "localhost") || NetworkPolicy.isSameOrigin(url, serverUrl)

/**
 * Wohin der Bild-Client darf: Der eigene Server bekommt die Anfrage unverändert, die
 * Bild-CDNs mit browserähnlicher Kennung (Cloudflare blockt OkHttp sonst), jeder
 * andere Host nichts — auch nicht über eine Umleitung. Darum folgt dieser Wächter
 * Umleitungen selbst; der Client folgt keinen (NetzModule).
 */
class BildHostWaechter(
    /** Pfad des Servers hinter einem Proxy ("" ohne): Nur darunter darf der Token mit umziehen. */
    private val basisPfad: () -> String = { "" },
    private val eigenerServer: (HttpUrl) -> Boolean,
) : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        var anfrage = chain.request()
        repeat(MAX_UMLEITUNGEN + 1) {
            val raus = vorbereitet(anfrage) ?: return gesperrt(anfrage)
            val antwort = chain.proceed(raus)
            val ziel = antwort.header("Location")?.takeIf { antwort.isRedirect }?.let(antwort.request.url::resolve)
                ?: return antwort
            // Köpfe (samt Token) ziehen nur mit, wo auch der ServerWaechter sie hinschickte:
            // gleiche Herkunft und unter dem Basispfad. Sonst teilt sich ein Proxy-Host mit
            // einer fremden Anwendung, und eine Umleitung dorthin trüge den Token hinaus.
            val mitgenommen = if (eigenerServer(raus.url)) naechsteUmleitung(raus, antwort, basisPfad()) else null
            antwort.close()
            anfrage = mitgenommen ?: Request.Builder().url(ziel).build()
        }
        return gesperrt(anfrage)
    }

    private fun vorbereitet(r: Request): Request? = when {
        eigenerServer(r.url) -> r
        istErlaubterBildHost(r.url) -> r.newBuilder()
            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
                "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .header("Referer", "https://rebrickable.com/")
            // Kein image/avif: Nicht jedes Gerät hat einen AV1-Decoder.
            .header("Accept", "image/webp,image/apng,image/*,*/*;q=0.8")
            .build()
        else -> null
    }

    private fun gesperrt(r: Request): Response = Response.Builder()
        .request(r).protocol(Protocol.HTTP_1_1).code(403).message("Bild-Host nicht erlaubt")
        .body("".toResponseBody(null))
        .build()

    private companion object {
        const val MAX_UMLEITUNGEN = 3
    }
}
