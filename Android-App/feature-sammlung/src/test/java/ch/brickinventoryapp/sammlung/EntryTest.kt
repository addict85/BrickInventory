package ch.brickinventoryapp.sammlung

import ch.brickinventoryapp.sammlung.ui.Erfassung
import ch.brickinventoryapp.sammlung.ui.EntryUiState
import ch.brickinventoryapp.sammlung.ui.CheckPhase
import ch.brickinventoryapp.sammlung.ui.CheckStep
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Die Prüfanzeige vor dem Erfassen: zeigen und wieder räumen.
 *
 * Gegenprobe (am 27.10. gemessen, kotlinc gegen Erfassung.kt): fertig() ohne
 * Wirkung → rot: „fertig raeumt die Anzeige, auch nach einem Phasenwechsel".
 */
class EntryTest {

    @Test
    fun `fertig raeumt die Anzeige, auch nach einem Phasenwechsel`() {
        val e = Erfassung()
        e.zeige("4006381333931", CheckPhase.BARCODE)
        e.zeige("10305-1", CheckPhase.BESTAND)
        assertEquals(CheckStep("10305-1", CheckPhase.BESTAND), e.state.value.check)
        e.fertig()
        assertEquals(EntryUiState(), e.state.value)
    }
}
