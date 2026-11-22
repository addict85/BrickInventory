package ch.brickinventoryapp.ui.util

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import ch.brickinventoryapp.model.util.resolveFullUrl
import ch.brickinventoryapp.model.util.resolveFullUrlViaProxy
import ch.brickinventoryapp.model.util.resolveThumbUrl

/**
 * Preview image with fallback to full resolution: after a CSV import the
 * server generates the `_thumb` files afterwards, and until then responds to
 * the preview with 404. Like data-orig in the web app, it switches on the
 * first error instead of requesting the same missing file again. Returns: the
 * address to load and a callback for `AsyncImagePainter.State.Error`.
 *
 * @param fullViaProxy Fallback via resolveFullUrlViaProxy() (parts, minifigures)
 *         instead of resolveFullUrl()
 */
@Composable
fun rememberTileImageWithFallback(
    serverUrl: String,
    imageLocal: String?,
    imageUrl: String?,
    fullViaProxy: Boolean = false
): Pair<String?, () -> Unit> {
    var useFallback by remember(serverUrl, imageLocal, imageUrl) { mutableStateOf(false) }
    val url = if (useFallback) {
        if (fullViaProxy) resolveFullUrlViaProxy(serverUrl, imageLocal, imageUrl)
        else resolveFullUrl(serverUrl, imageLocal, imageUrl)
    } else resolveThumbUrl(serverUrl, imageLocal, imageUrl)
    return url to { useFallback = true }
}
