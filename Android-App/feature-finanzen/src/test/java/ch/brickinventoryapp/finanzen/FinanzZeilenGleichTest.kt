package ch.brickinventoryapp.finanzen

import ch.brickinventoryapp.model.fach.Geld
import ch.brickinventoryapp.model.fach.BewertungsKaufAnsicht
import ch.brickinventoryapp.model.fach.ManuelleFigurAnsicht
import ch.brickinventoryapp.model.fach.ManuellesTeilAnsicht
import ch.brickinventoryapp.finanzen.ui.figurZeilen
import ch.brickinventoryapp.finanzen.ui.teilZeilen
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Die zwei Zeilen der Finanztabelle zeigen dasselbe.
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
        val kaeufe = listOf(BewertungsKaufAnsicht(id = 1, purchasePrice = Geld.aus(120.0)),
                            BewertungsKaufAnsicht(id = 2, purchasePrice = Geld.aus(80.0)))
        val teil = ManuellesTeilAnsicht(id = 1, partNumber = "3001", purchasePrice = Geld.aus(150.0), acquisitions = kaeufe)
        val figur = ManuelleFigurAnsicht(id = 2, figNumber = "sw0001", purchasePrice = Geld.aus(150.0), acquisitions = kaeufe)
        assertEquals(listOf(Geld.aus(120.0), Geld.aus(80.0)), teilZeilen(listOf(teil)).map { it.second.kaufpreis })
        assertEquals(listOf(Geld.aus(120.0), Geld.aus(80.0)), figurZeilen(listOf(figur)).map { it.second.kaufpreis })
        assertEquals(listOf(Geld.aus(150.0)), teilZeilen(listOf(teil.copy(acquisitions = emptyList()))).map { it.second.kaufpreis })
    }
}
