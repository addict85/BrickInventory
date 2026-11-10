package ch.brickinventoryapp.gemeinsam

import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.gemeinsam.ui.erfassungUngueltig
import ch.brickinventoryapp.gemeinsam.ui.erfassungsWerte
import ch.brickinventoryapp.model.ui.model.MitgliedAnsicht
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Die Erfassungsdialoge lesen Preis und Menge wie die Zahlenfelder (NumericInput).
 *
 * Gegenprobe (gegenproben/erfassung-liest-preis-roh.patch): erfassungsWerte liest den
 * Preis wieder mit replace und toDoubleOrNull → rot „die Erfassung liest den Preis …".
 */
class ErfassungswerteTest {

    @Test
    fun `die Erfassung liest den Preis wie das Feld und meldet Unlesbares`() {
        val haushalt = emptyList<MitgliedAnsicht>()
        // Locale-unabhängig: zwei Trenner sind nie ein Einzelfall.
        assertEquals(1299.0, erfassungsWerte("2", "1.299,00", Zustand.NEU, null, haushalt).preis!!, 0.0)
        assertEquals(1299.5, erfassungsWerte("2", "1,299.50", Zustand.NEU, null, haushalt).preis!!, 0.0)
        assertEquals(false, erfassungUngueltig("", ""))
        assertEquals(false, erfassungUngueltig("3", "1.299,00"))
        assertEquals(true, erfassungUngueltig("0", ""))
        assertEquals(true, erfassungUngueltig("99999999999", ""))
        assertEquals(true, erfassungUngueltig("1", "."))
    }
}
