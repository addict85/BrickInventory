package ch.brickinventoryapp.shared

import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.Sources
import ch.brickinventoryapp.shared.ui.quantityFromSet
import ch.brickinventoryapp.shared.ui.quantityManual

/**
 * The quantity badge on a tile faces the same way everywhere.
 *
 * ── Which notation applies where ─────────────────────────────────────────────
 *
 * Not guessed, but read from the web app. There, the rule is unambiguous:
 *
 *     man-tile   → <span class="qbadge">×N</span>    manually captured
 *     part-card  → <div class="part-qty">N×</div>    from a set
 *
 * (public/js/minifigs.js lines 327 and 486 for the manual tiles,
 * public/js/parts.js line 300 and minifigs.js line 272 for the ones from
 * sets.) Of the app's four places, exactly ONE matched this rule.
 *
 * The text resource `minifigs_qty_badge` is gone, without a replacement: „%1$d×" stood
 * identical in both languages. An arithmetic symbol is not a sentence, and the
 * eleven other quantity figures in the app also write it in directly.
 */
class QuantityBadgeTest {

    private fun read(rel: String) =
        File(Sources.root, "$rel").readText()
    private fun code(s: String) = s.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    /**
     */
    // Counter-checks: quantityFromSet() reverted to "$menge×" → red;
    // quantityManual() to "$menge×" → red.
    @Test
    fun `the quantity stands everywhere as a symbol before the number`() {
        assertEquals("×3", quantityManual(3))
        assertEquals("×3", quantityFromSet(3))
    }

    /**
     * The notation itself is checked by the test above; here only that all four
     * tiles use it. Without this, one could start building its own again.
     */
    @Test
    fun `all tiles get the badge from the same place`() {
        assert(code(read("shared/ui/ManualItemComposables.kt")).contains("quantityManual(quantity)")) {
            "ManualTile schreibt die Menge wieder selbst"
        }
        for ((file, who) in listOf(
            "parts/ui/screens/PartsCard.kt" to "ManualPartTile",
            "parts/ui/screens/FiguresCard.kt" to "ManualFigTile",
        )) {
            val src = code(read(file))
            assert(src.contains("ManualTile(")) {
                "$who baut seine Kachel wieder selbst statt ManualTile zu rufen — " +
                    "dann laufen die beiden Ansichten wieder auseinander"
            }
            assert(src.contains("Text(quantityFromSet(qty)")) { "$file schreibt die Set-Plakette wieder selbst" }
        }
    }

    @Test
    fun `the text resource for the badge is gone and is not used again`() {
        // A resource that contains the same character in both languages only
        // says that someone could translate here — and that's exactly what
        // hid the difference in the first place.
        for (file in listOf("values/strings.xml", "values-de/strings.xml")) {
            val xml = File(Sources.res, "$file").readText()
            assert(!xml.contains("minifigs_qty_badge")) {
                "$file traegt den Schluessel wieder — die Plakette gehoert direkt in den Quelltext"
            }
        }
    }
}
