package ch.brickinventoryapp

import ch.brickinventoryapp.ui.NutzerCaSchalter
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Nutzer-CAs gehen nur über die Rückfrage an (AppViewModel.nutzerCa, bedient von
 * den Einstellungen und vom Zertifikatsdialog). Ausschalten braucht keine.
 *
 * Gegenproben (01.11.2026, gemessen gegen ui/NutzerCaSchalter.kt):
 *   A  anfragen() schaltet direkt ein (`setze(true)`) → rot „anfragen schaltet
 *      nichts ein“ und „abbrechen laesst alles aus“
 *   B  in bestaetigen() die Abfrage `if (!_frage.value) return` entfernt → rot
 *      „ohne offene Frage bestaetigt nichts“
 *   C  abbrechen() ruft `setze(true)` → rot „abbrechen laesst alles aus“
 *   D  setze() ohne nachAenderung() → rot „bestaetigen schaltet ein …“ und
 *      „ausschalten geht ohne Frage“
 */
class NutzerCaBestaetigungTest {

    private var gespeichert = false
    private val geschrieben = mutableListOf<Boolean>()
    private var verworfen = 0

    private fun schalter(start: Boolean = false): NutzerCaSchalter {
        gespeichert = start
        return NutzerCaSchalter(
            lies = { gespeichert },
            schreibe = { gespeichert = it; geschrieben += it },
            nachAenderung = { verworfen++ },
        )
    }

    @Test
    fun `die Vorgabe ist aus`() {
        assertFalse(schalter().an.value)
    }

    @Test
    fun `anfragen schaltet nichts ein`() {
        val s = schalter()
        s.anfragen()
        assertTrue("Der Dialog wartet", s.frage.value)
        assertFalse(s.an.value)
        assertEquals(emptyList<Boolean>(), geschrieben)
    }

    @Test
    fun `bestaetigen schaltet ein und verwirft offene Verbindungen`() {
        val s = schalter()
        s.anfragen()
        s.bestaetigen()
        assertTrue(s.an.value)
        assertFalse(s.frage.value)
        assertEquals(listOf(true), geschrieben)
        assertEquals(1, verworfen)
    }

    @Test
    fun `abbrechen laesst alles aus`() {
        val s = schalter()
        s.anfragen()
        s.abbrechen()
        assertFalse(s.an.value)
        assertFalse(s.frage.value)
        assertFalse(gespeichert)
        assertEquals(emptyList<Boolean>(), geschrieben)
    }

    @Test
    fun `ohne offene Frage bestaetigt nichts`() {
        val s = schalter()
        s.bestaetigen()
        assertFalse(s.an.value)
        assertEquals(emptyList<Boolean>(), geschrieben)
    }

    @Test
    fun `ausschalten geht ohne Frage`() {
        val s = schalter(start = true)
        assertTrue(s.an.value)
        s.anfragen()
        assertFalse("Schon an: keine Frage", s.frage.value)
        s.ausschalten()
        assertFalse(s.an.value)
        assertEquals(listOf(false), geschrieben)
        assertEquals(1, verworfen)
    }
}
