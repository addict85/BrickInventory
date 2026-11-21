package ch.brickinventoryapp.shared

import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.Quellen
import ch.brickinventoryapp.shared.ui.mengeAusSet
import ch.brickinventoryapp.shared.ui.mengeManuell

/**
 * Die Mengen-Plakette auf einer Kachel steht ueberall gleich herum.
 *
 * ── Welche Schreibweise wo gilt ─────────────────────────────────────────────
 *
 * Nicht geraten, sondern aus der Webapp gelesen. Dort ist die Regel eindeutig:
 *
 *     man-tile   → <span class="qbadge">×N</span>    manuell erfasst
 *     part-card  → <div class="part-qty">N×</div>    aus einem Set
 *
 * (public/js/minifigs.js Zeilen 327 und 486 fuer die manuellen Kacheln,
 * public/js/parts.js Zeile 300 und minifigs.js Zeile 272 fuer die aus
 * Sets.) Von den vier Stellen der App entsprach genau EINE dieser Regel.
 *
 * Die Textressource `minifigs_qty_badge` ist ersatzlos weg: „%1$d×" stand in
 * beiden Sprachen zeichengleich da. Ein Rechenzeichen ist kein Satz, und die
 * elf anderen Mengenangaben der App schreiben es auch direkt hin.
 */
class QuantityBadgeTest {

    private fun read(rel: String) =
        File(Quellen.root, "$rel").readText()
    private fun code(s: String) = s.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    /**
     */
    // Gegenproben: mengeAusSet() zurück auf "$menge×" → rot;
    // mengeManuell() auf "$menge×" → rot.
    @Test
    fun `the quantity stands everywhere as a symbol before the number`() {
        assertEquals("×3", mengeManuell(3))
        assertEquals("×3", mengeAusSet(3))
    }

    /**
     * Die Schreibweise selbst prüft der Test darüber; hier nur, dass alle vier
     * Kacheln sie benutzen. Ohne das könnte eine wieder eine eigene bauen.
     */
    @Test
    fun `all tiles get the badge from the same place`() {
        assert(code(read("shared/ui/ManualItemComposables.kt")).contains("mengeManuell(menge)")) {
            "ManuelleKachel schreibt die Menge wieder selbst"
        }
        for ((datei, wer) in listOf(
            "parts/ui/screens/TeileKarte.kt" to "ManualPartTile",
            "parts/ui/screens/FigurenKarte.kt" to "ManualFigTile",
        )) {
            val src = code(read(datei))
            assert(src.contains("ManuelleKachel(")) {
                "$wer baut seine Kachel wieder selbst statt ManuelleKachel zu rufen — " +
                    "dann laufen die beiden Ansichten wieder auseinander"
            }
            assert(src.contains("Text(mengeAusSet(qty)")) { "$datei schreibt die Set-Plakette wieder selbst" }
        }
    }

    @Test
    fun `the text resource for the badge is gone and is not used again`() {
        // Eine Ressource, die in beiden Sprachen dasselbe Zeichen enthaelt, sagt
        // nur, dass hier jemand uebersetzen koennte — und genau das hat den
        // Unterschied ueberhaupt erst verdeckt.
        for (datei in listOf("values/strings.xml", "values-de/strings.xml")) {
            val xml = File(Quellen.res, "$datei").readText()
            assert(!xml.contains("minifigs_qty_badge")) {
                "$datei traegt den Schluessel wieder — die Plakette gehoert direkt in den Quelltext"
            }
        }
    }
}
