package ch.brickinventoryapp.state

import ch.brickinventoryapp.state.ui.Meldungseingang
import ch.brickinventoryapp.state.ui.setNumberFromMessage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Das Ziel einer angetippten Meldung: nur Setnummern, und nur einmal.
 *
 * Gegenproben:
 *   A  SETNUMMER auf `.+` gelockert → rot „what is not a set number opens nothing“
 *      und „an invalid target does not overwrite a valid one“
 *   B  abholen() mit get() statt getAndSet(null) → rot „it is picked up once“
 *   C  ablegen() legt auch Ungültiges ab (`ziel.set(roh)` vor der Prüfung) → rot
 *      „an invalid target does not overwrite a valid one“ und „was keine
 *      Setnummer ist …“
 */
class MeldungseingangTest {

    @Test
    fun `set numbers as in the stock count`() {
        for (sn in listOf("75192-1", "10497-1", "col23-1", "LLCA30-1", "6895"))
            assertEquals(sn, setNumberFromMessage(sn))
    }

    @Test
    fun `what is not a set number opens nothing`() {
        // Pfad-, Query- und Steuerzeichen würden Teil der Navigationsroute.
        for (roh in listOf(null, "", " ", "75192-1/../settings", "75192-1?x=1", "a b", "75192-1\n",
                "x".repeat(21), "%2e%2e", "set_detail/1", "ä-1"))
            assertNull("„$roh“ gilt als Setnummer", setNumberFromMessage(roh))
        val e = Meldungseingang()
        assertFalse(e.ablegen("../admin"))
        assertNull(e.abholen())
    }

    @Test
    fun `it is picked up once`() {
        val e = Meldungseingang()
        assertTrue(e.ablegen("75192-1"))
        assertEquals("75192-1", e.abholen())
        assertNull("Ein zweiter Start öffnet das Set nicht erneut", e.abholen())
    }

    @Test
    fun `an invalid target does not overwrite a valid one`() {
        val e = Meldungseingang()
        e.ablegen("10497-1")
        e.ablegen("10497-1?x")
        assertEquals("10497-1", e.abholen())
    }
}
