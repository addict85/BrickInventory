package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.lokal.Abgleichsergebnis
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Der Ausgang bei gesperrtem Gerät: Das Token ist dann nur noch nicht gelesen (sein
 * Schlüssel arbeitet nur entsperrt). Der Arbeiter versucht es später noch einmal,
 * statt den Lauf als erledigt abzuschliessen; die Posten blieben sonst bis zum
 * nächsten Anlass liegen.
 *
 * Gegenprobe (lokal über einen Auszug gemessen): nochmal() mit `NOT_SIGNED_IN -> false` → rot „ohne Token bei
 * gesperrtem Geraet …“; gegenproben/ausgang-ohne-token-fertig.patch
 */
class ExitLockTest {

    @Test
    fun `ohne Token bei gesperrtem Geraet versucht der Ausgang es spaeter noch einmal`() {
        assertTrue(Abgleichsergebnis.NOT_SIGNED_IN.again(deviceLocked = true))
        assertFalse("Abgemeldet bleibt der Lauf erledigt", Abgleichsergebnis.NOT_SIGNED_IN.again(deviceLocked = false))
    }

    @Test
    fun `fertig und spaeter haengen nicht von der Sperre ab`() {
        for (gesperrt in listOf(true, false)) {
            assertTrue(Abgleichsergebnis.LATER.again(gesperrt))
            assertFalse(Abgleichsergebnis.FERTIG.again(gesperrt))
        }
    }
}
