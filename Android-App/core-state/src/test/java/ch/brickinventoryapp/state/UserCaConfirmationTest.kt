package ch.brickinventoryapp.state

import ch.brickinventoryapp.state.ui.UserCaToggle
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Nutzer-CAs gehen nur über die Rückfrage an (AppViewModel.userCa, bedient von
 * den Einstellungen und vom Zertifikatsdialog). Ausschalten braucht keine.
 *
 * Gegenproben:
 *   A  anfragen() schaltet direkt ein (`setze(true)`) → rot „anfragen schaltet
 *      nichts ein“ und „cancelling leaves everything off“
 *   B  in bestaetigen() die Abfrage `if (!_question.value) return` entfernt → rot
 *      „without an open question nothing confirms“
 *   C  abbrechen() ruft `setze(true)` → rot „cancelling leaves everything off“
 *   D  setze() ohne afterChange() → rot „bestaetigen schaltet ein …“ und
 *      „turning off works without a question“
 */
class UserCaConfirmationTest {

    private var gespeichert = false
    private val geschrieben = mutableListOf<Boolean>()
    private var verworfen = 0

    private fun toggle(start: Boolean = false): UserCaToggle {
        gespeichert = start
        return UserCaToggle(
            lies = { gespeichert },
            schreibe = { gespeichert = it; geschrieben += it },
            afterChange = { verworfen++ },
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
        assertTrue("Der Dialog wartet", s.frage.value)
        assertFalse(s.an.value)
        assertEquals(emptyList<Boolean>(), geschrieben)
    }

    @Test
    fun `confirming turns on and discards open connections`() {
        val s = toggle()
        s.requests()
        s.bestaetigen()
        assertTrue(s.an.value)
        assertFalse(s.frage.value)
        assertEquals(listOf(true), geschrieben)
        assertEquals(1, verworfen)
    }

    @Test
    fun `cancelling leaves everything off`() {
        val s = toggle()
        s.requests()
        s.abbrechen()
        assertFalse(s.an.value)
        assertFalse(s.frage.value)
        assertFalse(gespeichert)
        assertEquals(emptyList<Boolean>(), geschrieben)
    }

    @Test
    fun `without an open question nothing confirms`() {
        val s = toggle()
        s.bestaetigen()
        assertFalse(s.an.value)
        assertEquals(emptyList<Boolean>(), geschrieben)
    }

    @Test
    fun `turning off works without a question`() {
        val s = toggle(start = true)
        assertTrue(s.an.value)
        s.requests()
        assertFalse("Schon an: keine Frage", s.frage.value)
        s.turnOff()
        assertFalse(s.an.value)
        assertEquals(listOf(false), geschrieben)
        assertEquals(1, verworfen)
    }
}
