package ch.brickinventoryapp.ui

import ch.brickinventoryapp.ui.theme.argbFromHex
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * A part's color from the server's hex value, in one place for all
 * part screens: with and without "#", fully opaque, an unreadable value yields
 * no color instead of an exception.
 *
 * Counter-check: in argbFromHex() the check
 * for hex digits removed → red „ein unlesbarer Wert …“ (NumberFormatException);
 * counter-checks/color-hex-unchecked.patch.
 */
class ColorFromHexTest {

    @Test
    fun `rrggbb with and without hash, fully opaque`() {
        assertEquals(0xFFC91A09L, argbFromHex("C91A09"))
        assertEquals(0xFFC91A09L, argbFromHex("#c91a09"))
        assertEquals(0xFF05131DL, argbFromHex(" 05131D "))
        assertEquals("with opacity it stays", 0x80FFFFFFL, argbFromHex("80FFFFFF"))
    }

    @Test
    fun `an unreadable value gives no color`() {
        for (raw in listOf(null, "", "#", "zz1234", "12345", "1234567", "C91A09FF00")) {
            assertNull("„$raw“", argbFromHex(raw))
        }
    }
}
