package ch.brickinventoryapp.finances

import ch.brickinventoryapp.contract.mapping.asView
import ch.brickinventoryapp.contract.testing.testPartsValuationResponse
import ch.brickinventoryapp.contract.testing.testPnlResponse
import ch.brickinventoryapp.contract.testing.testPnlTotals
import ch.brickinventoryapp.contract.testing.testValuationResponse
import ch.brickinventoryapp.finances.ui.financeTotals
import ch.brickinventoryapp.testing.Sources
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File
import java.math.BigDecimal

/**
 * The app does not recompute any money amounts — it shows what the server delivers.
 *
 * ── What this check does NOT flag ─────────────────────────────────────
 * Sums over quantities (`sumOf { it.quantity }`). Those are display: „x7“
 * next to a row. Only where MONEY is summed does a second version of a
 * business rule arise.
 */
class ClientRendersOnlyTest {

    @Test
    fun `the UI sums no money amounts itself`() {
        val files = Sources.below("ui")
        val money = Regex("""sumOf\s*\{[^}]{0,120}?\.(price|Price|value|Value|total|Total|purchase|Purchase)\w*""")
        val hits = mutableListOf<String>()
        // Lower bound: a file scan that finds nothing lets
        // every batch check below it pass silently.
        check(files.size >= 20) {
            "Too few Kotlin files under ui/ (${files.size}) — path outdated?"
        }
        for (f in files) {
            val code = Sources.strip(f.readText())
            for (m in money.findAll(code)) {
                val row = code.substring(0, m.range.first).count { it == '\n' } + 1
                hits += "${f.name}:$row — ${m.value.take(60)}"
            }
        }
        assert(hits.isEmpty()) {
            "The UI forms a money sum itself:\n  " + hits.joinToString("\n  ") +
                "\nThe server delivers such sums ready-made (total_value, totals.grand_total). " +
                "Two ways of calculating mean two results as soon as the rule changes."
        }
    }

    /**
     * Run since 30.10.: financeTotals() (finances/ui/FinanceRows.kt) chooses the
     * total value, both header cards call it. Counter-check (measured): there
     * grand_total ignored → red (0.20 instead of 4894.77).
     */
    @Test
    fun `the total value comes from the server`() {
        val sums = financeTotals(testValuationResponse(success = true).asView(),
            testPartsValuationResponse(success = true, totalValue = "0.20").asView(),
            null, testPnlResponse(success = true, totals = testPnlTotals(purchase = "0.00", current = "0.00", grandTotal = "4894.77")).asView())
        assertEquals(0, BigDecimal("4894.77").compareTo(sums.total))
        val sections = File(Sources.root,
            "finances/ui/screens/FinanceSections.kt").readText()
        assert(Regex("""financeTotals\(valuation, partsValuation, figsValuation, pnl\)""").findAll(sections).count() == 2) {
            "A header card no longer reads the total value via financeTotals() — then it " +
                "calculates it itself again, and the web app does the same in its own way."
        }
        // The model field must exist, otherwise the expression above reads into nothing.
        // All model files: previously a file name stood here,
        // and since then the classes are distributed by subject area.
        val models = File(Sources.root, "contract")
            .listFiles { f -> f.extension == "kt" }
            .orEmpty().sortedBy { it.name }
            .joinToString("\n") { it.readText() }
        assert(models.contains("""@SerialName("grand_total")""")) {
            "PnlTotals does not know grand_total"
        }
    }
}
