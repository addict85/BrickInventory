package ch.brickinventoryapp.collection

import ch.brickinventoryapp.collection.ui.Erfassung
import ch.brickinventoryapp.collection.ui.EntryUiState
import ch.brickinventoryapp.collection.ui.CheckPhase
import ch.brickinventoryapp.collection.ui.CheckStep
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The check display before adding: show it and clear it again.
 *
 * Counter-check (measured 27.10., kotlinc against Erfassung.kt): fertig() with no
 * effect → red: „done clears the display, even after a phase change".
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
