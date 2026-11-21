package ch.brickinventoryapp.shared

import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.shared.ui.entryInvalid
import ch.brickinventoryapp.shared.ui.erfassungsWerte
import ch.brickinventoryapp.model.domain.MemberView
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The capture dialogs read price and quantity like the number fields (NumericInput).
 *
 * Counter-check (gegenproben/erfassung-liest-preis-roh.patch): erfassungsWerte reads the
 * price with replace and toDoubleOrNull again → red „die Erfassung liest den Preis …".
 */
class ErfassungswerteTest {

    @Test
    fun `adding reads the price like the field and reports unreadable input`() {
        val haushalt = emptyList<MemberView>()
        // Locale-independent: two separators are never a special case.
        assertEquals(Geld.aus(1299.0), erfassungsWerte("2", "1.299,00", Zustand.NEU, null, haushalt).preis)
        assertEquals(Geld.aus(1299.5), erfassungsWerte("2", "1,299.50", Zustand.NEU, null, haushalt).preis)
        assertEquals(false, entryInvalid("", ""))
        assertEquals(false, entryInvalid("3", "1.299,00"))
        assertEquals(true, entryInvalid("0", ""))
        assertEquals(true, entryInvalid("99999999999", ""))
        assertEquals(true, entryInvalid("1", "."))
    }
}
