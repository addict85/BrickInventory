package ch.brickinventoryapp.util

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import java.net.URLEncoder

/**
 * Bild-Adressen auflösen — dieselbe Logik wie public/js/01-core.js
 * (thumbUrl()/imgUrl()) in der Webapp, damit beide Clients dasselbe Verhalten
 * zeigen.
 *
 * Vorher lud die App für alles ohne `imageLocal` die rohe CDN-Adresse direkt
 * vom Gerät — am Server-Proxy vorbei. Das hatte drei Nachteile, die erst
 * clientseitig geflickt werden mussten (Nebenläufigkeits-Drossel,
 * Wiederholversuch, Browser-Kennung gegen Cloudflare):
 *
 *   1. Volle Auflösung statt Vorschaubild — unnötig grosser Download auf
 *      einer Kachelwand.
 *   2. Cloudflares Bot-Erkennung traf das Gerät direkt; der Server-Proxy hat
 *      das bereits gelöst (Referer-Rückfall, Entpacken, Negativ-Cache) —
 *      diese Arbeit war für die App bisher wirkungslos.
 *   3. Der Server bekommt nie mitgeteilt, dass dieses Bild gebraucht wird —
 *      sein eigener Plattencache bleibt für Android-nur-Nutzer leer.
 *
 * Über den Server-Proxy laufen zu lassen behebt alle drei: Der Server macht
 * die Netzwerkarbeit (mit seiner bereits gehärteten Logik), liefert ein
 * kleineres Vorschaubild, und sein Cache füllt sich auch durch Android-Zugriffe.
 */

/**
 * Die Adresse des Bild-Proxys — an EINER Stelle, dreimal gebraucht.
 *
 * ── Der Umzug nach /api/v1 (Nachtrag 162) ───────────────────────────────────
 *
 * Der Proxy war die letzte Adresse neben /api/v1. Sie ist umgezogen; der
 * Server bedient die alte Schreibweise weiter, weil sie in Datenbankzeilen
 * steht und weil installierte App-Fassungen sie selbst zusammenbauen — genau
 * diese Stelle hier ist gemeint. Eine App, die nicht aktualisiert wird,
 * bekaeme sonst ueberhaupt keine Teilebilder mehr.
 *
 * Diese Fassung baut nur noch die neue. Die alte muss sie NICHT erkennen: Ein
 * gespeicherter Wert beginnt mit „/" und laeuft damit ohnehin ueber den Zweig
 * „server-relativer Pfad" — er wird nur um die Serveradresse ergaenzt, egal
 * welche der beiden Formen er traegt. Eine eigene Erkennung waere hier toter
 * Code, und der ist schlechter als keiner.
 */
const val IMG_PROXY = "/api/v1/img-proxy"

/**
 * Bildadresse für eine Kachel/Liste (klein, mit Vorschaubild wo möglich).
 *
 * @param serverUrl Basis-URL des Servers, ohne abschliessenden Schrägstrich
 * @param imageLocal Lokal auf dem Server abgelegter Pfad (z. B. "/images/sets/…"),
 *        oder null
 * @param imageUrl Rohe Adresse vom Katalog (meist eine absolute CDN-URL),
 *        oder ein bereits relativer Server-Pfad
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
            // KEIN toThumbPath() hier — imageLocal ist bereits die vom Server
            // autoritativ entschiedene Adresse. utils/images.ts
            // (resolveImageLocal(), server) prüft dort bereits, ob die
            // "_thumb.jpg"-Datei existiert, und liefert je nachdem den
            // Thumb- ODER den Original-Pfad zurück — mit einem eigenen
            // Existenz-Cache (10 Minuten für "existiert nicht").
            //
            // Ein zweiter, blinder Rate-Versuch hier hätte GENAU DAS wieder
            // zunichtegemacht: Lieferte der Server den Original-Pfad, weil
            // die Vorschau (noch) fehlt, konstruierte diese Funktion trotzdem
            // ihren EIGENEN "_thumb.jpg"-Pfad daraus — denselben, von dem der
            // Server soeben festgestellt hatte, dass es ihn nicht gibt.
            //
            // ABER: Für volle Auflösung (thumb=false) muss ein bereits
            // vorhandenes "_thumb"-Suffix ENTFERNT werden, falls imageLocal
            // zufällig auf die Vorschau-Datei zeigt (der Server liefert
            // genau die, sobald sie existiert — der Normalfall). Sonst
            // zeigten Detailansicht und Zoom exakt dieselbe kleine Vorschau
            // wie die Kachel, sobald ein Set lokal abgelegt ist. Dieselbe
            // Umkehrung wie fullUrl() in der Webapp (public/js/01-core.js):
            // dort wird "_thumb" ebenso vor der vollen Auflösung entfernt.
            // Für die Vorschau selbst (thumb=true) bleibt imageLocal
            // unverändert — dort entscheidet ausschliesslich der Server.
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
                // Volle Auflösung: ebenfalls über den Server-Proxy.
                //
                // VORHER ging genau dieser Zweig DIREKT zum CDN — mit der
                // Begründung, ein einmaliger Detailabruf sei so schneller und
                // entlaste den Server. Das ist die Ausnahme, die die Regel
                // wertlos macht: Ein Gerät, das irgendwo doch direkt mit
                // Rebrickable spricht, trifft dort auf Cloudflares
                // Bot-Erkennung — genau die Ursache, gegen die in dieser App
                // schon Browser-Kennung, Referer-Kopfzeile, Drosselung und
                // AVIF-Vermeidung eingebaut wurden. Jede dieser Massnahmen
                // behandelte ein Symptom davon.
                //
                // Die Webapp macht es seit derselben Umstellung genauso
                // (public/js/01-core.js, fullUrl()): Absolute Adressen gehen
                // ausnahmslos über /api/img-proxy. Der Server bringt dort
                // Plattencache, Negativ-Cache und Entpacken mit — Arbeit, die
                // bei einem Direktzugriff wirkungslos bleibt.
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
 * Volle Auflösung ÜBER den Server-Proxy — nicht direkt vom Gerät zum CDN.
 *
 * Gegenstück zu resolveFullUrl(): Bei Sets und dem Katalog ist der direkte
 * Geräte-zu-CDN-Zugriff für eine einmalige Detailansicht bewusst gewollt
 * (schneller, entlastet den Server, siehe resolveFullUrl()-Kommentar). Für
 * Teile und Minifiguren wurde das auf Nutzerwunsch anders entschieden: auch
 * die volle Auflösung soll über das Backend laufen, damit beide Apps
 * durchgehend denselben Weg nehmen — keine Ausnahme, bei der ein Gerät am
 * Server vorbei direkt mit Rebrickable spricht.
 *
 * Technisch derselbe Proxy-Aufruf wie resolveThumbUrl(), nur ohne &thumb=1.
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
 * Vorschaubild mit Rückfall auf die volle Auflösung, wenn die
 * "_thumb.jpg"-Datei (noch) nicht existiert.
 *
 * Hintergrund: Nach einem CSV-Import legt der Server die Original-Bilder
 * sofort ab, erzeugt die zugehörigen "_thumb.jpg"-Dateien aber in einer
 * eigenen Warteschlange NACHTRÄGLICH (server.ts, "Generate missing
 * thumbnails" — ein Bild nach dem anderen, mit kleinen Pausen). Bei einem
 * frisch importierten Bestand mit hunderten Sets kann das eine Weile dauern.
 * Fragt die Galerie in dieser Zeit eine noch nicht erzeugte Vorschau an,
 * antwortet der Server mit 404.
 *
 * Die Webapp fängt genau das ab: Schlägt das <img> zweimal fehl, fällt sie auf
 * die volle Auflösung zurück (data-orig in public/js/11-actions.js) — die
 * existiert immer, sobald image_local gesetzt ist. Android hatte bisher nur
 * einen Wiederholversuch derselben (fehlenden) Vorschau-Datei — der zweite
 * Versuch scheiterte an derselben 404 wie der erste, die Kachel blieb leer.
 *
 * Dieser Helfer bildet dasselbe Verhalten nach: Beim ersten Fehler sofort auf
 * die volle Auflösung wechseln, kein sinnloser Wiederholversuch derselben
 * Datei. Rückgabe: die aktuell zu ladende Adresse plus ein Callback, das bei
 * `AsyncImagePainter.State.Error` aufgerufen werden muss.
 *
 * @param fullViaProxy Bei true läuft der Rückfall ebenfalls über den
 *        Server-Proxy (Teile, Minifiguren — auf Nutzerwunsch). Bei false
 *        (Vorgabe) direkt vom Gerät zum CDN (Sets, Katalog).
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
