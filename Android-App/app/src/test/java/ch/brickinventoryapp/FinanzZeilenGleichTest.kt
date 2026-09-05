package ch.brickinventoryapp

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
 * Der Test liest nur Quelltext: kein Geraet, kein Compose.
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
        val s = code(read("ui/screens/FinanceSections.kt"))
        // Je einmal fuer Minifiguren und fuer Teile. Die Erfassung geht vor dem
        // Eintrag: Bei mehreren Kaeufen hat jede Zeile ihren eigenen Kaufpreis,
        // genau wie bei den Sets.
        for (feld in listOf("fig.purchasePrice", "part.purchasePrice")) {
            assert(s.contains("acq?.purchasePrice ?: $feld")) {
                "Der Kaufpreis wird fuer $feld nicht durchgereicht — die Zeile bliebe leer"
            }
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
