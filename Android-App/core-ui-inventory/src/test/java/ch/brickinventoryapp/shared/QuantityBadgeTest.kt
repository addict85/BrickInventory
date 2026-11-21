package ch.brickinventoryapp.shared

import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.Quellen
import ch.brickinventoryapp.shared.ui.mengeAusSet
import ch.brickinventoryapp.shared.ui.mengeManuell

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
        File(Quellen.root, "$rel").readText()
    private fun code(s: String) = s.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    /**
     */
    // Counter-checks: mengeAusSet() reverted to "$menge×" → red;
    // mengeManuell() to "$menge×" → red.
    @Test
    fun `the quantity stands everywhere as a symbol before the number`() {
        assertEquals("×3", mengeManuell(3))
        assertEquals("×3", mengeAusSet(3))
    }

    /**
     * The notation itself is checked by the test above; here only that all four
     * tiles use it. Without this, one could start building its own again.
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
        // A resource that contains the same character in both languages only
        // says that someone could translate here — and that's exactly what
        // hid the difference in the first place.
        for (datei in listOf("values/strings.xml", "values-de/strings.xml")) {
            val xml = File(Quellen.res, "$datei").readText()
            assert(!xml.contains("minifigs_qty_badge")) {
                "$datei traegt den Schluessel wieder — die Plakette gehoert direkt in den Quelltext"
            }
        }
    }
}
