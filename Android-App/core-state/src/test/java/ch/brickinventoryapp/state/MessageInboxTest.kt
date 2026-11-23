package ch.brickinventoryapp.state

import ch.brickinventoryapp.state.ui.MessageInbox
import ch.brickinventoryapp.state.ui.setNumberFromMessage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The target of a tapped notification: only set numbers, and only once.
 *
 * Counter-checks:
 *   A  SETNUMMER relaxed to `.+` → red „what is not a set number opens nothing“
 *      and „an invalid target does not overwrite a valid one“
 *   B  pickUp() with get() instead of getAndSet(null) → red „it is picked up once“
 *   C  put() also stores invalid input (`target.set(raw)` before the check) → red
 *      „an invalid target does not overwrite a valid one“ and „was keine Setnummer ist …“
 */
class MessageInboxTest {

    @Test
    fun `set numbers as in the stock count`() {
        for (sn in listOf("75192-1", "10497-1", "col23-1", "LLCA30-1", "6895"))
            assertEquals(sn, setNumberFromMessage(sn))
    }

    @Test
    fun `what is not a set number opens nothing`() {
        // Path, query and control characters would become part of the navigation route.
        for (raw in listOf(null, "", " ", "75192-1/../settings", "75192-1?x=1", "a b", "75192-1\n",
                "x".repeat(21), "%2e%2e", "set_detail/1", "ä-1"))
            assertNull("“$raw” counts as a set number", setNumberFromMessage(raw))
        val e = MessageInbox()
        assertFalse(e.put("../admin"))
        assertNull(e.pickUp())
    }

    @Test
    fun `it is picked up once`() {
        val e = MessageInbox()
        assertTrue(e.put("75192-1"))
        assertEquals("75192-1", e.pickUp())
        assertNull("a second start does not open the set again", e.pickUp())
    }

    @Test
    fun `an invalid target does not overwrite a valid one`() {
        val e = MessageInbox()
        e.put("10497-1")
        e.put("10497-1?x")
        assertEquals("10497-1", e.pickUp())
    }
}
