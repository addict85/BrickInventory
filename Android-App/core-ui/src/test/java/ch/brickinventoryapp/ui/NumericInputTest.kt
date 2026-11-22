package ch.brickinventoryapp.ui

import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import ch.brickinventoryapp.testing.Sources
import ch.brickinventoryapp.ui.util.NumericInput
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Number fields: number pad and allowed characters — one version.
 *
 * ── Why the two belong together ─────────────────────────────────────────────
 * The keyboard choice is a REQUEST to the keyboard app, not a guarantee: many
 * keyboards show a switch key to letters on `Number` regardless, and
 * pasting from the clipboard lets everything in anyway. That's why
 * every number field needs both: the filter and the keyboard choice.
 *
 * Since Sep 28, this is where the FILTERING lives — what NumericInput does with an
 * input — and the special rule for the set-number fields, which recognizes its
 * fields by their label. The collective rule "every filtered field
 * also shows the number pad" lives in NumberPadTest; see the
 * note below, where it used to be.
 *
 * Since Nov 8 the set number also lets letters through (llca30, comcon001), like
 * the web app's normalizeSetNumber; its fields show the text keyboard for that.
 * Counter-check (counter-checks/setnummer-nur-ziffern.patch): the filter back to only
 * digits and "-" → red „die Setnummer laesst Buchstaben und Ziffern durch …“.
 *
 * Amount and quantity: readAmount follows the web app's readAmount (`format.js`).
 * Counter-check (counter-checks/betrag-tausenderpunkt.patch): price() cuts off again at the
 * second separator → red „a pasted number with thousands separator keeps its value“.
 */
class NumericInputTest {

    private fun code(s: String) = s.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    // ── Die Filterung ────────────────────────────────────────────────────────

    @Test
    fun `the set number lets letters and digits through, nothing else`() {
        assertEquals("42200", NumericInput.setNumber("42200"))
        // Like the web app's normalizeSetNumber: letters and digits, the rest is dropped.
        assertEquals("llca30", NumericInput.setNumber("llca30"))
        assertEquals("comcon001", NumericInput.setNumber("comcon001"))
        assertEquals("42200xyz", NumericInput.setNumber("42 200 xyz"))
        assertEquals("PoliceTruck", NumericInput.setNumber("Police Truck!"))
        assertEquals("", NumericInput.setNumber("äö €#"))
        // Non-ASCII digits (Arabic-Indic) and umlauts didn't hit a line in the web app.
        assertEquals("", NumericInput.setNumber("\u0663\u00e4"))
    }

    @Test
    fun `the set number keyboard is a text keyboard without capitalization`() {
        val t = NumericInput.setNumberKeyboard()
        assertEquals(KeyboardType.Ascii, t.keyboardType)
        assertEquals(KeyboardCapitalization.None, t.capitalization)
        assertEquals(ImeAction.Done, NumericInput.setNumberKeyboard(ImeAction.Done).imeAction)
    }

    @Test
    fun `the variant hyphen stays allowed`() {
        // LEGO set numbers carry the variant after the hyphen (10179-2). If the
        // field forbade it, no variant but the first could be entered anymore.
        assertEquals("10179-2", NumericInput.setNumber("10179-2"))
    }

    /**
     * Counter-check: setNumberPattern shortened to `\d+` → "10294-1" red; widened to `.*` → "--" red.
     */
    @Test
    fun `a set number has digits and at most one variant`() {
        for (good in listOf("10294", "10294-1", "75192-12", " 75192 ")) assertEquals(good, true, NumericInput.isSetNumber(good))
        for (bad in listOf("", "-", "--", "10294-", "-1", "1-2-3", "10294-1234", "abc!!")) {
            assertEquals(bad, false, NumericInput.isSetNumber(bad))
        }
    }

    @Test
    fun `the quantity takes only digits`() {
        assertEquals("12", NumericInput.quantity("1x2"))
        assertEquals("12", NumericInput.quantity("-12"))
        assertEquals("", NumericInput.quantity("zwei"))
    }

    @Test
    fun `the price takes exactly one separator`() {
        assertEquals("12.50", NumericInput.price("12.50"))
        assertEquals("12,50", NumericInput.price("12,50"))   // deutsche Tastatur
        // Without this limit, "12.3.4" would be typeable and would only surface on
        // conversion — then silently turning into a price of null.
        assertEquals("12.34", NumericInput.price("12.3.4"))
        assertEquals("1250", NumericInput.price("CHF 1250"))
    }

    @Test
    fun `an amount is read as in the web app`() {
        val de = '.'
        val en = ','
        // Both spellings with thousands separator, the same in every language.
        assertEquals(1299.0, NumericInput.readAmount("1.299,00", de)!!, 0.0)
        assertEquals(1299.0, NumericInput.readAmount("1.299,00", en)!!, 0.0)
        assertEquals(1299.5, NumericInput.readAmount("1,299.50", de)!!, 0.0)
        assertEquals(1299.5, NumericInput.readAmount("1,299.50", en)!!, 0.0)
        assertEquals(1234567.0, NumericInput.readAmount("1.234.567", de)!!, 0.0)
        assertEquals(149.95, NumericInput.readAmount("149,95", de)!!, 0.0)
        assertEquals(149.95, NumericInput.readAmount("149.95", en)!!, 0.0)
        assertEquals(12.0, NumericInput.readAmount("12,", de)!!, 0.0)
        assertEquals(0.5, NumericInput.readAmount(",5", de)!!, 0.0)
        assertEquals(1299.0, NumericInput.readAmount("1'299.00", en)!!, 0.0)
        assertEquals(12.5, NumericInput.readAmount("€ 12,50", de)!!, 0.0)
        // A single separator before three digits: a thousands separator only if it is the grouping character.
        assertEquals(1299.0, NumericInput.readAmount("1.299", de)!!, 0.0)
        assertEquals(1.299, NumericInput.readAmount("1.299", en)!!, 0.0)
        assertEquals(1.299, NumericInput.readAmount("1,299", de)!!, 0.0)
        assertEquals(1299.0, NumericInput.readAmount("1,299", en)!!, 0.0)
        assertEquals(0.123, NumericInput.readAmount("0.123", de)!!, 0.0)
    }

    @Test
    fun `an unreadable amount is null, an empty one too, but only the unreadable one is invalid`() {
        for (raw in listOf("", " ", ".", ",", "12.3.4", "1.29.900", "12,50.1", "abc", "1,2,3")) {
            assertEquals("'$raw'", null, NumericInput.readAmount(raw, '.'))
        }
        assertEquals(false, NumericInput.priceInvalid("", '.'))
        assertEquals(false, NumericInput.priceInvalid("1.299,00", '.'))
        assertEquals(true, NumericInput.priceInvalid(",", '.'))
        assertEquals(true, NumericInput.priceInvalid("12.3.4", '.'))
    }

    @Test
    fun `a pasted number with thousands separator keeps its value`() {
        // Cutting off at the second separator turned "1.299,00" into the price 1,299.
        assertEquals("1299,00", NumericInput.price("1.299,00", '.'))
        assertEquals("1299.50", NumericInput.price("1,299.50", ','))
        assertEquals("1299000", NumericInput.price("1.299.000", '.'))
        // While typing: the second separator after the thousands sets the decimal mark.
        assertEquals("1299,", NumericInput.price("1.299,", '.'))
        // No valid amount with two separators: as before, the first separator wins.
        assertEquals("12.34", NumericInput.price("12.3.4", '.'))
        // The filtered text gives the same value as the pasted one.
        assertEquals(1299.0, NumericInput.readAmount(NumericInput.price("1.299,00", '.'), '.')!!, 0.0)
    }

    @Test
    fun `a quantity is empty or a number from 1`() {
        assertEquals(false, NumericInput.quantityInvalid(""))
        assertEquals(false, NumericInput.quantityInvalid("1"))
        assertEquals(false, NumericInput.quantityInvalid("250"))
        assertEquals(true, NumericInput.quantityInvalid("0"))
        assertEquals(true, NumericInput.quantityInvalid("00"))
        // Over Int: this used to silently become 1.
        assertEquals(true, NumericInput.quantityInvalid("99999999999"))
    }

    // ── Die Tastatur ─────────────────────────────────────────────────────────

    /**
     * Every OutlinedTextField call in the source tree: file, line, whole call.
     *
     * The call's end is found via bracket balance, not a fixed
     * window — a window reached into the next call (the trap
     * that has already struck five times in this project). Read without
     * comment lines: otherwise a comment that names the sought name
     * would be enough, and the rule would be satisfied.
     */
    private fun textFields(): List<Triple<String, Int, String>> {
        val files = Sources.root
            .walkTopDown().filter { it.extension == "kt" }.toList()
            .also {
                // Lower bound: an empty file run would let any
                // collective check below it pass silently.
                check(it.size >= 20) { "Too few Kotlin files found (${it.size}) — path outdated?" }
            }
        val hits = mutableListOf<Triple<String, Int, String>>()
        for (file in files) {
            val s = code(file.readText())
            var pos = 0
            while (true) {
                val i = s.indexOf("OutlinedTextField(", pos)
                if (i < 0) break
                var depth = 0
                var j = i + "OutlinedTextField".length
                var k = j
                while (k < s.length) {
                    if (s[k] == '(') depth++
                    else if (s[k] == ')') { depth--; if (depth == 0) { j = k; break } }
                    k++
                }
                val row = s.substring(0, i).count { c -> c == '\n' } + 1
                hits += Triple(file.name, row, s.substring(i, minOf(j + 1, s.length)))
                pos = j + 1
            }
        }
        check(hits.size >= 10) { "Only ${hits.size} text fields found — does the search still apply?" }
        return hits
    }

    // ── Here stood „kein Zahlenfeld steht ohne Tastaturwahl da“ ──────────────
    //
    // The rule hasn't gone away, it has moved: to
    // NumberPadTest, „wer Zahlen filtert, zeigt auch die Zahlentastatur“
    // . Both said the same thing — a field with a NumericInput
    // filter needs the matching keyboard —, and the counter-check on Sep 28.
    //
    // What remained is the sharper of the two:
    //   · It also sees `TextField(`, not only `OutlinedTextField(`.
    //
    // Two versions of the same rule aren't doubly safe but
    // dangerous: whoever defuses one doesn't see the other, and whoever
    // sees both ends up maintaining only the one that turns red first.

    @Test
    fun `every set number field takes filter and number pad`() {
        // Also a field that isn't built as a number field; recognized by the label,
        // which survives a rename of the state variable.
        val fields = textFields().filter { (_, _, block) ->
            Regex("""R\.string\.[A-Za-z0-9_]*set_number[A-Za-z0-9_]*""").containsMatchIn(block)
        }
        // Three today: gallery ("Add set"), watchlist and
        // parts list. Fewer means: the search no longer catches it.
        assert(fields.size >= 3) {
            "Only ${fields.size} set number fields found — does the search still apply?"
        }
        val gaps = mutableListOf<String>()
        for ((file, row, block) in fields) {
            if (!block.contains("NumericInput.setNumber("))
                gaps += "$file:$row (without filter)"
            if (!block.contains("keyboardOptions"))
                gaps += "$file:$row (without keyboard choice)"
        }
        assert(gaps.isEmpty()) {
            "Set number fields without the pair from NumericInput: " +
                "${gaps.joinToString(", ")} — the letter keyboard opens there"
        }
    }

    @Test
    fun `no view filters numbers itself any more`() {
        // Otherwise there would again be several versions of the same rule — and the
        // price version with only ONE separator would be missing from the others.
        val files = Sources.root
            .walkTopDown().filter { it.extension == "kt" && it.name != "NumericInput.kt" }
        for (file in files) {
            val s = code(file.readText())
            assert(!s.contains("filter(Char::isDigit)")) {
                "${file.name} filters digits itself — that belongs in NumericInput"
            }
            assert(!s.contains("c.isDigit() || c == '.'")) {
                "${file.name} filters prices itself — that belongs in NumericInput"
            }
        }
    }
}
