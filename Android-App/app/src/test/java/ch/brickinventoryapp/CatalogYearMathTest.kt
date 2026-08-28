package ch.brickinventoryapp

import ch.brickinventoryapp.ui.CatalogYearMath
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Unit-Tests für die Jahres-Scrubber-Mathematik (Katalog).
 * Modell: Leiste heightPx hoch, Daumen thumbPx hoch; oben = yearMax.
 */
class CatalogYearMathTest {

    private val H = 1000      // Leistenhöhe in px
    private val T = 36        // Daumenhöhe in px
    private val MIN = 1949
    private val MAX = 2027

    @Test
    fun `oberster Punkt ergibt das neueste Jahr`() {
        assertEquals(MAX, CatalogYearMath.yearAt(0f, H, T, MIN, MAX))
        // Auch die Daumenmitte am oberen Anschlag zählt als max
        assertEquals(MAX, CatalogYearMath.yearAt(T / 2f, H, T, MIN, MAX))
    }

    @Test
    fun `unterster Punkt ergibt das aelteste Jahr`() {
        assertEquals(MIN, CatalogYearMath.yearAt(H.toFloat(), H, T, MIN, MAX))
        assertEquals(MIN, CatalogYearMath.yearAt(H - T / 2f, H, T, MIN, MAX))
    }

    @Test
    fun `mitte der Leiste ergibt das mittlere Jahr`() {
        val mid = CatalogYearMath.yearAt(H / 2f, H, T, MIN, MAX)
        assertEquals((MIN + MAX) / 2, mid)
    }

    @Test
    fun `positionen ausserhalb der Leiste werden geklemmt`() {
        assertEquals(MAX, CatalogYearMath.yearAt(-500f, H, T, MIN, MAX))
        assertEquals(MIN, CatalogYearMath.yearAt(H + 500f, H, T, MIN, MAX))
    }

    @Test
    fun `thumbOffset ist monoton - neuere Jahre liegen weiter oben`() {
        var prev = -1
        for (year in MAX downTo MIN) {
            val off = CatalogYearMath.thumbOffset(year, H, T, MIN, MAX)
            assertTrue("Offset muss mit sinkendem Jahr wachsen (Jahr $year)", off >= prev)
            prev = off
        }
        assertEquals(0, CatalogYearMath.thumbOffset(MAX, H, T, MIN, MAX))
        assertEquals(H - T, CatalogYearMath.thumbOffset(MIN, H, T, MIN, MAX))
    }

    @Test
    fun `roundtrip - daumenmitte eines Jahres trifft wieder dasselbe Jahr`() {
        for (year in MIN..MAX) {
            val center = CatalogYearMath.thumbOffset(year, H, T, MIN, MAX) + T / 2f
            assertEquals("Roundtrip für $year", year, CatalogYearMath.yearAt(center, H, T, MIN, MAX))
        }
    }

    @Test
    fun `degenerierte Faelle crashen nicht`() {
        // Nur ein Jahr im Katalog
        assertEquals(2005, CatalogYearMath.yearAt(500f, H, T, 2005, 2005))
        assertEquals(0, CatalogYearMath.thumbOffset(2005, H, T, 2005, 2005))
        // Leiste kleiner als der Daumen (extrem kleines Layout)
        val y = CatalogYearMath.yearAt(10f, 20, T, MIN, MAX)
        assertTrue(y in MIN..MAX)
    }
}
