package ch.brickinventoryapp.app

import ch.brickinventoryapp.testing.Sources
import org.junit.Test

/**
 * Where a number belongs, the number pad appears.
 *
 * ── How to recognize a number field ──────────────────────────────────────────
 *
 * Not by the label — „Teilenummer“ sounds like a number and is
 * „3001pb01“, „Figurennummer“ is „sw0001“. A number pad would make
 * both unusable.
 *
 * But by the field sending its input through one of the filters from
 * ui/util/NumericInput.kt. Whoever writes `NumericInput.quantity()` has
 * already decided that only digits belong here — then the
 * keyboard must follow. The two belong together, and this rule records
 * exactly that.
 *
 * ── Why the filter is not enough and neither is the keyboard ─────────────────
 *
 * The filter without keyboard: one is offered the letters, types them,
 * and they disappear again while typing. That looks like an error.
 *
 * The keyboard without filter: an attached keyboard, the clipboard
 * and some on-screen keyboards deliver letters anyway. The value
 * then lands as text in the field and only stands out on conversion — silently,
 * as zero.
 *
 * ── Counter-checks ─────────────────────
 *
 *   keyboard gone in the catalog detail, filter stays → red “whoever filters numbers also shows …”
 *   filter gone at the alert threshold, keyboard stays → red “whoever shows the number pad also filters”
 *   The price comparison's field is rendered in ComparisonSearchFieldTest (feature-collection).
 */
class NumberPadTest {

    /**
     * Every TextField call including body and line number.
     *
     * The line number stands here because the error message would otherwise only name the
     * file — and CatalogDetailScreen.kt has seven text fields. The superseded
     * version in NumericInputTest could do that; that should not get lost
     * in the move.
     */
    private fun textFields(source: String): List<Pair<Int, String>> {
        val blocks = mutableListOf<Pair<Int, String>>()
        var i = Regex("""\b(Outlined)?TextField\(""").find(source)?.range?.first ?: return blocks
        while (true) {
            var depth = 0
            var j = source.indexOf('(', i)
            var end = j
            while (end < minOf(j + 4000, source.length)) {
                when (source[end]) {
                    '(' -> depth++
                    ')' -> { depth--; if (depth == 0) break }
                }
                end++
            }
            val row = source.substring(0, i).count { c -> c == '\n' } + 1
            blocks += row to source.substring(i, minOf(end + 1, source.length))
            i = Regex("""\b(Outlined)?TextField\(""")
                .find(source, minOf(end + 1, source.length))?.range?.first ?: break
        }
        return blocks
    }

    private val filter = Regex("""NumericInput\.(setNumber|quantity|price)\b""")
    private val keyboard = Regex(
        """keyboardType\s*=\s*KeyboardType\.\w+|NumericInput\.(ganzzahl|price|setNumber)Tastatur|NumericInput\.(integer|price|setNumber)Keyboard""")

    /**
     * Only the NUMBER keyboards — Email, Password and Phone do not belong
     * to them. `Number` and `Decimal` are exactly the two that NumericInput
     * outputs.
     */
    private val numberPad = Regex(
        """KeyboardType\.(Number|Decimal)\b|NumericInput\.(ganzzahl|price)Tastatur|NumericInput\.(integer|price)Keyboard""")

    @Test
    fun `whoever filters numbers also shows the number pad`() {
        val error = mutableListOf<String>()
        var seen = 0
        for (file in Sources.all()) {
            val s = Sources.withoutComments(file.readText())
            for ((row, blk) in textFields(s)) {
                if (!filter.containsMatchIn(blk)) continue
                seen++
                if (!keyboard.containsMatchIn(blk)) error += "${file.name}:$row"
            }
        }
        // Self-proof against the silent zero: does the search find any
        // fields at all? Without that an empty error list would be green forever.
        assert(seen >= 15) { "Only $seen filtered fields found — pattern outdated?" }
        assert(error.isEmpty()) {
            "These fields only allow digits but offer the text keyboard:\n  " +
                error.joinToString("\n  ") +
                "\nThe filter from NumericInput belongs together with the matching keyboard."
        }
    }

    /**
     * The opposite direction: whoever shows the number pad also filters.
     *
     * ── Why this rule exists ─────────────────────────────────────────────────
     *
     * The rule above hangs on the FILTER. It thus fundamentally cannot see a field that has the
     * keyboard and not the filter — it already falls out of its loop
     * in the first line. This rule asks the other way round.
     *
     * FOUND thereby (measured, not estimated): 21 fields with a
     * number pad, of which 2 without filter —
     *   · SettingsScreen.kt, threshold of an existing price alert
     *   · SetDetailSections.kt, threshold when creating
     *
     * ── Why the missing half here is the more dangerous one ──────────────────
     *
     * Filter without keyboard is ugly: one types letters and they
     * disappear again. One SEES it.
     *
     * Keyboard without filter is silent. The keyboard choice is a request to the
     * keyboard app, not a guarantee — a plugged-in keyboard and the
     * clipboard deliver letters anyway. In the field in SettingsScreen
     * that became a threshold of 0 via `?: 0.0`.
     */
    @Test
    fun `whoever shows the number pad also filters`() {
        val error = mutableListOf<String>()
        var seen = 0
        for (file in Sources.all()) {
            val s = Sources.withoutComments(file.readText())
            for ((row, blk) in textFields(s)) {
                if (!numberPad.containsMatchIn(blk)) continue
                seen++
                if (!filter.containsMatchIn(blk)) error += "${file.name}:$row"
            }
        }
        // Self-proof against the silent zero, measured on 28.09.: 21.
        assert(seen >= 15) { "Only $seen fields with the number keyboard — pattern outdated?" }
        assert(error.isEmpty()) {
            "These fields show the number keyboard but let everything in:\n  " +
                error.joinToString("\n  ") +
                "\nThe keyboard choice is a request, not a guarantee — the filter is missing."
        }
    }
}
