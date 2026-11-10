package ch.brickinventoryapp.teile

import org.junit.Assert.assertTrue
import org.junit.Assert.assertEquals
import ch.brickinventoryapp.model.util.resolveThumbUrl
import ch.brickinventoryapp.model.util.resolveFullUrl
import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.Quellen

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
 * server-aufgelöste Quelle wie teile/ui/Teileliste.kt) läuft — nie direkt aus
 * einem `.imageUrl`-Feld ohne Auflösung.
 *
 * Gegenprobe: in resolveImageUrl die volle Auflösung
 * ohne Proxy (`imageUrl` direkt) → rot „resolveImageUrl-Helfer existiert …“.
 */
class NoDirectCdnAccessTest {

    private fun read(rel: String): String {
        val f = File(Quellen.wurzel, "$rel")
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
            "sammlung/ui/screens/GalerieKarte.kt",
            "sammlung/ui/screens/SetDetailScreen.kt",
            "teile/ui/screens/TeileKarte.kt",
            // FinanceScreen.kt wurde aufgeteilt — die Kacheln mit den Bildern
            // stehen in FinanceSections.kt.
            "finanzen/ui/screens/FinanceSections.kt",
            "teile/ui/screens/FigurenKarte.kt",
            "katalog/ui/screens/KatalogKarte.kt",
            "katalog/ui/screens/CatalogDetailScreen.kt",
        )
        for (rel in screensWithOwnResolution) {
            val fn = code(read(rel))
            // rememberTileImageWithFallback() zählt ebenfalls:
            // Der Helfer in ui/util/BildRueckfall.kt ruft intern resolveThumbUrl()
            assert(fn.contains("resolveThumbUrl(") || fn.contains("resolveFullUrl(") ||
                   fn.contains("rememberTileImageWithFallback(")) {
                "$rel lädt ein Bild, ohne resolveThumbUrl()/resolveFullUrl() oder den " +
                "Rückfall-Helfer zu benutzen — das führt am Server-Proxy vorbei direkt zum CDN"
            }
        }
    }

    @Test
    fun `resolveImageUrl-Helfer existiert und deckt beide Fälle ab`() {
        // Externe Adressen laufen über den Server-Proxy, lokal abgelegte Bilder
        // kommen direkt vom eigenen Server und gehen vor.
        val cdn = "https://cdn.rebrickable.com/media/sets/75192-1.jpg"
        for (adresse in listOf(resolveThumbUrl("http://nas", null, cdn), resolveFullUrl("http://nas", null, cdn))) {
            assertTrue(adresse, adresse!!.startsWith("http://nas/api/v1/img-proxy?url="))
        }
        assertEquals("http://nas/images/sets/75192-1.jpg", resolveThumbUrl("http://nas", "/images/sets/75192-1.jpg", cdn))
        assertEquals("http://nas/images/sets/75192-1.jpg", resolveFullUrl("http://nas", "/images/sets/75192-1.jpg", cdn))
    }

    @Test
    fun `PartsListScreen wickelt eine bereits aufgelöste Adresse nicht doppelt ein`() {
        // teile/ui/Teileliste.kt löst part.imageUrl bereits auf (das prüft
        // TeilelisteTest am Ergebnis); ein zweites resolveThumbUrl() hier
        // wickelte die Proxy-Adresse doppelt ein.
        val screen = code(Quellen.bildschirm("teile/ui/screens/PartsListScreen.kt"))
        assert(!screen.contains("resolveThumbUrl(") && !screen.contains("resolveFullUrl(")) {
            "Die Teileliste darf part.imageUrl NICHT durch resolveThumbUrl() schicken — " +
            "es ist bereits aufgelöst, sonst entsteht ein doppelt gewickelter Proxy-Aufruf"
        }
    }
}
