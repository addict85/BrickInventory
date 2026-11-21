package ch.brickinventoryapp.ui

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Telefon unten, ab 600 dp Fensterbreite links als Seitenleiste.
 *
 * Gegenproben (gemessen am 28.10., kotlinc gegen ui/Navigationsart.kt):
 *   A  `>=` durch `>` ersetzt → rot: „exactly at the threshold the side bar appears"
 *   B  Schwelle auf 840 gesetzt → rot: dieselbe Prüfung und „ein kleines Tablet"
 *   C  LARGE_WIDTH_DP auf 600 → rot „two columns only from 840 dp“
 *   D  in listAndDetail() `>` statt `>=` → rot „Liste und
 *      Detail nebeneinander ab 840 dp“
 */
class NavigationModeTest {

    @Test
    fun `a phone in portrait has the bar at the bottom`() {
        assertEquals(NavigationMode.LEISTE_UNTEN, navigationMode(360f))
        assertEquals(NavigationMode.LEISTE_UNTEN, navigationMode(599.5f))
    }

    @Test
    fun `exactly at the threshold the side bar appears`() {
        assertEquals(NavigationMode.SIDEBAR, navigationMode(600f))
    }

    @Test
    fun `a small tablet and a large one have the side bar`() {
        assertEquals(NavigationMode.SIDEBAR, navigationMode(700f))
        assertEquals(NavigationMode.SIDEBAR, navigationMode(1280f))
    }

    @Test
    fun `list and detail side by side from 840 dp`() {
        assertEquals(false, listAndDetail(411f))
        assertEquals(false, listAndDetail(839.5f))
        assertEquals(true, listAndDetail(840f))
        assertEquals(true, listAndDetail(1280f))
    }

    @Test
    fun `two columns only from 840 dp`() {
        assertEquals(false, twoSpaltig(600f))
        assertEquals(false, twoSpaltig(839.5f))
        assertEquals(true, twoSpaltig(840f))
        assertEquals(true, twoSpaltig(1280f))
    }
}
