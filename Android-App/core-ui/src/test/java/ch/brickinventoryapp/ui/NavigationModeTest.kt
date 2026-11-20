package ch.brickinventoryapp.ui

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Telefon unten, ab 600 dp Fensterbreite links als Seitenleiste.
 *
 * Gegenproben (gemessen am 28.10., kotlinc gegen ui/Navigationsart.kt):
 *   A  `>=` durch `>` ersetzt → rot: „genau an der Schwelle steht die Seitenleiste"
 *   B  Schwelle auf 840 gesetzt → rot: dieselbe Prüfung und „ein kleines Tablet"
 *   C  LARGE_WIDTH_DP auf 600 → rot „zwei Spalten erst ab 840 dp“
 *   D  in listAndDetail() `>` statt `>=` → rot „Liste und
 *      Detail nebeneinander ab 840 dp“
 */
class NavigationModeTest {

    @Test
    fun `ein Telefon im Hochformat hat die Leiste unten`() {
        assertEquals(NavigationMode.LEISTE_UNTEN, navigationMode(360f))
        assertEquals(NavigationMode.LEISTE_UNTEN, navigationMode(599.5f))
    }

    @Test
    fun `genau an der Schwelle steht die Seitenleiste`() {
        assertEquals(NavigationMode.SIDEBAR, navigationMode(600f))
    }

    @Test
    fun `ein kleines Tablet und ein grosses haben die Seitenleiste`() {
        assertEquals(NavigationMode.SIDEBAR, navigationMode(700f))
        assertEquals(NavigationMode.SIDEBAR, navigationMode(1280f))
    }

    @Test
    fun `Liste und Detail nebeneinander ab 840 dp`() {
        assertEquals(false, listAndDetail(411f))
        assertEquals(false, listAndDetail(839.5f))
        assertEquals(true, listAndDetail(840f))
        assertEquals(true, listAndDetail(1280f))
    }

    @Test
    fun `zwei Spalten erst ab 840 dp`() {
        assertEquals(false, twoSpaltig(600f))
        assertEquals(false, twoSpaltig(839.5f))
        assertEquals(true, twoSpaltig(840f))
        assertEquals(true, twoSpaltig(1280f))
    }
}
