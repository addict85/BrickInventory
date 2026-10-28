package ch.brickinventoryapp.util

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import java.net.URLEncoder

/**
 * Bild-Adressen auflösen — dieselbe Logik wie thumbUrl()/imgUrl() in
 * public/js/01-core.js. Alles ohne `imageLocal` läuft über den Bild-Proxy des
 * Servers: Er liefert eine kleine Vorschau, bringt Referer-Rückfall, Entpacken und
 * Negativ-Cache gegen Cloudflare mit, und sein Plattencache füllt sich auch durch
 * die App.
 */

/**
 * Die Adresse des Bild-Proxys, an einer Stelle. Der Server bedient die alte
 * Schreibweise /api/img-proxy weiter (gespeicherte Zeilen, ältere Apps); ein
 * gespeicherter Wert beginnt mit „/“ und bekommt ohnehin nur die Serveradresse
 * davor, deshalb braucht es hier keine Erkennung.
 */
const val IMG_PROXY = "/api/v1/img-proxy"

/**
 * Bildadresse für eine Kachel oder Liste — klein, mit Vorschaubild wo möglich.
 *
 * @param serverUrl Basis-URL des Servers, ohne abschliessenden Schrägstrich
 * @param imageLocal lokal auf dem Server abgelegter Pfad (z. B. "/images/sets/…"),
 *         oder null
 * @param imageUrl rohe Adresse vom Katalog (meist eine absolute CDN-URL) oder ein
 *         relativer Server-Pfad
 */
fun resolveThumbUrl(serverUrl: String, imageLocal: String?, imageUrl: String?): String? =
    resolveImageUrl(serverUrl, imageLocal, imageUrl, thumb = true)

/** Bildadresse in voller Auflösung — für Detailansicht und Zoom. */
fun resolveFullUrl(serverUrl: String, imageLocal: String?, imageUrl: String?): String? =
    resolveImageUrl(serverUrl, imageLocal, imageUrl, thumb = false)

private fun resolveImageUrl(serverUrl: String, imageLocal: String?, imageUrl: String?, thumb: Boolean): String? {
    val base = serverUrl.trimEnd('/')
    return when {
        imageLocal != null -> {
            // Kein eigenes toThumbPath(): imageLocal ist die Entscheidung des Servers
            // (resolveImageLocal() in utils/images.ts prüft, ob die Vorschau existiert). Für
            // die volle Auflösung wird ein vorhandenes `_thumb` entfernt, sonst zeigten Detail
            // und Zoom dieselbe kleine Vorschau wie die Kachel — wie fullUrl() in der Webapp.
            val path = if (thumb) imageLocal
                       else imageLocal.replace(Regex("""_thumb(\.[^.?]+)(\?|$)"""), "$1$2")
            "$base$path"
        }
        imageUrl != null -> {
            if (imageUrl.startsWith("/")) {
                // Bereits ein Server-Pfad (selten, z. B. Altdaten) — kein CDN,
                // kein Proxy nötig.
                "$base$imageUrl"
            } else if (!thumb) {
                // Volle Auflösung ebenfalls über den Server-Proxy, wie fullUrl() in der Webapp:
                // Ein Gerät, das irgendwo direkt mit Rebrickable spricht, trifft auf Cloudflares
                // Bot-Erkennung, und die Arbeit des Proxys bliebe wirkungslos.
                "$base$IMG_PROXY?url=${URLEncoder.encode(imageUrl, "UTF-8")}"
            } else {
                // Vorschaubild: über den Server-Proxy, nicht direkt vom
                // Gerät. Derselbe Endpunkt wie die Webapp. &thumb=1 ist hier
                // korrekt selbst gesteuert — der Proxy-Cache kennt keine
                // serverseitige Vorab-Entscheidung wie image_local, das
                // Vorschaubild wird bei Bedarf on-the-fly erzeugt.
                val encoded = URLEncoder.encode(imageUrl, "UTF-8")
                "$base$IMG_PROXY?url=$encoded&thumb=1"
            }
        }
        else -> null
    }
}

// toThumbPath() (Client-seitige "_thumb.jpg"-Konstruktion für lokale Pfade)
// wurde entfernt — genau sie war die Ursache des Fehlers oben beschrieben.
// Für lokale Bilder entscheidet ausschliesslich der Server, welche Datei
// ausgeliefert wird (utils/images.ts, resolveImageLocal()).

/**
 * Volle Auflösung über den Server-Proxy — der Rückfall für Teile und Minifiguren.
 * Seit auch resolveFullUrl() über den Proxy geht, liefern beide dieselbe Adresse.
 */
fun resolveFullUrlViaProxy(serverUrl: String, imageLocal: String?, imageUrl: String?): String? {
    val base = serverUrl.trimEnd('/')
    return when {
        // Dasselbe "_thumb"-Entfernen wie in resolveFullUrl() oben nötig —
        // sonst zeigte der Rückfall bei Teilen/Minifiguren mit lokal
        // abgelegtem Bild exakt dieselbe Vorschau wie die Kachel.
        imageLocal != null -> "$base${imageLocal.replace(Regex("""_thumb(\.[^.?]+)(\?|$)"""), "$1$2")}"
        imageUrl != null -> {
            if (imageUrl.startsWith("/")) "$base$imageUrl"
            else "$base$IMG_PROXY?url=${URLEncoder.encode(imageUrl, "UTF-8")}"
        }
        else -> null
    }
}

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
