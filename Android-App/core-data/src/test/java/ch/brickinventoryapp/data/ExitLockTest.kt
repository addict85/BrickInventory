package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.local.Abgleichsergebnis
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
    fun `without a token on a locked device the exit tries again later`() {
        assertTrue(Abgleichsergebnis.NOT_SIGNED_IN.again(deviceLocked = true))
        assertFalse("Abgemeldet bleibt der Lauf erledigt", Abgleichsergebnis.NOT_SIGNED_IN.again(deviceLocked = false))
    }

    @Test
    fun `done and later do not depend on the lock`() {
        for (gesperrt in listOf(true, false)) {
            assertTrue(Abgleichsergebnis.LATER.again(gesperrt))
            assertFalse(Abgleichsergebnis.FERTIG.again(gesperrt))
        }
    }
}
