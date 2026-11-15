package ch.brickinventoryapp.model

import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.model.ui.Vorgang
import ch.brickinventoryapp.model.ui.beendet
import ch.brickinventoryapp.model.ui.fehlerMeldung
import ch.brickinventoryapp.model.ui.laeuft
import ch.brickinventoryapp.model.ui.ohneFehler
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
 *   vorgang-wegraeumen-haelt-an  ohneFehler() gibt immer Fertig → rot „das Wegräumen …“
 *   vorgang-beendet-ohne-grund   beendet(null) ergibt einen Fehlschlag → rot „beendet ohne Grund …“
 */
class VorgangTest {

    private val fehler = Vorgang.Fehlgeschlagen(Meldung.Ressource(7))

    @Test
    fun `nur ein laufender Vorgang laeuft, nur ein gescheiterter nennt einen Grund`() {
        assertTrue(Vorgang.Laeuft.laeuft)
        assertFalse(Vorgang.Fertig.laeuft)
        assertFalse(fehler.laeuft)
        assertEquals(Meldung.Ressource(7), fehler.fehlerMeldung)
        assertNull(Vorgang.Laeuft.fehlerMeldung)
        assertNull(Vorgang.Fertig.fehlerMeldung)
    }

    @Test
    fun `das Wegraeumen eines Fehlers haelt keinen laufenden Vorgang an`() {
        assertEquals(Vorgang.Fertig, fehler.ohneFehler())
        assertEquals(Vorgang.Laeuft, Vorgang.Laeuft.ohneFehler())
        assertEquals(Vorgang.Fertig, Vorgang.Fertig.ohneFehler())
    }

    @Test
    fun `beendet ohne Grund ist fertig, mit Grund gescheitert`() {
        assertEquals(Vorgang.Fertig, beendet(null))
        assertEquals(fehler, beendet(Meldung.Ressource(7)))
    }
}
