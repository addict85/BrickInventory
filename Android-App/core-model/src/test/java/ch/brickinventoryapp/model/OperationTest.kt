package ch.brickinventoryapp.model

import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.model.ui.Vorgang
import ch.brickinventoryapp.model.ui.beendet
import ch.brickinventoryapp.model.ui.errorMessage
import ch.brickinventoryapp.model.ui.laeuft
import ch.brickinventoryapp.model.ui.withoutError
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Eine Handlung läuft, ist fertig oder gescheitert; was ein Bildschirm daraus liest,
 * passt zum Fall, und das Wegräumen eines Fehlers hält keinen laufenden Vorgang an.
 *
 * Gegenproben (gegenproben/, :core-model:test):
 *   vorgang-wegraeumen-haelt-an  withoutError() gibt immer Fertig → rot „das Wegräumen …“
 *   vorgang-beendet-ohne-grund   beendet(null) ergibt einen Fehlschlag → rot „beendet ohne Grund …“
 */
class OperationTest {

    private val fehler = Vorgang.Fehlgeschlagen(Meldung.Resource(7))

    @Test
    fun `only a running operation runs, only a failed one names a reason`() {
        assertTrue(Vorgang.Laeuft.laeuft)
        assertFalse(Vorgang.Fertig.laeuft)
        assertFalse(fehler.laeuft)
        assertEquals(Meldung.Resource(7), fehler.errorMessage)
        assertNull(Vorgang.Laeuft.errorMessage)
        assertNull(Vorgang.Fertig.errorMessage)
    }

    @Test
    fun `clearing an error does not stop a running operation`() {
        assertEquals(Vorgang.Fertig, fehler.withoutError())
        assertEquals(Vorgang.Laeuft, Vorgang.Laeuft.withoutError())
        assertEquals(Vorgang.Fertig, Vorgang.Fertig.withoutError())
    }

    @Test
    fun `ended without a reason is finished, with a reason failed`() {
        assertEquals(Vorgang.Fertig, beendet(null))
        assertEquals(fehler, beendet(Meldung.Resource(7)))
    }
}
