package ch.brickinventoryapp.data.util

import okhttp3.HttpUrl
import okhttp3.Interceptor
import okhttp3.Response
import java.io.IOException

/** Wohin der Update-Client darf: GitHub und sein Ablage-CDN, nur über https auf 443. */
internal fun updateTargetAllowed(url: HttpUrl): Boolean =
    url.isHttps && url.port == 443 && (url.host == "github.com" || url.host.endsWith(".githubusercontent.com"))

/**
 * Der Update-Client folgt Umleitungen selbst und nur zu [erlaubt]: Ein Spiegel ausserhalb
 * von GitHub erführe sonst IP und Zeitpunkt jeder Prüfung. Geprüft wird vor dem Verbinden,
 * darum als Anwendungs-Interceptor bei followRedirects(false) (NetzModule).
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
