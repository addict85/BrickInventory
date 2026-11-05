package ch.brickinventoryapp

import ch.brickinventoryapp.ui.theme.argbAusHex
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Die Farbe eines Teils aus dem Hex-Wert des Servers, an einer Stelle für alle
 * Teile-Bildschirme: mit und ohne „#“, voll deckend, ein unlesbarer Wert ergibt
 * keine Farbe statt einer Ausnahme.
 *
 * Gegenprobe (05.11.2026, gemessen mit kotlinc lokal): in argbAusHex() die Prüfung
 * auf Hex-Ziffern gestrichen → rot „ein unlesbarer Wert …“ (NumberFormatException);
 * gegenproben/farbe-hex-ungeprueft.patch.
 */
class FarbeAusHexTest {

    @Test
    fun `rrggbb mit und ohne Raute, voll deckend`() {
        assertEquals(0xFFC91A09L, argbAusHex("C91A09"))
        assertEquals(0xFFC91A09L, argbAusHex("#c91a09"))
        assertEquals(0xFF05131DL, argbAusHex(" 05131D "))
        assertEquals("Mit Deckkraft bleibt sie", 0x80FFFFFFL, argbAusHex("80FFFFFF"))
    }

    @Test
    fun `ein unlesbarer Wert ergibt keine Farbe`() {
        for (roh in listOf(null, "", "#", "zz1234", "12345", "1234567", "C91A09FF00")) {
            assertNull("„$roh“", argbAusHex(roh))
        }
    }
}
