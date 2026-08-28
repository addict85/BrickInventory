package ch.brickinventoryapp

import org.junit.Test

/**
 * Alle Bilder laufen über den Server — nie direkt vom Gerät zum CDN.
 *
 * Nutzerwunsch: "Aus meiner Sicht müsste die Android-App allen Content also
 * auch alle Bilder via Webapp beziehen." Vorher gingen mehrere Bildschirme am
 * Server-Proxy vorbei und luden rohe CDN-Adressen direkt vom Gerät — das war
 * die eigentliche Ursache der Cloudflare-Erkennung, der Nebenläufigkeits-
 * Probleme und des AVIF-Absturzes der letzten drei Runden: Jede dieser
 * "Reparaturen" behandelte ein Symptom des direkten Gerät-zu-CDN-Zugriffs,
 * statt die Ursache zu beheben.
 *
 * Dieser Test verlangt für jeden Bildschirm mit einem Bild, dass die Adresse
 * durch resolveThumbUrl()/resolveFullUrl() (oder eine gleichwertige, bereits
 * server-aufgelöste Quelle wie PartsListFeature.kt) läuft — nie direkt aus
 * einem `.imageUrl`-Feld ohne Auflösung.
 */
class NoDirectCdnAccessTest {

    private fun read(rel: String): String {
        val f = java.io.File("src/main/java/ch/brickinventoryapp/$rel")
        assert(f.exists()) { "Datei nicht gefunden: $rel" }
        return f.readText()
    }

    /** Kommentare ausblenden — Erklärtexte nennen die geprüften Muster selbst. */
    private fun code(src: String) = src.lines().joinToString("\n") { line ->
        if (line.trim().startsWith("//")) "" else line
    }

    @Test
    fun `Screens mit Bildern benutzen resolveThumbUrl oder resolveFullUrl`() {
        val screensWithOwnResolution = listOf(
            "ui/screens/GalleryScreen.kt",
            "ui/screens/SetDetailScreen.kt",
            "ui/screens/PartsScreen.kt",
            "ui/screens/FinanceScreen.kt",
            "ui/screens/MinifigsScreen.kt",
            "ui/screens/CatalogScreen.kt",
            "ui/screens/CatalogDetailScreen.kt",
        )
        for (rel in screensWithOwnResolution) {
            val fn = code(read(rel))
            // rememberTileImageWithFallback() zählt ebenfalls (Nachtrag 38):
            // Der Helfer in util/ImageUrls.kt ruft intern resolveThumbUrl()
            // bzw. resolveFullUrl() auf — ein Screen, der ihn benutzt, geht
            // also gerade NICHT am Proxy vorbei. GalleryScreen tut genau das
            // und wurde hier trotzdem beanstandet, weil nur der wörtliche
            // Aufruf gesucht wurde. Geprüft wird die ABSICHT: keine eigene
            // Adressbildung am Helfer vorbei.
            assert(fn.contains("resolveThumbUrl(") || fn.contains("resolveFullUrl(") ||
                   fn.contains("rememberTileImageWithFallback(")) {
                "$rel lädt ein Bild, ohne resolveThumbUrl()/resolveFullUrl() oder den " +
                "Rückfall-Helfer zu benutzen — das führt am Server-Proxy vorbei direkt zum CDN"
            }
        }
    }

    @Test
    fun `resolveImageUrl-Helfer existiert und deckt beide Fälle ab`() {
        val src = read("util/ImageUrls.kt")
        assert(src.contains("fun resolveThumbUrl")) { "resolveThumbUrl fehlt" }
        assert(src.contains("fun resolveFullUrl")) { "resolveFullUrl fehlt" }
        // CDN-Adressen MÜSSEN über den Server-Proxy laufen, nicht direkt.
        assert(src.contains("/api/img-proxy?url=")) {
            "Die Auflösung muss externe Adressen über den Server-Proxy schicken"
        }
        // Lokale Server-Pfade dürfen NICHT proxy-gewickelt werden (unnötig,
        // sie kommen bereits vom eigenen Server über express.static).
        assert(src.contains("imageLocal != null ->")) {
            "Lokal abgelegte Bilder müssen weiterhin bevorzugt werden"
        }
    }

    @Test
    fun `PartsListScreen wickelt eine bereits aufgelöste Adresse nicht doppelt ein`() {
        // PartsListFeature.kt löst part.imageUrl BEREITS auf (image_local
        // bevorzugt, sonst Server-Proxy), bevor ein PlPart entsteht. Ein
        // erneutes resolveThumbUrl() in PartsListScreen.kt würde eine bereits
        // proxy-gewickelte Adresse ein zweites Mal einwickeln — das war ein
        // Fehler, der beim ersten Anlauf dieser Änderung entstand und wieder
        // rückgängig gemacht wurde.
        val feature = code(read("ui/PartsListFeature.kt"))
        assert(feature.contains("/api/img-proxy?url=")) {
            "PartsListFeature.kt muss die Auflösung weiterhin selbst übernehmen"
        }
        val screen = code(read("ui/screens/PartsListScreen.kt"))
        assert(!screen.contains("resolveThumbUrl(") && !screen.contains("resolveFullUrl(")) {
            "PartsListScreen.kt darf part.imageUrl NICHT durch resolveThumbUrl() schicken — " +
            "es ist bereits aufgelöst, sonst entsteht ein doppelt gewickelter Proxy-Aufruf"
        }
    }
}
