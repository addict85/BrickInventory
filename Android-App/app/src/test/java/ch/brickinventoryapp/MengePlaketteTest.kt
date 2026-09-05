package ch.brickinventoryapp

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

    @Test
    fun `manuell erfasste Kacheln schreiben das Zeichen VOR die Zahl`() {
        val teile = code(read("ui/screens/PartsScreen.kt"))
        assert(teile.contains("Text(\"×\${part.quantity}\"")) {
            "ManualPartTile schreibt die Menge nicht wie das qbadge der Webapp (×N)"
        }
        val figuren = code(read("ui/screens/MinifigsScreen.kt"))
        assert(figuren.contains("Text(\"×\${fig.quantity}\"")) {
            "ManualFigTile schreibt die Menge nicht wie das qbadge der Webapp (×N) — " +
                "und damit anders als die Teile-Kachel daneben"
        }
    }

    @Test
    fun `Kacheln aus einem Set schreiben das Zeichen HINTER die Zahl`() {
        val teile = code(read("ui/screens/PartsScreen.kt"))
        assert(teile.contains("Text(\"\${qty}×\"")) {
            "PartCard schreibt die Menge nicht wie part-qty der Webapp (N×)"
        }
        val figuren = code(read("ui/screens/MinifigsScreen.kt"))
        assert(figuren.contains("Text(\"\$qty×\"")) {
            "MinifigCard schreibt die Menge nicht wie ihr Zwilling PartCard (N×)"
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
