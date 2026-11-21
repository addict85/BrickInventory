package ch.brickinventoryapp.finances

import ch.brickinventoryapp.contract.mapping.alsAnsicht
import ch.brickinventoryapp.contract.PartsValuationResponse
import ch.brickinventoryapp.contract.PnlResponse
import ch.brickinventoryapp.contract.PnlTotals
import ch.brickinventoryapp.contract.ValuationResponse
import ch.brickinventoryapp.finances.ui.finanzSummen
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File
import java.math.BigDecimal
import ch.brickinventoryapp.testing.Quellen

/**
 * The app does not recompute any money amounts — it shows what the server delivers.
 *
 * ── What this check does NOT flag ─────────────────────────────────────
 * Sums over quantities (`sumOf { it.quantity }`). Those are display: „x7"
 * next to a row. Only where MONEY is summed does a second version of a
 * business rule arise.
 */
class ClientRendersOnlyTest {

    @Test
    fun `the UI sums no money amounts itself`() {
        val dateien = Quellen.unter("ui")
        val money = Regex("""sumOf\s*\{[^}]{0,120}?\.(price|Price|value|Value|total|Total|purchase|Purchase)\w*""")
        val treffer = mutableListOf<String>()
        // Lower bound: a file scan that finds nothing lets
        // every batch check below it pass silently.
        check(dateien.size >= 20) {
            "Zu wenige Kotlin-Dateien unter ui/ (${dateien.size}) — Pfad veraltet?"
        }
        for (f in dateien) {
            val code = Quellen.strip(f.readText())
            for (m in money.findAll(code)) {
                val zeile = code.substring(0, m.range.first).count { it == '\n' } + 1
                treffer += "${f.name}:$zeile — ${m.value.take(60)}"
            }
        }
        assert(treffer.isEmpty()) {
            "Die Oberfläche bildet eine Geldsumme selbst:\n  " + treffer.joinToString("\n  ") +
                "\nDer Server liefert solche Summen fertig (total_value, totals.grand_total). " +
                "Zwei Rechenwege bedeuten zwei Ergebnisse, sobald sich die Regel ändert."
        }
    }

    /**
     * Run since 30.10.: finanzSummen() (finances/ui/Finanzzeilen.kt) chooses the
     * total value, both header cards call it. Counter-check (measured): there
     * grand_total ignored → red (0.20 instead of 4894.77).
     */
    @Test
    fun `the total value comes from the server`() {
        val sums = finanzSummen(ValuationResponse(success = true).alsAnsicht(),
            PartsValuationResponse(success = true, totalValue = "0.20").alsAnsicht(),
            null, PnlResponse(success = true, totals = PnlTotals(purchase = "0.00", current = "0.00", grandTotal = "4894.77")).alsAnsicht())
        assertEquals(0, BigDecimal("4894.77").compareTo(sums.gesamt))
        val sections = File(Quellen.root,
            "finances/ui/screens/FinanceSections.kt").readText()
        assert(Regex("""finanzSummen\(valuation, partsValuation, figsValuation, pnl\)""").findAll(sections).count() == 2) {
            "Eine Kopfkarte liest den Gesamtwert nicht mehr über finanzSummen() — dann rechnet " +
                "sie ihn wieder selbst, und die Webapp tut dasselbe auf ihre Art."
        }
        // The model field must exist, otherwise the expression above reads into nothing.
        // All model files: previously a file name stood here,
        // and since then the classes are distributed by subject area.
        val models = File(Quellen.root, "contract")
            .listFiles { f -> f.extension == "kt" }
            .orEmpty().sortedBy { it.name }
            .joinToString("\n") { it.readText() }
        assert(models.contains("""@SerialName("grand_total")""")) {
            "PnlTotals kennt grand_total nicht"
        }
    }
}
