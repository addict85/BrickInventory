package ch.brickinventoryapp

import ch.brickinventoryapp.ui.Navigationsart
import ch.brickinventoryapp.ui.navigationsart
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Telefon unten, ab 600 dp Fensterbreite links als Seitenleiste.
 *
 * Gegenproben (gemessen am 28.10., kotlinc gegen ui/Navigationsart.kt):
 *   A  `>=` durch `>` ersetzt → rot: „genau an der Schwelle steht die Seitenleiste"
 *   B  Schwelle auf 840 gesetzt → rot: dieselbe Prüfung und „ein kleines Tablet"
 */
class NavigationsartTest {

    @Test
    fun `ein Telefon im Hochformat hat die Leiste unten`() {
        assertEquals(Navigationsart.LEISTE_UNTEN, navigationsart(360f))
        assertEquals(Navigationsart.LEISTE_UNTEN, navigationsart(599.5f))
    }

    @Test
    fun `genau an der Schwelle steht die Seitenleiste`() {
        assertEquals(Navigationsart.SEITENLEISTE, navigationsart(600f))
    }

    @Test
    fun `ein kleines Tablet und ein grosses haben die Seitenleiste`() {
        assertEquals(Navigationsart.SEITENLEISTE, navigationsart(700f))
        assertEquals(Navigationsart.SEITENLEISTE, navigationsart(1280f))
    }
}
