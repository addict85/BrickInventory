package ch.brickinventoryapp.parts

import ch.brickinventoryapp.model.util.resolveFullUrl
import ch.brickinventoryapp.model.util.resolveThumbUrl
import ch.brickinventoryapp.testing.Sources
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * All images run via the server — never directly from the device to the CDN.
 *
 * User request: "As I see it, the Android app should source all content, including all images, via the web app." Previously several screens bypassed the
 * server proxy and loaded raw CDN addresses directly from the device — that was
 * the actual cause of the Cloudflare detection, the concurrency
 * problems and the AVIF crash of the last three rounds: each of these
 * "fixes" treated a symptom of direct device-to-CDN access
 * instead of fixing the cause.
 *
 * This test requires, for every screen with an image, that the address
 * run through resolveThumbUrl()/resolveFullUrl() (or an equivalent, already
 * server-resolved source such as parts/ui/PartList.kt) — never directly from
 * an `.imageUrl` field without resolution.
 *
 * Counter-check: in resolveImageUrl the full resolution
 * without the proxy (`imageUrl` directly) → red “resolveImageUrl helper exists …”.
 */
class NoDirectCdnAccessTest {

    private fun read(rel: String): String {
        val f = File(Sources.root, "$rel")
        assert(f.exists()) { "Datei nicht gefunden: $rel" }
        return f.readText()
    }

    /** Hide comments — the explanatory texts name the checked patterns themselves. */
    private fun code(src: String) = src.lines().joinToString("\n") { line ->
        if (line.trim().startsWith("//")) "" else line
    }

    @Test
    fun `screens with images use resolveThumbUrl or resolveFullUrl`() {
        val screensWithOwnResolution = listOf(
            "collection/ui/screens/GalleryCard.kt",
            "collection/ui/screens/SetDetailScreen.kt",
            "parts/ui/screens/PartsCard.kt",
            // FinanceScreen.kt was split up — the tiles with the images
            // live in FinanceSections.kt.
            "finances/ui/screens/FinanceSections.kt",
            "parts/ui/screens/FiguresCard.kt",
            "catalog/ui/screens/CatalogCard.kt",
            "catalog/ui/screens/CatalogDetailScreen.kt",
        )
        for (rel in screensWithOwnResolution) {
            val fn = code(read(rel))
            // rememberTileImageWithFallback() counts too:
            // the helper in ui/util/ImageRueckfall.kt internally calls resolveThumbUrl()
            assert(fn.contains("resolveThumbUrl(") || fn.contains("resolveFullUrl(") ||
                   fn.contains("rememberTileImageWithFallback(")) {
                "$rel lädt ein Bild, ohne resolveThumbUrl()/resolveFullUrl() oder den " +
                "Rückfall-Helfer zu benutzen — das führt am Server-Proxy vorbei direkt zum CDN"
            }
        }
    }

    @Test
    fun `resolveImageUrl helper exists and covers both cases`() {
        // External addresses run via the server proxy, locally stored images
        // come directly from one's own server and take priority.
        val cdn = "https://cdn.rebrickable.com/media/sets/75192-1.jpg"
        for (address in listOf(resolveThumbUrl("http://nas", null, cdn), resolveFullUrl("http://nas", null, cdn))) {
            assertTrue(address, address!!.startsWith("http://nas/api/v1/img-proxy?url="))
        }
        assertEquals("http://nas/images/sets/75192-1.jpg", resolveThumbUrl("http://nas", "/images/sets/75192-1.jpg", cdn))
        assertEquals("http://nas/images/sets/75192-1.jpg", resolveFullUrl("http://nas", "/images/sets/75192-1.jpg", cdn))
    }

    @Test
    fun `PartsListScreen does not wrap an already resolved address twice`() {
        // parts/ui/PartList.kt already resolves part.imageUrl (checked by
        // PartListTest on the result); a second resolveThumbUrl() here
        // would wrap the proxy address a second time.
        val screen = code(Sources.screen("parts/ui/screens/PartsListScreen.kt"))
        assert(!screen.contains("resolveThumbUrl(") && !screen.contains("resolveFullUrl(")) {
            "Die Teileliste darf part.imageUrl NICHT durch resolveThumbUrl() schicken — " +
            "es ist bereits aufgelöst, sonst entsteht ein doppelt gewickelter Proxy-Aufruf"
        }
    }
}
