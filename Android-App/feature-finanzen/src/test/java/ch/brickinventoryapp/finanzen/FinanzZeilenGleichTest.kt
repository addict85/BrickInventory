package ch.brickinventoryapp.finanzen

import ch.brickinventoryapp.model.ui.model.BewertungsKaufAnsicht
import ch.brickinventoryapp.model.ui.model.ManuelleFigurAnsicht
import ch.brickinventoryapp.model.ui.model.ManuellesTeilAnsicht
import ch.brickinventoryapp.finanzen.ui.figurZeilen
import ch.brickinventoryapp.finanzen.ui.teilZeilen
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
 * Die Wahl des Kaufpreises (Erfassung vor Eintrag) läuft in finanzen/ui/Finanzzeilen.kt
 * und wird hier ausgeführt; dass die Zeilen ihn zeigen, prüft FinanzKaufpreisZeilenTest
 * (app) gezeichnet.
 *
 * Gegenprobe: in teilZeilen() `acq?.purchasePrice ?:
 * p.purchasePrice` durch `p.purchasePrice` ersetzt → rot „beide Aufrufstellen
 * reichen den Kaufpreis durch“ (150.0 statt 120.0).
 */
class FinanzZeilenGleichTest {

    @Test
    fun `beide Aufrufstellen reichen den Kaufpreis durch`() {
        // Die Erfassung geht vor dem Eintrag: Bei mehreren Kaeufen hat jede Zeile
        // ihren eigenen Kaufpreis, genau wie bei den Sets.
        val kaeufe = listOf(BewertungsKaufAnsicht(id = 1, purchasePrice = 120.0),
                            BewertungsKaufAnsicht(id = 2, purchasePrice = 80.0))
        val teil = ManuellesTeilAnsicht(id = 1, partNumber = "3001", purchasePrice = 150.0, acquisitions = kaeufe)
        val figur = ManuelleFigurAnsicht(id = 2, figNumber = "sw0001", purchasePrice = 150.0, acquisitions = kaeufe)
        assertEquals(listOf(120.0, 80.0), teilZeilen(listOf(teil)).map { it.second.kaufpreis })
        assertEquals(listOf(120.0, 80.0), figurZeilen(listOf(figur)).map { it.second.kaufpreis })
        assertEquals(listOf(150.0), teilZeilen(listOf(teil.copy(acquisitions = emptyList()))).map { it.second.kaufpreis })
    }
}
