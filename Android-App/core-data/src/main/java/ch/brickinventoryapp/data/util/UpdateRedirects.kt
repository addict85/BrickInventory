package ch.brickinventoryapp.data.util

import okhttp3.HttpUrl
import okhttp3.Interceptor
import okhttp3.Response
import java.io.IOException

/** Where the update client may go: GitHub and its storage CDN, only via https on 443. */
internal fun updateTargetAllowed(url: HttpUrl): Boolean =
    url.isHttps && url.port == 443 && (url.host == "github.com" || url.host.endsWith(".githubusercontent.com"))

/**
 * The update client follows redirects itself and only to [erlaubt]: a mirror outside
 * of GitHub would otherwise learn IP and time of every check. Checked before connecting,
 * hence as an application interceptor with followRedirects(false) (NetzModule).
 */
internal class UpdateRedirects(private val erlaubt: (HttpUrl) -> Boolean = ::updateTargetAllowed) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        var anfrage = chain.request()
        repeat(MAX_REDIRECTS + 1) {
            if (!erlaubt(anfrage.url)) throw IOException("Update-Ziel nicht erlaubt: ${anfrage.url.host}")
            val antwort = chain.proceed(anfrage)
            val ziel = antwort.header("Location")?.takeIf { antwort.isRedirect }?.let(antwort.request.url::resolve)
                ?: return antwort
            antwort.close()
            anfrage = anfrage.newBuilder().url(ziel).build()
        }
        throw IOException("Zu viele Umleitungen beim Update")
    }

    private companion object {
        const val MAX_REDIRECTS = 5
    }
}
