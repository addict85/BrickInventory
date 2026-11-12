package ch.brickinventoryapp.ui

import androidx.compose.runtime.mutableStateOf
import ch.brickinventoryapp.ui.screens.KameraErlaubnis
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Wohin der Knopf im Kamera-Hinweis führt: Hat Android die Frage gesperrt („nicht mehr
 * fragen“), kehrt sie sofort mit Nein zurück — der Knopf führt dann in die
 * App-Einstellungen. Das Öffnen des Scanners fragt immer nur das System.
 *
 * Gegenprobe:
 *   KameraErlaubnis.erlauben() fragt immer das System (gegenproben/kamera-gesperrt-toter-knopf.patch)
 *   → rot „ist die Frage gesperrt, fuehrt der Knopf in die Einstellungen“
 */
class KameraErlaubnisTest {

    private val erteilt = mutableStateOf(false)
    private val gesperrt = mutableStateOf(false)
    private val wege = mutableListOf<String>()
    private val erlaubnis = KameraErlaubnis(erteilt, gesperrt, { wege += "frage" }) { wege += "einstellungen" }

    @Test
    fun `ist die Frage gesperrt, fuehrt der Knopf in die Einstellungen`() {
        gesperrt.value = true
        assertTrue(erlaubnis.dauerhaftVerweigert)
        erlaubnis.erlauben()
        assertEquals(listOf("einstellungen"), wege)
    }

    @Test
    fun `sonst fragt der Knopf das System, und das Oeffnen des Scanners nie die Einstellungen`() {
        erlaubnis.erlauben()
        gesperrt.value = true
        erlaubnis.anfragen()
        assertEquals(listOf("frage", "frage"), wege)
    }

    @Test
    fun `erteilt ist nichts verweigert, auch wenn die Frage einmal gesperrt war`() {
        gesperrt.value = true
        erteilt.value = true
        assertFalse(erlaubnis.dauerhaftVerweigert)
    }
}
