package ch.brickinventoryapp

import ch.brickinventoryapp.ui.mengeAusSet
import ch.brickinventoryapp.ui.mengeManuell
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Die Mengen-Plakette auf einer Kachel steht ueberall gleich herum.
 *
 * ── Woher dieser Test kommt (Nachtrag 133) ──────────────────────────────────
 *
 * Wieder ein Fund aus einer Messung statt aus einem Bericht: Beim Zaehlen
 * gleicher Achtzeiler fielen `MinifigsScreen.kt` und `PartsScreen.kt` auf. Die
 * beiden Ansichten sind Zwillinge — dieselbe Kachel, einmal fuer Teile, einmal
 * fuer Figuren. Beim Nachsehen war die Ecken-Plakette VIERMAL da, in ZWEI
 * Schreibweisen:
 *
 *     ManualPartTile   „N×"   manuell erfasstes Teil
 *     ManualFigTile    „N×"   manuell erfasste Figur   (ueber eine Textressource)
 *     PartCard         „N×"   Teil aus einem Set
 *     MinifigCard      „×N"   Figur aus einem Set
 *
 * Es ist EIN Bedienelement: dieselbe Form (Formen.marke), dieselbe Ecke
 * (TopEnd), dieselbe Schrift (labelSmall, onPrimary, fett). Nur die Zahl stand
 * mal vor und mal hinter dem Zeichen.
 *
 * ── Welche Schreibweise wo gilt ─────────────────────────────────────────────
 *
 * Nicht geraten, sondern aus der Webapp gelesen. Dort ist die Regel eindeutig:
 *
 *     man-tile   → <span class="qbadge">×N</span>    manuell erfasst
 *     part-card  → <div class="part-qty">N×</div>    aus einem Set
 *
 * (public/js/06-minifigs.js Zeilen 327 und 486 fuer die manuellen Kacheln,
 * public/js/03-parts.js Zeile 300 und 06-minifigs.js Zeile 272 fuer die aus
 * Sets.) Von den vier Stellen der App entsprach genau EINE dieser Regel.
 *
 * Die Textressource `minifigs_qty_badge` ist ersatzlos weg: „%1$d×" stand in
 * beiden Sprachen zeichengleich da. Ein Rechenzeichen ist kein Satz, und die
 * elf anderen Mengenangaben der App schreiben es auch direkt hin.
 */
class MengePlaketteTest {

    private fun read(rel: String) =
        java.io.File("src/main/java/ch/brickinventoryapp/$rel").readText()
    private fun code(s: String) = s.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    /**
     * ── Nachtrag 138: eine Stelle statt zwei ────────────────────────────────
     *
     * Hier standen zwei Pruefungen, eine je Zwillingsdatei. Seit die beiden
     * manuellen Kacheln ueber [ManuelleKachel] laufen, gibt es die Plakette nur
     * noch EINMAL — die alte Fassung suchte in PartsScreen.kt und
     * MinifigsScreen.kt und fand nichts mehr.
     *
     * Geprueft wird jetzt beides: dass die gemeinsame Kachel die Plakette in
     * der Schreibweise der Webapp traegt, UND dass die beiden Zwillinge sie
     * wirklich benutzen. Ohne das zweite koennte eine der beiden wieder eine
     * eigene Kachel bauen, und der Test bliebe still.
     */
    // Gegenprobe (30.10.2026, gemessen): mengeManuell() auf "$menge×" gestellt →
    // rot „manuell erfasst steht das Zeichen VOR der Zahl …“.
    @Test
    fun `manuell erfasst steht das Zeichen VOR der Zahl, aus einem Set dahinter`() {
        assertEquals("×3", mengeManuell(3))
        assertEquals("3×", mengeAusSet(3))
    }

    /**
     * Die Schreibweise selbst prüft der Test darüber; hier nur, dass alle vier
     * Kacheln sie benutzen. Ohne das könnte eine wieder eine eigene bauen.
     */
    @Test
    fun `alle Kacheln holen die Plakette von derselben Stelle`() {
        assert(code(read("ui/screens/ManualItemComposables.kt")).contains("mengeManuell(menge)")) {
            "ManuelleKachel schreibt die Menge wieder selbst"
        }
        for ((datei, wer) in listOf(
            "ui/screens/PartsScreen.kt" to "ManualPartTile",
            "ui/screens/MinifigsScreen.kt" to "ManualFigTile",
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
    fun `die Textressource fuer die Plakette ist weg und wird nicht wieder benutzt`() {
        // Eine Ressource, die in beiden Sprachen dasselbe Zeichen enthaelt, sagt
        // nur, dass hier jemand uebersetzen koennte — und genau das hat den
        // Unterschied ueberhaupt erst verdeckt.
        for (datei in listOf("values/strings.xml", "values-de/strings.xml")) {
            val xml = java.io.File("src/main/res/$datei").readText()
            assert(!xml.contains("minifigs_qty_badge")) {
                "$datei traegt den Schluessel wieder — die Plakette gehoert direkt in den Quelltext"
            }
        }
    }
}
