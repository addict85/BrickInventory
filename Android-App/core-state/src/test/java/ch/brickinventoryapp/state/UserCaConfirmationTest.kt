package ch.brickinventoryapp.state

import ch.brickinventoryapp.state.ui.UserCaToggle
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * User CAs only turn on via the follow-up question (AppViewModel.userCa, served by
 * settings and the certificate dialog). Turning off needs none.
 *
 * Counter-checks:
 *   A  request() turns it on directly (`set(true)`) → red „anfragen schaltet nichts ein“ and „cancelling leaves everything off“
 *   B  in confirm() the check `if (!_question.value) return` removed → red
 *      „without an open question nothing confirms“
 *   C  cancel() calls `set(true)` → red „cancelling leaves everything off“
 *   D  set() without afterChange() → red „bestaetigen schaltet ein …“ and
 *      „turning off works without a question“
 */
class UserCaConfirmationTest {

    private var saved = false
    private val written = mutableListOf<Boolean>()
    private var discarded = 0

    private fun toggle(start: Boolean = false): UserCaToggle {
        saved = start
        return UserCaToggle(
            read = { saved },
            write = { saved = it; written += it },
            afterChange = { discarded++ },
        )
    }

    @Test
    fun `the default is off`() {
        assertFalse(toggle().an.value)
    }

    @Test
    fun `requesting turns nothing on`() {
        val s = toggle()
        s.requests()
        assertTrue("Der Dialog wartet", s.question.value)
        assertFalse(s.an.value)
        assertEquals(emptyList<Boolean>(), written)
    }

    @Test
    fun `confirming turns on and discards open connections`() {
        val s = toggle()
        s.requests()
        s.confirm()
        assertTrue(s.an.value)
        assertFalse(s.question.value)
        assertEquals(listOf(true), written)
        assertEquals(1, discarded)
    }

    @Test
    fun `cancelling leaves everything off`() {
        val s = toggle()
        s.requests()
        s.cancel()
        assertFalse(s.an.value)
        assertFalse(s.question.value)
        assertFalse(saved)
        assertEquals(emptyList<Boolean>(), written)
    }

    @Test
    fun `without an open question nothing confirms`() {
        val s = toggle()
        s.confirm()
        assertFalse(s.an.value)
        assertEquals(emptyList<Boolean>(), written)
    }

    @Test
    fun `turning off works without a question`() {
        val s = toggle(start = true)
        assertTrue(s.an.value)
        s.requests()
        assertFalse("Schon an: keine Frage", s.question.value)
        s.turnOff()
        assertFalse(s.an.value)
        assertEquals(listOf(false), written)
        assertEquals(1, discarded)
    }
}
