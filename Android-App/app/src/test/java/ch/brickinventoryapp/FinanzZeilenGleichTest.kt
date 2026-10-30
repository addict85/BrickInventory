package ch.brickinventoryapp

import ch.brickinventoryapp.data.model.FigValuationItem
import ch.brickinventoryapp.data.model.PartValuationItem
import ch.brickinventoryapp.data.model.ValuationAcquisition
import ch.brickinventoryapp.ui.figurZeilen
import ch.brickinventoryapp.ui.teilZeilen
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Die zwei Zeilen der Finanztabelle zeigen dasselbe.
 *
 * ── Woher dieser Test kommt (Nachtrag 133) ──────────────────────────────────
 *
 * Nicht aus einem Fehlerbericht, sondern aus einer Messung: Eine Suche nach
 * gleichen Achtzeilern ueber den ganzen App-Baum meldete `FinanceScreen.kt` und
 * `FinanceSections.kt` mit demselben Block. Beim Nachsehen war es zweimal
 * dieselbe Zeile — einmal fuer Sets, einmal fuer manuell erfasste Teile und
 * Minifiguren — und der UNTERSCHIED war der Fund:
 *
 *     Set-Zeile      Marktpreis, darunter „Kauf: X", darunter die Entwicklung
 *     Manuelle Zeile Marktpreis, darunter die Entwicklung   ← kein Kaufpreis
 *
 * Die Webapp zeigt den Kaufpreis in BEIDEN Tabellen (public/js/04-finance.js,
 * `pmRow`, Spalte `detail.purchase_price`). Die App hatte die Zahl im Speicher
 * — PartValuationItem, FigValuationItem und ValuationAcquisition tragen alle
 * `purchase_price` —, sie kam nur nie auf den Bildschirm.
 *
 * Die Wahl des Kaufpreises (Erfassung vor Eintrag) läuft in ui/Finanzzeilen.kt
 * und wird ausgeführt; dass die Karte ihn zeigt, prüft der Quelltext.
 *
 * Gegenprobe (30.10.2026, gemessen): in teilZeilen() `acq?.purchasePrice ?:
 * p.purchasePrice` durch `p.purchasePrice` ersetzt → rot „beide Aufrufstellen
 * reichen den Kaufpreis durch“ (150.0 statt 120.0).
 */
class FinanzZeilenGleichTest {

    private fun read(rel: String) =
        java.io.File("src/main/java/ch/brickinventoryapp/$rel").readText()
    private fun code(s: String) = s.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    @Test
    fun `die Zeile fuer manuelle Eintraege zeigt den Kaufpreis`() {
        val s = code(read("ui/screens/FinanceScreen.kt"))
        assert(s.contains("purchaseStr: String? = null")) {
            "ManualFinanceRow nimmt keinen Kaufpreis mehr entgegen — die Zeile fuer " +
                "Teile und Minifiguren zeigt dann weniger als die Set-Zeile daneben"
        }
        assert(s.contains("R.string.finance_purchase_short, it")) {
            "Der Kaufpreis wird nicht angezeigt. Dieselbe Beschriftung wie in der " +
                "Set-Zeile ist Absicht: Beide Tabellen sollen gleich aussehen"
        }
    }

    @Test
    fun `beide Aufrufstellen reichen den Kaufpreis durch`() {
        // Die Erfassung geht vor dem Eintrag: Bei mehreren Kaeufen hat jede Zeile
        // ihren eigenen Kaufpreis, genau wie bei den Sets.
        val kaeufe = listOf(ValuationAcquisition(id = 1, purchasePrice = 120.0),
                            ValuationAcquisition(id = 2, purchasePrice = 80.0))
        val teil = PartValuationItem(id = 1, partNumber = "3001", purchasePrice = 150.0, acquisitions = kaeufe)
        val figur = FigValuationItem(id = 2, figNumber = "sw0001", purchasePrice = 150.0, acquisitions = kaeufe)
        assertEquals(listOf(120.0, 80.0), teilZeilen(listOf(teil)).map { it.second.kaufpreis })
        assertEquals(listOf(120.0, 80.0), figurZeilen(listOf(figur)).map { it.second.kaufpreis })
        assertEquals(listOf(150.0), teilZeilen(listOf(teil.copy(acquisitions = emptyList()))).map { it.second.kaufpreis })

        val s = code(read("ui/screens/FinanceSections.kt"))
        assert(Regex("""purchaseStr = zeile\.kaufpreis""").findAll(s).count() == 2) {
            "Teile und Minifiguren reichen den Kaufpreis nicht durch — die Zeile bliebe leer"
        }
    }

    @Test
    fun `die Set-Zeile zeigt ihn weiterhin`() {
        val s = code(read("ui/screens/FinanceSections.kt"))
        assert(s.contains("R.string.finance_purchase_short")) {
            "Die Set-Zeile hat ihren Kaufpreis verloren — dann stimmt zwar wieder " +
                "beides ueberein, aber auf der falschen Seite"
        }
    }
}
