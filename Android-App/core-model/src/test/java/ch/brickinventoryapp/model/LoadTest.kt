package ch.brickinventoryapp.model

import ch.brickinventoryapp.model.ui.Fehlerklasse
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.model.ui.dataOrNull
import ch.brickinventoryapp.model.ui.errorKind
import ch.brickinventoryapp.model.ui.errorMessage
import ch.brickinventoryapp.model.ui.laedt
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Loading, data and error exclude each other; what a screen reads from it
 * fits the case.
 *
 * Counter-checks (measured 14.11.2026, :core-model:test):
 *   A  `offline` delivers `stand == null` → red “data from the store is offline …”
 *   B  dataOrNull() returns a value even on error (`as? Laden.Daten<T>` replaced by
 *      default) → red “only data carries a value”
 */
class LoadTest {

    private val fehler = Laden.Fehler(Fehlerklasse.OFFLINE, Meldung.Resource(7))

    @Test
    fun `data from the store is offline, fresh data is not`() {
        assertTrue(Laden.Daten(listOf(1), stand = 1000L).offline)
        assertFalse(Laden.Daten(listOf(1)).offline)
    }

    @Test
    fun `only data carries a value`() {
        assertEquals(listOf(1), Laden.Daten(listOf(1)).dataOrNull())
        assertNull((Laden.Loads as Laden<List<Int>>).dataOrNull())
        assertNull((fehler as Laden<List<Int>>).dataOrNull())
    }

    @Test
    fun `loading and error say what they are`() {
        assertTrue(Laden.Loads.laedt)
        assertFalse(fehler.laedt)
        assertEquals(Meldung.Resource(7), fehler.errorMessage)
        assertEquals(Fehlerklasse.OFFLINE, fehler.errorKind)
        assertNull(Laden.Daten(Unit).errorMessage)
        assertNull(Laden.Loads.errorKind)
    }
}
