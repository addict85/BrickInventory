package ch.brickinventoryapp.network.util

import ch.brickinventoryapp.network.di.nextRedirect
import okhttp3.HttpUrl
import okhttp3.Interceptor
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody

/**
 * Our own server for the image client. localhost only in a debug build ([development]):
 * in a release build, image addresses from a server response could otherwise reach
 * services on the device itself, bypassing the "only our own server" rule.
 */
fun isOwnImageServer(url: HttpUrl, serverUrl: String, development: Boolean): Boolean =
    (development && url.host == "localhost") || NetworkPolicy.isSameOrigin(url, serverUrl)

/**
 * The image client only talks to our own server: every image address runs through its
 * proxy (ImageUrls). A direct path to a CDN would give third parties the device's IP
 * and the collecting interest. This guard follows redirects itself (NetworkModule).
 */
class ImageHostGuard(
    /** The server's path behind a proxy ("" without): only under it may the token move along. */
    private val basePath: () -> String = { "" },
    private val ownServer: (HttpUrl) -> Boolean,
) : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        var request = chain.request()
        repeat(MAX_REDIRECTS + 1) {
            val out = prepared(request) ?: return locked(request)
            val response = chain.proceed(out)
            val target = response.header("Location")?.takeIf { response.isRedirect }?.let(response.request.url::resolve)
                ?: return response
            // Headers (the token included) move along only where the ServerGuard would
            // also have sent them: same origin and under the base path. Otherwise a proxy
            // host is shared with a foreign application, and a redirect there would carry the token out.
            val carriedOver = if (ownServer(out.url)) nextRedirect(out, response, basePath()) else null
            response.close()
            request = carriedOver ?: Request.Builder().url(target).build()
        }
        return locked(request)
    }

    private fun prepared(r: Request): Request? = r.takeIf { ownServer(it.url) }

    private fun locked(r: Request): Response = Response.Builder()
        .request(r).protocol(Protocol.HTTP_1_1).code(403).message("Bild-Host nicht erlaubt")
        .body("".toResponseBody(null))
        .build()

    private companion object {
        const val MAX_REDIRECTS = 3
    }
}
