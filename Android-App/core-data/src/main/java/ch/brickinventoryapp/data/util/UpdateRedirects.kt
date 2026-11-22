package ch.brickinventoryapp.data.util

import okhttp3.HttpUrl
import okhttp3.Interceptor
import okhttp3.Response
import java.io.IOException

/** Where the update client may go: GitHub and its storage CDN, only via https on 443. */
internal fun updateTargetAllowed(url: HttpUrl): Boolean =
    url.isHttps && url.port == 443 && (url.host == "github.com" || url.host.endsWith(".githubusercontent.com"))

/**
 * The update client follows redirects itself and only to [allowed]: a mirror outside
 * of GitHub would otherwise learn IP and time of every check. Checked before connecting,
 * hence as an application interceptor with followRedirects(false) (NetworkModule).
 */
internal class UpdateRedirects(private val allowed: (HttpUrl) -> Boolean = ::updateTargetAllowed) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        var request = chain.request()
        repeat(MAX_REDIRECTS + 1) {
            if (!allowed(request.url)) throw IOException("Update-Ziel nicht erlaubt: ${request.url.host}")
            val response = chain.proceed(request)
            val target = response.header("Location")?.takeIf { response.isRedirect }?.let(response.request.url::resolve)
                ?: return response
            response.close()
            request = request.newBuilder().url(target).build()
        }
        throw IOException("Zu viele Umleitungen beim Update")
    }

    private companion object {
        const val MAX_REDIRECTS = 5
    }
}
