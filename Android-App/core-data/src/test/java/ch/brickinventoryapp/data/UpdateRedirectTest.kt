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
 * The update client follows redirects only to GitHub via https: a
 * foreign redirect target is not even connected. With test servers instead of GitHub;
 * the rule for GitHub itself is checked by the last case.
 *
 * Counter-checks (05.11.2026, measured with kotlinc locally):
 *   A  in UpdateRedirects the check `erlaubt(anfrage.url)` removed
 *      (gegenproben/update-umleitung-ueberall.patch) → red “a redirect to a foreign host …”
 *   B  updateTargetAllowed() with `url.host.endsWith("githubusercontent.com")` without dot →
 *      red “only GitHub and its CDN …”
 *   C  MAX_REDIRECTS = 1 (Counter-check of 12.11.2026) → red “the fixed link via
 *      releases-latest …” (IOException „Zu viele Umleitungen“)
 */
class UpdateRedirectTest {

    private val start = MockWebServer().apply { start() }
    private val ziel = MockWebServer().apply { start() }
    private val fremd = MockWebServer().apply { start() }

    @After
    fun zu() = listOf(start, ziel, fremd).forEach { runCatching { it.shutdown() } }

    /** As on the device, only the two test servers count as „GitHub“. */
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

    /** Like GitHub for `/releases/latest/download/…`: first to the tag, then into the CDN. */
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
