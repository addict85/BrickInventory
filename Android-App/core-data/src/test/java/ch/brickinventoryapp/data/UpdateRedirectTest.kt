package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.util.UpdateRedirects
import ch.brickinventoryapp.data.util.updateTargetAllowed
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.IOException

/**
 * Der Update-Client folgt Umleitungen nur zu GitHub über https: Ein
 * fremdes Umleitungsziel wird nicht einmal verbunden. Mit Testservern statt GitHub;
 * die Regel für GitHub selbst prüft der letzte Fall.
 *
 * Gegenproben (05.11.2026, gemessen mit kotlinc lokal):
 *   A  in UpdateRedirects die Prüfung `erlaubt(anfrage.url)` entfernt
 *      (gegenproben/update-umleitung-ueberall.patch) → rot „eine Umleitung auf einen fremden Host …“
 *   B  updateTargetAllowed() mit `url.host.endsWith("githubusercontent.com")` ohne Punkt →
 *      rot „nur GitHub und sein CDN …“
 *   C  MAX_REDIRECTS = 1 (Gegenprobe vom 12.11.2026) → rot „der feste Link ueber
 *      releases-latest …“ (IOException „Zu viele Umleitungen“)
 */
class UpdateRedirectTest {

    private val start = MockWebServer().apply { start() }
    private val ziel = MockWebServer().apply { start() }
    private val fremd = MockWebServer().apply { start() }

    @After
    fun zu() = listOf(start, ziel, fremd).forEach { runCatching { it.shutdown() } }

    /** Wie im Gerät, nur gelten die beiden Testserver als „GitHub“. */
    private val client = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
        .addInterceptor(UpdateRedirects { url: HttpUrl -> url.port == start.port || url.port == ziel.port })
        .build()

    private fun fetch(url: String) = client.newCall(Request.Builder().url(url).build()).execute().use { it.code to it.body.string() }

    @Test
    fun `a redirect within GitHub is followed`() {
        start.enqueue(MockResponse().setResponseCode(302).setHeader("Location", ziel.url("/objekt.apk")))
        ziel.enqueue(MockResponse().setBody("apk"))
        assertEquals(200 to "apk", fetch(start.url("/release").toString()))
        assertEquals("/objekt.apk", ziel.takeRequest().path)
    }

    /** Wie GitHub für `/releases/latest/download/…`: erst auf das Etikett, dann ins CDN. */
    @Test
    fun `the fixed link via releases-latest follows two redirects`() {
        val fassung = "/addict85/BrickInventory/releases/download/android-v1/version-signiert.json"
        start.enqueue(MockResponse().setResponseCode(302).setHeader("Location", fassung))
        start.enqueue(MockResponse().setResponseCode(302).setHeader("Location", ziel.url("/objekt")))
        ziel.enqueue(MockResponse().setBody("{}"))
        assertEquals(200 to "{}", fetch(start.url("/addict85/BrickInventory/releases/latest/download/version-signiert.json").toString()))
        assertEquals("/addict85/BrickInventory/releases/latest/download/version-signiert.json", start.takeRequest().path)
        assertEquals(fassung, start.takeRequest().path)
        assertEquals("/objekt", ziel.takeRequest().path)
    }

    @Test
    fun `a redirect to a foreign host is not even connected`() {
        start.enqueue(MockResponse().setResponseCode(302).setHeader("Location", fremd.url("/spiegel.apk")))
        try {
            fetch(start.url("/release").toString())
            fail("Die Umleitung auf einen fremden Host ging durch")
        } catch (_: IOException) {
            // erwartet
        }
        assertEquals("Der fremde Host sah die Anfrage", 0, fremd.requestCount)
    }

    @Test
    fun `only GitHub and its CDN, only via https on 443`() {
        for (gut in listOf("https://github.com/a/b/releases/download/x/y.apk", "https://github.com/a/b/releases/latest/download/y.json",
                           "https://objects.githubusercontent.com/z",
                           "https://release-assets.githubusercontent.com/z")) {
            assertTrue(gut, updateTargetAllowed(gut.toHttpUrl()))
        }
        for (boese in listOf("http://github.com/a", "https://github.com:8443/a", "https://evil.example/a",
                             "https://githubusercontent.com.evil.example/a", "https://evilgithubusercontent.com/a",
                             "https://gist.github.com.evil.example/a")) {
            assertFalse(boese, updateTargetAllowed(boese.toHttpUrl()))
        }
    }
}
