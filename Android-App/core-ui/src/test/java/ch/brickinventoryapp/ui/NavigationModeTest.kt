package ch.brickinventoryapp.ui

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Phone at the bottom, from 600 dp window width on the left as a side bar.
 *
 * Counter-checks (measured on Oct 28, kotlinc against ui/Navigationsart.kt):
 *   A  `>=` replaced by `>` → red: „exactly at the threshold the side bar appears“
 *   B  threshold set to 840 → red: the same check and „ein kleines Tablet“
 *   C  LARGE_WIDTH_DP at 600 → red „two columns only from 840 dp“
 *   D  `>` instead of `>=` in listAndDetail() → red „Liste und Detail nebeneinander ab 840 dp“
 */
class NavigationModeTest {

    @Test
    fun `a phone in portrait has the bar at the bottom`() {
        assertEquals(NavigationMode.BAR_BOTTOM, navigationMode(360f))
        assertEquals(NavigationMode.BAR_BOTTOM, navigationMode(599.5f))
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
        assertEquals(false, twoColumn(600f))
        assertEquals(false, twoColumn(839.5f))
        assertEquals(true, twoColumn(840f))
        assertEquals(true, twoColumn(1280f))
    }
}
