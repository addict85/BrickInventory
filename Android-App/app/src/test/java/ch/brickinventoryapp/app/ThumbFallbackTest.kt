package ch.brickinventoryapp.app

import ch.brickinventoryapp.model.util.IMG_PROXY
import ch.brickinventoryapp.model.util.resolveFullUrl
import ch.brickinventoryapp.model.util.resolveFullUrlViaProxy
import ch.brickinventoryapp.model.util.resolveThumbUrl
import ch.brickinventoryapp.testing.Sources
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.File

/** Server address with a trailing slash: the helpers cut it off. */
private const val SERVER = "http://nas:3000/"

/**
 * Thumbnail fallback to the full resolution when "_thumb.jpg" is (still)
 * missing.
 *
 * Reported: gallery tiles stayed empty although all images are meanwhile fetched via
 * the server (no direct CDN access any more). Cause: after
 * a CSV import the server stores original images immediately, but creates the
 * "_thumb.jpg" variants only AFTERWARDS in its own, slow
 * queue (`server.ts`, "Generate missing thumbnails"). The previous
 * retry requested the same (missing) preview file a second time
 * — the same 404, no improvement. The web app falls back to the full resolution in exactly this case
 * (`public/js/actions.js`, data-orig); Android
 * did not have this behavior so far.
 */
class ThumbFallbackTest {

    private fun read(rel: String): String {
        val f = File(Sources.root, "$rel")
        assert(f.exists()) { "File not found: $rel" }
        return f.readText()
    }

    @Test
    fun `imageLocal is taken over unchanged — no own _thumb guess any more`() {
        // The server checks whether the preview exists and delivers the matching
        // path; a client-side guessed "_thumb.jpg" failed exactly then.
        assertEquals("http://nas:3000/images/sets/10283-1.jpg",
            resolveThumbUrl(SERVER, "/images/sets/10283-1.jpg", "https://cdn.rebrickable.com/x.jpg"))
        assertEquals("http://nas:3000/images/sets/10283-1_thumb.jpg",
            resolveThumbUrl(SERVER, "/images/sets/10283-1_thumb.jpg", null))
    }
}

/**
 * The image client logs just like the API client.
 *
 * A logcat showed all API calls (/api/v1/sets, /stats, /settings), but
 * NOT A SINGLE image request — not because none were made, but because
 * the logging interceptor hung only on isApiClient=true. The image client
 * (isApiClient=false, used by Coil) had no interceptor and thus stayed
 * invisible to every diagnosis. The absence of image requests in the log
 * was therefore no insight into the problem but a gap in
 * observability itself.
 */
class ImageClientLoggingTest {

    @Test
    fun `HttpLoggingInterceptor no longer hangs only on the API client`() {
        // Hide comments BEFORE the window is cut: a
        // growing explanatory text otherwise pushed the checked line out of the 800
        // characters — the rule still applied, only the excerpt was too short.
        val src = Sources.di().lines()
            .joinToString("\n") { if (it.trim().startsWith("//")) "" else it }
        val start = src.indexOf("internal fun buildInterceptorClient")
        val fn = src.substring(start, minOf(src.length, start + 2000))
        assert(!fn.contains("if (isApiClient && BuildConfig.DEBUG)")) {
            "the old condition excluded the image client from logging"
        }
        assert(fn.contains("if (BuildConfig.DEBUG) {")) {
            "both clients must be logged in the debug build"
        }
        // The rewriting of the placeholder is checked by ServerGuardTest, executed.
    }
}

/**
 * ALL image fetches run via the server proxy — the full resolution too.
 *
 * ── Reversed ────────
 * This class used to require the opposite: full resolution directly from the
 * device to the CDN, because that was supposedly faster for a one-time display and relieved the
 * server. That is the exception that makes the rule worthless — a
 * device that somewhere does talk directly to Rebrickable meets
 * Cloudflare's bot detection there. Browser identifier, referer header, throttling
 * and AVIF avoidance in this app all treated symptoms of it.
 *
 * Now uniformly: preview AND full resolution via the server proxy
 * (ImageUrls.kt, IMG_PROXY).
 * The server brings disk cache, negative cache and unpacking there —
 * work that would be ineffective with direct access.
 *
 * The class name stays so that the history can be found; checked is
 * now the reverse statement.
 */
class FullResolutionBypassesProxyTest {

    @Test
    fun `resolveFullUrl routes the full resolution via the server proxy`() {
        // No device talks directly to the CDN (Cloudflare's bot detection);
        // the full resolution carries no &thumb=1.
        assertEquals("http://nas:3000$IMG_PROXY?url=https%3A%2F%2Fcdn.rebrickable.com%2Fsets%2F1+2.jpg",
            resolveFullUrl(SERVER, null, "https://cdn.rebrickable.com/sets/1 2.jpg"))
        assertEquals("a server path needs no proxy", "http://nas:3000/media/a.jpg",
            resolveFullUrl(SERVER, null, "/media/a.jpg"))
        assertNull(resolveFullUrl(SERVER, null, null))
    }

    @Test
    fun `thumbnail still runs via the proxy with thumb=1`() {
        assertEquals("http://nas:3000$IMG_PROXY?url=https%3A%2F%2Fcdn.rebrickable.com%2Fx.jpg&thumb=1",
            resolveThumbUrl(SERVER, null, "https://cdn.rebrickable.com/x.jpg"))
    }
}

/**
 * Parts and minifigures load the fallback (full resolution) via the
 * server proxy — at the user's request, so that no device bypasses the server
 * there either and talks directly to Rebrickable. Sets and catalog deliberately stay
 * with the direct CDN address for their own detail/zoom dialogs.
 */
class PartsMinifigsFullResBypassProxyTest {
    private fun read(rel: String): String {
        val f = File(Sources.root, "$rel")
        assert(f.exists()) { "File not found: $rel" }
        return f.readText()
    }

    @Test
    fun `resolveFullUrlViaProxy exists and wraps CDN addresses into the proxy`() {
        assertEquals("http://nas:3000$IMG_PROXY?url=https%3A%2F%2Fcdn.rebrickable.com%2Fp.png",
            resolveFullUrlViaProxy(SERVER, null, "https://cdn.rebrickable.com/p.png"))
    }
}

/**
 * The set detail dialog uses the full resolution, not a preview — like the
 * web app.
 *
 * An earlier comment claimed that the web app makes the same thumb/full
 * distinction in the detail dialog as the tile — that was not true.
 * `public/js/admin.js` always shows fullUrl() for "m-img" (the main image in the detail dialog),
 * never a preview. Android wrongly showed
 * resolveThumbUrl() there.
 */
class SetDetailUsesFullResolutionTest {
    private fun read(rel: String): String {
        val f = File(Sources.root, "$rel")
        assert(f.exists()) { "File not found: $rel" }
        return f.readText()
    }

    @Test
    fun `SetDetailScreen shows the same full resolution for preview and zoom`() {
        val src = read("collection/ui/screens/SetDetailScreen.kt")
        assert(src.contains("val imageUrl = resolveFullUrl(serverUrl, set.imageLocal, set.imageUrl)")) {
            "the main image in the detail dialog must use resolveFullUrl(), not resolveThumbUrl()"
        }
        assert(!src.contains("resolveThumbUrl(serverUrl, set.imageLocal, set.imageUrl)")) {
            "resolveThumbUrl() must no longer be called here"
        }
        assert(!src.contains("import ch.brickinventoryapp.model.util.resolveThumbUrl")) {
            "the now unused import must be removed"
        }
    }
}

/**
 * resolveFullUrl()/resolveFullUrlViaProxy() remove a "_thumb" suffix
 * from imageLocal instead of passing it through unchanged.
 *
 * Reported: detail and zoom still showed the small preview for sets,
 * not the full resolution. Cause: when removing the faulty
 * guess (toThumbPath()) the OPPOSITE but necessary
 * operation was removed too — cutting off an already existing
 * "_thumb" suffix for the full resolution. Without that
 * resolveThumbUrl() AND resolveFullUrl() delivered exactly the same value
 * with imageLocal set, as soon as the server returned a preview path — the
 * normal case for already downloaded sets. The same reversal as
 * fullUrl() in the web app (`public/js/01-core.js`).
 *
 * The address checks of this file call the helpers instead of reading their
 * source. Counter-checks:
 *   A  in resolveImageUrl the removal of `_thumb` omitted → red “resolveFullUrl
 *      removes …” and “preview and full resolution …”
 *   B  `&thumb=1` omitted for the thumbnail → red “thumbnail still runs …”
 */
class FullResolutionStripsThumbSuffixTest {

    @Test
    fun `resolveFullUrl removes an existing _thumb suffix`() {
        assertEquals("http://nas:3000/images/sets/10283-1.jpg", resolveFullUrl(SERVER, "/images/sets/10283-1_thumb.jpg", null))
        assertEquals("the query stays", "http://nas:3000/images/p/3001.png?v=2",
            resolveFullUrl(SERVER, "/images/p/3001_thumb.png?v=2", null))
        assertEquals("only the suffix before the extension", "http://nas:3000/images/x_thumbnail.jpg",
            resolveFullUrl(SERVER, "/images/x_thumbnail.jpg", null))
    }

    @Test
    fun `resolveFullUrlViaProxy also removes an existing _thumb suffix`() {
        assertEquals("http://nas:3000/images/minifigs/sw0001.jpg",
            resolveFullUrlViaProxy(SERVER, "/images/minifigs/sw0001_thumb.jpg", null))
    }

    @Test
    fun `preview and full resolution deliver different addresses for a preview path`() {
        val path = "/images/sets/10283-1_thumb.jpg"
        assertNotEquals(resolveThumbUrl(SERVER, path, null), resolveFullUrl(SERVER, path, null))
    }
}
