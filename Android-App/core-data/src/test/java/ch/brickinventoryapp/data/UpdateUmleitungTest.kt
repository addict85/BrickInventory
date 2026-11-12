package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.util.UpdateUmleitungen
import ch.brickinventoryapp.data.util.updateZielErlaubt
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
 *   A  in UpdateUmleitungen die Prüfung `erlaubt(anfrage.url)` entfernt
 *      (gegenproben/update-umleitung-ueberall.patch) → rot „eine Umleitung auf einen fremden Host …“
 *   B  updateZielErlaubt() mit `url.host.endsWith("githubusercontent.com")` ohne Punkt →
 *      rot „nur GitHub und sein CDN …“
 *   C  MAX_UMLEITUNGEN = 1 (Gegenprobe vom 12.11.2026) → rot „der feste Link ueber
 *      releases-latest …“ (IOException „Zu viele Umleitungen“)
 */
class UpdateUmleitungTest {

    private val start = MockWebServer().apply { start() }
    private val ziel = MockWebServer().apply { start() }
    private val fremd = MockWebServer().apply { start() }

    @After
    fun zu() = listOf(start, ziel, fremd).forEach { runCatching { it.shutdown() } }

    /** Wie im Gerät, nur gelten die beiden Testserver als „GitHub“. */
    private val client = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
        .addInterceptor(UpdateUmleitungen { url: HttpUrl -> url.port == start.port || url.port == ziel.port })
        .build()

    private fun hole(url: String) = client.newCall(Request.Builder().url(url).build()).execute().use { it.code to it.body.string() }

    @Test
    fun `eine Umleitung innerhalb von GitHub wird verfolgt`() {
        start.enqueue(MockResponse().setResponseCode(302).setHeader("Location", ziel.url("/objekt.apk")))
        ziel.enqueue(MockResponse().setBody("apk"))
        assertEquals(200 to "apk", hole(start.url("/release").toString()))
        assertEquals("/objekt.apk", ziel.takeRequest().path)
    }

    /** Wie GitHub für `/releases/latest/download/…`: erst auf das Etikett, dann ins CDN. */
    @Test
    fun `der feste Link ueber releases-latest folgt zwei Umleitungen`() {
        val fassung = "/addict85/BrickInventory/releases/download/android-v1/version-signiert.json"
        start.enqueue(MockResponse().setResponseCode(302).setHeader("Location", fassung))
        start.enqueue(MockResponse().setResponseCode(302).setHeader("Location", ziel.url("/objekt")))
        ziel.enqueue(MockResponse().setBody("{}"))
        assertEquals(200 to "{}", hole(start.url("/addict85/BrickInventory/releases/latest/download/version-signiert.json").toString()))
        assertEquals("/addict85/BrickInventory/releases/latest/download/version-signiert.json", start.takeRequest().path)
        assertEquals(fassung, start.takeRequest().path)
        assertEquals("/objekt", ziel.takeRequest().path)
    }

    @Test
    fun `eine Umleitung auf einen fremden Host wird nicht einmal verbunden`() {
        start.enqueue(MockResponse().setResponseCode(302).setHeader("Location", fremd.url("/spiegel.apk")))
        try {
            hole(start.url("/release").toString())
            fail("Die Umleitung auf einen fremden Host ging durch")
        } catch (_: IOException) {
            // erwartet
        }
        assertEquals("Der fremde Host sah die Anfrage", 0, fremd.requestCount)
    }

    @Test
    fun `nur GitHub und sein CDN, nur ueber https auf 443`() {
        for (gut in listOf("https://github.com/a/b/releases/download/x/y.apk", "https://github.com/a/b/releases/latest/download/y.json",
                           "https://objects.githubusercontent.com/z",
                           "https://release-assets.githubusercontent.com/z")) {
            assertTrue(gut, updateZielErlaubt(gut.toHttpUrl()))
        }
        for (boese in listOf("http://github.com/a", "https://github.com:8443/a", "https://evil.example/a",
                             "https://githubusercontent.com.evil.example/a", "https://evilgithubusercontent.com/a",
                             "https://gist.github.com.evil.example/a")) {
            assertFalse(boese, updateZielErlaubt(boese.toHttpUrl()))
        }
    }
}
