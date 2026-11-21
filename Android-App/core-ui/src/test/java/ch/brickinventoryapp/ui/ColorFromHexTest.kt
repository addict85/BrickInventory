package ch.brickinventoryapp.ui

import ch.brickinventoryapp.ui.theme.argbFromHex
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Die Farbe eines Teils aus dem Hex-Wert des Servers, an einer Stelle für alle
 * Teile-Bildschirme: mit und ohne „#“, voll deckend, ein unlesbarer Wert ergibt
 * keine Farbe statt einer Ausnahme.
 *
 * Gegenprobe: in argbFromHex() die Prüfung
 * auf Hex-Ziffern gestrichen → rot „ein unlesbarer Wert …“ (NumberFormatException);
 * gegenproben/farbe-hex-ungeprueft.patch.
 */
class ColorFromHexTest {

    @Test
    fun `rrggbb with and without hash, fully opaque`() {
        assertEquals(0xFFC91A09L, argbFromHex("C91A09"))
        assertEquals(0xFFC91A09L, argbFromHex("#c91a09"))
        assertEquals(0xFF05131DL, argbFromHex(" 05131D "))
        assertEquals("Mit Deckkraft bleibt sie", 0x80FFFFFFL, argbFromHex("80FFFFFF"))
    }

    @Test
    fun `an unreadable value gives no color`() {
        for (roh in listOf(null, "", "#", "zz1234", "12345", "1234567", "C91A09FF00")) {
            assertNull("„$roh“", argbFromHex(roh))
        }
    }
}
