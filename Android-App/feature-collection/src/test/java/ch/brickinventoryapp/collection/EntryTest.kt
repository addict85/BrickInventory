package ch.brickinventoryapp.collection

import ch.brickinventoryapp.collection.ui.CheckPhase
import ch.brickinventoryapp.collection.ui.CheckStep
import ch.brickinventoryapp.collection.ui.Entry
import ch.brickinventoryapp.collection.ui.EntryUiState
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The check display before adding: show it and clear it again.
 *
 * Counter-check (measured 27.10., kotlinc against Entry.kt): done() with no
 * effect → red: „done clears the display, even after a phase change“.
 */
class EntryTest {

    @Test
    fun `done clears the display, even after a phase change`() {
        val e = Entry()
        e.show("4006381333931", CheckPhase.BARCODE)
        e.show("10305-1", CheckPhase.STOCK)
        assertEquals(CheckStep("10305-1", CheckPhase.STOCK), e.state.value.check)
        e.done()
        assertEquals(EntryUiState(), e.state.value)
    }
}
