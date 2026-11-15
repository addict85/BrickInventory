package ch.brickinventoryapp.model

import ch.brickinventoryapp.model.ui.Fehlerklasse
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.model.ui.datenOderNull
import ch.brickinventoryapp.model.ui.fehlerArt
import ch.brickinventoryapp.model.ui.fehlerMeldung
import ch.brickinventoryapp.model.ui.laedt
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Laden, Daten und Fehler schliessen einander aus; was ein Bildschirm daraus liest,
 * passt zum Fall.
 *
 * Gegenproben (14.11.2026 gemessen, :core-model:test):
 *   A  `offline` liefert `stand == null` → rot „Daten aus der Ablage sind offline …“
 *   B  datenOderNull() gibt auch beim Fehler einen Wert (`as? Laden.Daten<T>` durch
 *      Vorgabe ersetzt) → rot „nur Daten tragen einen Wert“
 */
class LadenTest {

    private val fehler = Laden.Fehler(Fehlerklasse.OFFLINE, Meldung.Ressource(7))

    @Test
    fun `Daten aus der Ablage sind offline, frische nicht`() {
        assertTrue(Laden.Daten(listOf(1), stand = 1000L).offline)
        assertFalse(Laden.Daten(listOf(1)).offline)
    }

    @Test
    fun `nur Daten tragen einen Wert`() {
        assertEquals(listOf(1), Laden.Daten(listOf(1)).datenOderNull())
        assertNull((Laden.Laedt as Laden<List<Int>>).datenOderNull())
        assertNull((fehler as Laden<List<Int>>).datenOderNull())
    }

    @Test
    fun `Laden und Fehler sagen, was sie sind`() {
        assertTrue(Laden.Laedt.laedt)
        assertFalse(fehler.laedt)
        assertEquals(Meldung.Ressource(7), fehler.fehlerMeldung)
        assertEquals(Fehlerklasse.OFFLINE, fehler.fehlerArt)
        assertNull(Laden.Daten(Unit).fehlerMeldung)
        assertNull(Laden.Laedt.fehlerArt)
    }
}
