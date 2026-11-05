package ch.brickinventoryapp.util

import ch.brickinventoryapp.di.naechsteUmleitung
import okhttp3.HttpUrl
import okhttp3.Interceptor
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody

/**
 * Der eigene Server für den Bild-Client. localhost nur im Debug-Build ([entwicklung]):
 * Im Release-Build könnten Bild-Adressen aus einer Server-Antwort sonst Dienste
 * auf dem Gerät selbst ansprechen, an der Regel „nur der eigene Server“ vorbei.
 */
internal fun istEigenerBildServer(url: HttpUrl, serverUrl: String, entwicklung: Boolean): Boolean =
    (entwicklung && url.host == "localhost") || NetworkPolicy.isSameOrigin(url, serverUrl)

/**
 * Der Bild-Client spricht nur den eigenen Server: Alle Bildadressen laufen über dessen
 * Proxy (ImageUrls). Ein direkter Weg zu einem CDN gäbe Dritten die IP des Geräts und
 * das Sammlungsinteresse. Umleitungen folgt dieser Wächter selbst (NetzModule).
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

    private fun vorbereitet(r: Request): Request? = r.takeIf { eigenerServer(it.url) }

    private fun gesperrt(r: Request): Response = Response.Builder()
        .request(r).protocol(Protocol.HTTP_1_1).code(403).message("Bild-Host nicht erlaubt")
        .body("".toResponseBody(null))
        .build()

    private companion object {
        const val MAX_UMLEITUNGEN = 3
    }
}
