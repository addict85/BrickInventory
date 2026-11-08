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
 * Vorschaubild mit Rückfall auf die volle Auflösung: Nach einem CSV-Import erzeugt
 * der Server die `_thumb`-Dateien nachträglich, bis dahin antwortet er auf die
 * Vorschau mit 404. Wie data-orig in der Webapp wird beim ersten Fehler
 * gewechselt, statt dieselbe fehlende Datei erneut anzufragen. Rückgabe: die zu
 * ladende Adresse und ein Rückruf für `AsyncImagePainter.State.Error`.
 *
 * @param fullViaProxy Rückfall über resolveFullUrlViaProxy() (Teile, Minifiguren)
 *         statt resolveFullUrl()
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
