package ch.brickinventoryapp

import ch.brickinventoryapp.util.UpdateUmleitungen
import ch.brickinventoryapp.util.updateZielErlaubt
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
 * Der Update-Client folgt Umleitungen nur zu GitHub über https (sec17 B-N8): Ein
 * fremdes Umleitungsziel wird nicht einmal verbunden. Mit Testservern statt GitHub;
 * die Regel für GitHub selbst prüft der letzte Fall.
 *
 * Gegenproben (05.11.2026, gemessen mit kotlinc lokal):
 *   A  in UpdateUmleitungen die Prüfung `erlaubt(anfrage.url)` entfernt
 *      (gegenproben/update-umleitung-ueberall.patch) → rot „eine Umleitung auf einen fremden Host …“
 *   B  updateZielErlaubt() mit `url.host.endsWith("githubusercontent.com")` ohne Punkt →
 *      rot „nur GitHub und sein CDN …“
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
        for (gut in listOf("https://github.com/a/b/releases/download/x/y.apk", "https://objects.githubusercontent.com/z",
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
