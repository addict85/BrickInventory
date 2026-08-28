package ch.brickinventoryapp.ui

import kotlin.math.roundToInt

/**
 * Pure Mathematik des Jahres-Scrubbers (CatalogScreen) — als eigenes Objekt
 * extrahiert, damit sie ohne Compose/Android in JUnit-Tests prüfbar ist
 * (siehe app/src/test/.../CatalogYearMathTest.kt).
 *
 * Modell: Der Daumen (Höhe thumbHeightPx) läuft in einer Leiste der Höhe
 * heightPx. Oben = yearMax (neuestes Jahr), unten = yearMin.
 */
object CatalogYearMath {

    /** Jahr an der Touch-Position y (Pixel, 0 = oben). */
    fun yearAt(y: Float, heightPx: Int, thumbHeightPx: Int, yearMin: Int, yearMax: Int): Int {
        val track = (heightPx - thumbHeightPx).coerceAtLeast(1)
        val frac = ((y - thumbHeightPx / 2f) / track).coerceIn(0f, 1f)
        return (yearMax - frac * (yearMax - yearMin)).roundToInt().coerceIn(yearMin, yearMax)
    }

    /** Vertikaler Offset (Pixel) der Daumen-Oberkante für ein Jahr. */
    fun thumbOffset(year: Int, heightPx: Int, thumbHeightPx: Int, yearMin: Int, yearMax: Int): Int {
        val frac = ((yearMax - year).toFloat() / (yearMax - yearMin).coerceAtLeast(1)).coerceIn(0f, 1f)
        return (frac * (heightPx - thumbHeightPx).coerceAtLeast(0)).roundToInt()
    }
}
