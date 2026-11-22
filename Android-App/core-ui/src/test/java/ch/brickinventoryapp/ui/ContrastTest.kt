package ch.brickinventoryapp.ui

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The contrast calculation ColorRolesTest relies on, against values that
 * WCAG and every contrast calculator name.
 *
 * Counter-checks (measured on Oct 28, kotlinc against a copy of Kontrast.kt):
 *   A  linearization removed (channel = value/255) → red: „mittleres Grau …"
 *      and „die alte Rahmenfarbe …" (black/white stays 21:1)
 *   B  `+ 0.05` removed from the denominator → red in all three checks
 */
class ContrastTest {

    private fun color(rgb: Int) = (0xFF shl 24) or rgb

    @Test
    fun `black on white is 21 to 1, equal on equal 1 to 1`() {
        assertEquals(21.0, Contrast.ratio(color(0x000000), color(0xFFFFFF)), 1e-9)
        assertEquals(1.0, Contrast.ratio(color(0x777777), color(0x777777)), 1e-9)
    }

    @Test
    fun `medium gray on white gives the known 4,54 to 1`() {
        // #767676 is the lightest gray that reaches 4.5:1 on white.
        assertEquals(4.54, Contrast.ratio(color(0x767676), color(0xFFFFFF)), 0.005)
    }

    @Test
    fun `the old border color reaches only 1,23 to 1 on white`() {
        // The UI check's finding: outline #E2E8F0 in the base design.
        assertEquals(1.23, Contrast.ratio(color(0xE2E8F0), color(0xFFFFFF)), 0.005)
    }
}
