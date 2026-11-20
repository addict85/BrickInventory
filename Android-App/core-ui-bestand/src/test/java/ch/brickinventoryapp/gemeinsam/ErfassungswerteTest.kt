package ch.brickinventoryapp.gemeinsam

import ch.brickinventoryapp.model.fach.Geld
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.gemeinsam.ui.entryInvalid
import ch.brickinventoryapp.gemeinsam.ui.erfassungsWerte
import ch.brickinventoryapp.model.fach.MemberView
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
        val haushalt = emptyList<MemberView>()
        // Locale-unabhängig: zwei Trenner sind nie ein Einzelfall.
        assertEquals(Geld.aus(1299.0), erfassungsWerte("2", "1.299,00", Zustand.NEU, null, haushalt).preis)
        assertEquals(Geld.aus(1299.5), erfassungsWerte("2", "1,299.50", Zustand.NEU, null, haushalt).preis)
        assertEquals(false, entryInvalid("", ""))
        assertEquals(false, entryInvalid("3", "1.299,00"))
        assertEquals(true, entryInvalid("0", ""))
        assertEquals(true, entryInvalid("99999999999", ""))
        assertEquals(true, entryInvalid("1", "."))
    }
}
