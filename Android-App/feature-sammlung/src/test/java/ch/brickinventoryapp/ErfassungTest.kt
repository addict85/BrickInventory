package ch.brickinventoryapp

import ch.brickinventoryapp.ui.Erfassung
import ch.brickinventoryapp.ui.ErfassungUiState
import ch.brickinventoryapp.ui.Pruefphase
import ch.brickinventoryapp.ui.Pruefschritt
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Die Prüfanzeige vor dem Erfassen: zeigen und wieder räumen.
 *
 * Gegenprobe (am 27.10. gemessen, kotlinc gegen Erfassung.kt): fertig() ohne
 * Wirkung → rot: „fertig raeumt die Anzeige, auch nach einem Phasenwechsel".
 */
class ErfassungTest {

    @Test
    fun `fertig raeumt die Anzeige, auch nach einem Phasenwechsel`() {
        val e = Erfassung()
        e.zeige("4006381333931", Pruefphase.BARCODE)
        e.zeige("10305-1", Pruefphase.BESTAND)
        assertEquals(Pruefschritt("10305-1", Pruefphase.BESTAND), e.state.value.pruefung)
        e.fertig()
        assertEquals(ErfassungUiState(), e.state.value)
    }
}
