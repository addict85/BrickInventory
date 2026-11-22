package ch.brickinventoryapp.model.util

import java.net.URLEncoder

/**
 * Resolving image addresses — the same logic as thumbUrl()/imgUrl() in
 * `public/js/images.js`. Everything without `imageLocal` runs via the server's image proxy:
 * it delivers a small preview, brings referer fallback, unpacking and
 * negative cache against Cloudflare along, and its disk cache also fills through
 * the app.
 */

/**
 * The address of the image proxy, in one place. The server keeps serving the old
 * spelling /api/img-proxy (saved rows, older apps); a
 * saved value starts with „/“ and only gets the server address in front
 * anyway, therefore no detection is needed here.
 */
const val IMG_PROXY = "/api/v1/img-proxy"

/**
 * Image address for a tile or list — small, with thumbnail where possible.
 *
 * @param serverUrl base URL of the server, without trailing slash
 * @param imageLocal path stored locally on the server (e.g. "/images/sets/…"),
 *         or null
 * @param imageUrl raw address from the catalog (mostly an absolute CDN URL) or a
 *         relative server path
 */
fun resolveThumbUrl(serverUrl: String, imageLocal: String?, imageUrl: String?): String? =
    resolveImageUrl(serverUrl, imageLocal, imageUrl, thumb = true)

/** Image address in full resolution — for detail view and zoom. */
fun resolveFullUrl(serverUrl: String, imageLocal: String?, imageUrl: String?): String? =
    resolveImageUrl(serverUrl, imageLocal, imageUrl, thumb = false)

private fun resolveImageUrl(serverUrl: String, imageLocal: String?, imageUrl: String?, thumb: Boolean): String? {
    val base = serverUrl.trimEnd('/')
    return when {
        imageLocal != null -> {
            // No own toThumbPath(): imageLocal is the server's decision
            // (resolveImageLocal() in `src/images/images.ts` checks whether the preview exists). For
            // the full resolution an existing `_thumb` is removed, otherwise detail
            // and zoom would show the same small preview as the tile — like fullUrl() in the web app.
            val path = if (thumb) imageLocal
                       else imageLocal.replace(Regex("""_thumb(\.[^.?]+)(\?|$)"""), "$1$2")
            "$base$path"
        }
        imageUrl != null -> {
            if (imageUrl.startsWith("/")) {
                // Already a server path (rare, e.g. legacy data) — no CDN,
                // no proxy needed.
                "$base$imageUrl"
            } else if (!thumb) {
                // Full resolution via the server proxy as well, like fullUrl() in the web app:
                // a device that talks directly to Rebrickable anywhere hits Cloudflare's
                // bot detection, and the proxy's work would be without effect.
                "$base$IMG_PROXY?url=${URLEncoder.encode(imageUrl, "UTF-8")}"
            } else {
                // Thumbnail: via the server proxy, not directly from the
                // device. The same endpoint as the web app. &thumb=1 is
                // correctly self-controlled here — the proxy cache knows no
                // server-side upfront decision like image_local, the
                // thumbnail is generated on the fly when needed.
                val encoded = URLEncoder.encode(imageUrl, "UTF-8")
                "$base$IMG_PROXY?url=$encoded&thumb=1"
            }
        }
        else -> null
    }
}

// toThumbPath() (client-side "_thumb.jpg" construction for local paths)
// was removed — exactly it was the cause of the error described above.
// For local images only the server decides which file
// is delivered (`src/images/images.ts`, resolveImageLocal()).

/**
 * Full resolution via the server proxy — the fallback for parts and minifigures.
 * Since resolveFullUrl() also goes via the proxy, both deliver the same address.
 */
fun resolveFullUrlViaProxy(serverUrl: String, imageLocal: String?, imageUrl: String?): String? {
    val base = serverUrl.trimEnd('/')
    return when {
        // The same "_thumb" removal as in resolveFullUrl() above is needed —
        // otherwise the fallback for parts/minifigures with a locally
        // stored image would show exactly the same preview as the tile.
        imageLocal != null -> "$base${imageLocal.replace(Regex("""_thumb(\.[^.?]+)(\?|$)"""), "$1$2")}"
        imageUrl != null -> {
            if (imageUrl.startsWith("/")) "$base$imageUrl"
            else "$base$IMG_PROXY?url=${URLEncoder.encode(imageUrl, "UTF-8")}"
        }
        else -> null
    }
}
