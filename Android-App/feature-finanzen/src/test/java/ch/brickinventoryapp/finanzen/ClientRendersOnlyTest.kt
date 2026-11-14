package ch.brickinventoryapp.finanzen

import ch.brickinventoryapp.vertrag.abbildung.alsAnsicht
import ch.brickinventoryapp.vertrag.PartsValuationResponse
import ch.brickinventoryapp.vertrag.PnlResponse
import ch.brickinventoryapp.vertrag.PnlTotals
import ch.brickinventoryapp.vertrag.ValuationResponse
import ch.brickinventoryapp.finanzen.ui.finanzSummen
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File
import java.math.BigDecimal
import ch.brickinventoryapp.testing.Quellen

/**
 * Die App rechnet keine Geldbeträge nach — sie zeigt, was der Server liefert.
 *
 * ── Was diese Prüfung NICHT beanstandet ─────────────────────────────────────
 * Summen über Stückzahlen (`sumOf { it.quantity }`). Die sind Anzeige: „x7"
 * neben einer Zeile. Erst wo GELD summiert wird, entsteht eine zweite Fassung
 * einer Geschäftsregel.
 */
class ClientRendersOnlyTest {

    @Test
    fun `die Oberflaeche summiert keine Geldbetraege selbst`() {
        val dateien = Quellen.unter("ui")
        val geld = Regex("""sumOf\s*\{[^}]{0,120}?\.(price|Price|value|Value|total|Total|purchase|Purchase)\w*""")
        val treffer = mutableListOf<String>()
        // Untergrenze: Ein Dateilauf, der nichts findet, lässt
        // jede Sammelprüfung darunter stillschweigend bestehen.
        check(dateien.size >= 20) {
            "Zu wenige Kotlin-Dateien unter ui/ (${dateien.size}) — Pfad veraltet?"
        }
        for (f in dateien) {
            val code = Quellen.entkleide(f.readText())
            for (m in geld.findAll(code)) {
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
     * Seit dem 30.10. ausgeführt: finanzSummen() (finanzen/ui/Finanzzeilen.kt) wählt den
     * Gesamtwert, beide Kopfkarten rufen sie. Gegenprobe (gemessen): dort
     * grand_total übergangen → rot (0.20 statt 4894.77).
     */
    @Test
    fun `der Gesamtwert kommt vom Server`() {
        val summen = finanzSummen(ValuationResponse(success = true).alsAnsicht(),
            PartsValuationResponse(success = true, totalValue = "0.20").alsAnsicht(),
            null, PnlResponse(success = true, totals = PnlTotals(purchase = "0.00", current = "0.00", grandTotal = "4894.77")).alsAnsicht())
        assertEquals(0, BigDecimal("4894.77").compareTo(summen.gesamt))
        val sections = File(Quellen.wurzel,
            "finanzen/ui/screens/FinanceSections.kt").readText()
        assert(Regex("""finanzSummen\(valuation, partsValuation, figsValuation, pnl\)""").findAll(sections).count() == 2) {
            "Eine Kopfkarte liest den Gesamtwert nicht mehr über finanzSummen() — dann rechnet " +
                "sie ihn wieder selbst, und die Webapp tut dasselbe auf ihre Art."
        }
        // Das Modellfeld muss es geben, sonst liest der Ausdruck oben ins Leere.
        // Alle Modelldateien: Vorher stand hier ein Dateiname,
        // und die Klassen liegen seither nach Sachgebieten verteilt.
        val models = File(Quellen.wurzel, "vertrag")
            .listFiles { f -> f.extension == "kt" }
            .orEmpty().sortedBy { it.name }
            .joinToString("\n") { it.readText() }
        assert(models.contains("""@SerialName("grand_total")""")) {
            "PnlTotals kennt grand_total nicht"
        }
    }
}
