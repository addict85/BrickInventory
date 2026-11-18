package ch.brickinventoryapp.netz.util

import ch.brickinventoryapp.netz.di.naechsteUmleitung
import okhttp3.HttpUrl
import okhttp3.Interceptor
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody

/**
 * Our own server for the image client. localhost only in a debug build ([entwicklung]):
 * in a release build, image addresses from a server response could otherwise reach
 * services on the device itself, bypassing the "only our own server" rule.
 */
fun istEigenerBildServer(url: HttpUrl, serverUrl: String, entwicklung: Boolean): Boolean =
    (entwicklung && url.host == "localhost") || NetworkPolicy.isSameOrigin(url, serverUrl)

/**
 * The image client only talks to our own server: every image address runs through its
 * proxy (ImageUrls). A direct path to a CDN would give third parties the device's IP
 * and the collecting interest. This guard follows redirects itself (NetzModule).
 */
class BildHostWaechter(
    /** The server's path behind a proxy ("" without): only under it may the token move along. */
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
            // Headers (the token included) move along only where the ServerWaechter would
            // also have sent them: same origin and under the base path. Otherwise a proxy
            // host is shared with a foreign application, and a redirect there would carry the token out.
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
