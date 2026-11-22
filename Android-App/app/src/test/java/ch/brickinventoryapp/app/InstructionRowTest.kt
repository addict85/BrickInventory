package ch.brickinventoryapp.app

import ch.brickinventoryapp.testing.Sources
import org.junit.Test

/**
 * The WHOLE instruction row opens the PDF — not only the icon on the right.
 *
 * ── Why this needs a check ─────────────────────────────────────────────────
 *
 * A tap area is nothing one SEES in the source: `clickable` stands
 * on a modifier, three lines above what it makes tappable. Whoever reworks the
 * row later — an icon added, the columns cut differently —
 * takes the modifier along and notices nothing, because everything still looks as
 * before.
 *
 * Therefore the STRUCTURE is checked and not that „clickable“ occurs
 * somewhere: the action (`openInstruction`) hangs on it, NO second button hangs
 * on the icon any more, and the trash keeps its own.
 */
class InstructionRowTest {

    private val source by lazy {
        Sources.withoutComments(Sources.read("collection/ui/screens/SetDetailInstructions.kt"))
    }

    /**
     * Self-proof against the silent zero: if this check reads the wrong
     * file, it finds nothing and would be green without having checked anything.
     */
    private fun rows(): List<String> {
        assert(source.contains("fun LazyListScope.setDetailInstructionsSection")) {
            "In dieser Datei steht der Anleitungs-Abschnitt nicht (mehr) — dann " +
                "prueft hier nichts etwas, und zwar lautlos."
        }
        return source.lines()
    }

    /**
     * The whole call from a match line — until the bracket balance is back at
     * zero.
     *
     * ── Why not a few lines before ─────────────────────────────────────────
     *
     * The first version of this file cut six lines above the icon
     * and checked whether an IconButton stands there. The counter-check against the
     * OLD state refuted it: there seventeen lines of action lay between `IconButton(` and the
     * icon, the window missed, and the
     * check was GREEN on the broken state. A check that does not catch its own
     * occasion checks nothing.
     *
     * Therefore the block is now read instead of estimating a surrounding.
     */
    private fun block(ab: Int): String {
        val z = rows()
        var depth = 0
        val sb = StringBuilder()
        for (i in ab until z.size) {
            sb.append(z[i]).append('\n')
            for (c in z[i]) when (c) {
                '(', '{' -> depth++
                ')', '}' -> depth--
            }
            if (i > ab && depth <= 0) break
        }
        return sb.toString()
    }

    /** The lines BEFORE a match, comments are already out. */
    private fun before(hits: String, howMany: Int): String {
        val z = rows()
        val i = z.indexOfFirst { it.contains(hits) }
        assert(i >= 0) {
            "$hits steht nicht mehr in der Datei — diese Pruefung anpassen."
        }
        return z.subList(maxOf(0, i - howMany), i).joinToString("\n")
    }

    @Test
    fun `the whole row opens the instructions`() {
        // Measured in LINES and not in characters (see Quellen): a
        // growing explanatory paragraph has already broken a check four times in this series
        // that cut a fixed character window.
        assert(Regex("""clickable\([^)]*openInstruction""").containsMatchIn(source)) {
            "Am `clickable` der Anleitungszeile haengt nicht `oeffneAnleitung`. " +
                "Dann ist wieder nur ein Teil der Zeile antippbar — genau Marcos Befund."
        }
    }

    @Test
    fun `opening does not depend on a button`() {
        // No IconButton of this file may carry the opening — neither
        // directly (onOpenPdf) nor via the named action. A button
        // next to it would be a second target for the same thing, and the screen reader
        // would name it as a separate control next to the row that already
        // does the same.
        val z = rows()
        val guilty = z.indices
            .filter { "IconButton(" in z[it] }
            .filter { i -> block(i).let { "onOpenPdf(" in it || "openInstruction" in it } }
        assert(guilty.isEmpty()) {
            "Das Oeffnen der Anleitung haengt wieder an einem IconButton " +
                "(Zeile " + guilty.joinToString { (it + 1).toString() } + "). " +
                "Dann ist nur das Symbol antippbar und nicht die Zeile — genau " +
                "Marcos Befund."
        }
    }

    @Test
    fun `the icon stays as a hint`() {
        // Without it the row looks like text. It is the only hint
        // that something opens here — tap areas are
        // invisible.
        assert(source.contains("Icons.AutoMirrored.Filled.OpenInNew")) {
            "Das Oeffnen-Symbol ist aus der Anleitungszeile verschwunden. Dann " +
                "ist nicht mehr zu sehen, dass die Zeile etwas tut."
        }
    }

    @Test
    fun `the trash stays a separate button`() {
        // Deleting must NOT hang on the row: it lies outside the
        // tappable area, as a sibling and not as a child. That way nothing depends
        // on which of two nested tap areas gets a
        // tap — and a mistap hurts here.
        assert(before("onInstructionDelete(id)", 3).contains("IconButton(")) {
            "Das Loeschen einer Anleitung haengt an keinem eigenen Knopf mehr."
        }
    }
}
