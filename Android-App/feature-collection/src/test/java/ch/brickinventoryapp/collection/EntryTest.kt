package ch.brickinventoryapp.collection

import ch.brickinventoryapp.collection.ui.Erfassung
import ch.brickinventoryapp.collection.ui.EntryUiState
import ch.brickinventoryapp.collection.ui.CheckPhase
import ch.brickinventoryapp.collection.ui.CheckStep
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Die Prüfanzeige vor dem Erfassen: zeigen und wieder räumen.
 *
 * Gegenprobe (am 27.10. gemessen, kotlinc gegen Erfassung.kt): fertig() ohne
 * Wirkung → rot: „done clears the display, even after a phase change".
 */
class EntryTest {

    @Test
    fun `done clears the display, even after a phase change`() {
        val e = Erfassung()
        e.zeige("4006381333931", CheckPhase.BARCODE)
        e.zeige("10305-1", CheckPhase.BESTAND)
        assertEquals(CheckStep("10305-1", CheckPhase.BESTAND), e.state.value.check)
        e.fertig()
        assertEquals(EntryUiState(), e.state.value)
    }
}
