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
 *      nichts ein“ und „abbrechen laesst alles aus“
 *   B  in bestaetigen() die Abfrage `if (!_question.value) return` entfernt → rot
 *      „ohne offene Frage bestaetigt nichts“
 *   C  abbrechen() ruft `setze(true)` → rot „abbrechen laesst alles aus“
 *   D  setze() ohne afterChange() → rot „bestaetigen schaltet ein …“ und
 *      „ausschalten geht ohne Frage“
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
    fun `die Vorgabe ist aus`() {
        assertFalse(toggle().an.value)
    }

    @Test
    fun `anfragen schaltet nichts ein`() {
        val s = toggle()
        s.requests()
        assertTrue("Der Dialog wartet", s.frage.value)
        assertFalse(s.an.value)
        assertEquals(emptyList<Boolean>(), geschrieben)
    }

    @Test
    fun `bestaetigen schaltet ein und verwirft offene Verbindungen`() {
        val s = toggle()
        s.requests()
        s.bestaetigen()
        assertTrue(s.an.value)
        assertFalse(s.frage.value)
        assertEquals(listOf(true), geschrieben)
        assertEquals(1, verworfen)
    }

    @Test
    fun `abbrechen laesst alles aus`() {
        val s = toggle()
        s.requests()
        s.abbrechen()
        assertFalse(s.an.value)
        assertFalse(s.frage.value)
        assertFalse(gespeichert)
        assertEquals(emptyList<Boolean>(), geschrieben)
    }

    @Test
    fun `ohne offene Frage bestaetigt nichts`() {
        val s = toggle()
        s.bestaetigen()
        assertFalse(s.an.value)
        assertEquals(emptyList<Boolean>(), geschrieben)
    }

    @Test
    fun `ausschalten geht ohne Frage`() {
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
