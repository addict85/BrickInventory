package ch.brickinventoryapp

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Die Kontrastrechnung, auf die sich FarbrollenTest stützt, gegen Werte, die
 * WCAG und jeder Kontrastrechner nennen.
 *
 * Gegenproben (gemessen am 28.10., kotlinc gegen eine Kopie von Kontrast.kt):
 *   A  Linearisierung entfernt (Kanal = wert/255) → rot: „mittleres Grau …"
 *      und „die alte Rahmenfarbe …" (Schwarz/Weiss bleibt 21:1)
 *   B  `+ 0.05` im Nenner entfernt → rot in allen drei Prüfungen
 */
class KontrastTest {

    private fun farbe(rgb: Int) = (0xFF shl 24) or rgb

    @Test
    fun `Schwarz auf Weiss ist 21 zu 1, gleich auf gleich 1 zu 1`() {
        assertEquals(21.0, Kontrast.verhaeltnis(farbe(0x000000), farbe(0xFFFFFF)), 1e-9)
        assertEquals(1.0, Kontrast.verhaeltnis(farbe(0x777777), farbe(0x777777)), 1e-9)
    }

    @Test
    fun `mittleres Grau auf Weiss ergibt die bekannten 4,54 zu 1`() {
        // #767676 ist das hellste Grau, das auf Weiss 4,5:1 erreicht.
        assertEquals(4.54, Kontrast.verhaeltnis(farbe(0x767676), farbe(0xFFFFFF)), 0.005)
    }

    @Test
    fun `die alte Rahmenfarbe erreicht auf Weiss nur 1,23 zu 1`() {
        // Der Befund der UI-Prüfung: outline #E2E8F0 im Grunddesign.
        assertEquals(1.23, Kontrast.verhaeltnis(farbe(0xE2E8F0), farbe(0xFFFFFF)), 0.005)
    }
}
