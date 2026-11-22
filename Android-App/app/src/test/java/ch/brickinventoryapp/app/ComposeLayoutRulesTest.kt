package ch.brickinventoryapp.app

import ch.brickinventoryapp.testing.Sources
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Two layout rules of the UI that can only be seen in the source (structure check).
 * A FlowRow inside a Row has no room to wrap and puts every chip on its own
 * line; the common table row must tell the screen reader what tapping does.
 *
 * Counter-checks (patches under counter-checks/):
 *   flowrow-in-row          FlowRow of the household members put into a Row → red “no FlowRow …”
 *   tabellenzeile-stumm     TableRow does not pass onClickLabel to clickable → red “the table row …”
 */
class ComposeLayoutRulesTest {

    private val call = Regex("""^(?:[A-Za-z_][\w.]*\.)?([A-Z]\w*)\s*\(""")

    /** The nearest enclosing composable call of a line, found by indentation. */
    private fun parent(rows: List<String>, nr: Int): Pair<String, Int>? {
        var depth = rows[nr].length - rows[nr].trimStart().length
        for (i in nr - 1 downTo 0) {
            val z = rows[i]
            if (z.isBlank()) continue
            val e = z.length - z.trimStart().length
            if (e >= depth) continue
            call.find(z.trim())?.let { return it.groupValues[1] to i + 1 }
            depth = e
        }
        return null
    }

    @Test
    fun `no FlowRow in a horizontal Row`() {
        var flowRows = 0
        val findings = Sources.below("ui").filterNot { "/ui/theme/" in it.invariantSeparatorsPath }.flatMap { f ->
            val rows = Sources.withoutComments(f.readText()).lines()
            rows.indices.filter { Regex("""\bFlowRow\s*\(""").containsMatchIn(rows[it]) }.mapNotNull { i ->
                flowRows++
                parent(rows, i)?.takeIf { it.first in setOf("Row", "LazyRow") }
                    ?.let { "${f.name}:${i + 1} — FlowRow in ${it.first} (Zeile ${it.second})" }
            }
        }
        assertTrue("Only $flowRows FlowRows found — does the search still apply?", flowRows >= 4)
        assertTrue("A FlowRow belongs in a Column, not in a Row:\n" + findings.joinToString("\n"), findings.isEmpty())
    }

    @Test
    fun `the table row tells the screen reader what tapping does`() {
        val row = Sources.withoutComments(Sources.read("shared/ui/TableRow.kt"))
        assertTrue("TableRow takes no label for screen readers",
            row.contains("onClickLabel: String? = null"))
        assertTrue("TableRow does not pass the label on to clickable",
            Regex("""clickable\(onClickLabel = onClickLabel,[^)]*\bonClick = onClick\)""").containsMatchIn(row))
    }
}
