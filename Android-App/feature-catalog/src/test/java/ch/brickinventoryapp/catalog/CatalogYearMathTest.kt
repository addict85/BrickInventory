package ch.brickinventoryapp.catalog

import ch.brickinventoryapp.catalog.ui.CatalogYearMath
import ch.brickinventoryapp.model.domain.YearCountView
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The year bar calculates over the DISTRIBUTION, not linearly.
 *
 * ── The bug this prevents ──────────────────────────────────────────
 * A linear model used to sit here: yearMax at the top, yearMin at the
 * bottom, the stretch between evenly split across the years; the bar showed
 * 1965 and loaded the sets from 1999.
 *
 * The assumption behind it — that every year holds the same amount — is wrong: by
 * far the largest part of the catalog comes from the last few decades.
 *
 * The numbers below are this case in miniature: three years, of which the
 * newest accounts for ninety of a hundred sets. At nine tenths of the bar, you're
 * therefore STILL in the newest year — calculated linearly, that spot would give
 * the oldest.
 *
 * The same calculation lives in the web app (`js/katalog.js` → _jahrAnPosition).
 * Web-App/test/catalog-frontend.test.js checks, across both source trees, that
 * both have it and neither estimates linearly.
 */
class CatalogYearMathTest {

    private val H = 1000      // Bar height in px
    private val T = 36        // Handle height in px

    /** Newest first — the same order the list is in. */
    private val DISTRIBUTION = listOf(
        YearCountView(2024, 90),
        YearCountView(2010, 7),
        YearCountView(1965, 3),
    )
    private val TOTAL = 100

    private fun year(share: Float) = CatalogYearMath.yearAnPosition(share, TOTAL, DISTRIBUTION)

    @Test
    fun `nine tenths down is not yet at the oldest year`() {
        // Linear would give 1965 here. In fact the
        // 2024 year goes up to running number 89, and 0.9 * 99 = 89.
        assertEquals(2024, year(0.9f))
    }

    @Test
    fun `the edges hit the first and the last year`() {
        assertEquals(2024, year(0f))
        assertEquals(1965, year(1f))
        // Clamped outside the range, not computed.
        assertEquals(2024, year(-2f))
        assertEquals(1965, year(5f))
    }

    @Test
    fun `the boundary between two years lies at the right number`() {
        // Number 89 is the last of 2024, number 90 the first of 2010.
        assertEquals(89, CatalogYearMath.numberFrom(0.9f, TOTAL))
        assertEquals(2024, year(89f / 99f))
        assertEquals(2010, year(90f / 99f))
    }

    @Test
    fun `the year falls with the position - never the other way round`() {
        var before = Int.MAX_VALUE
        for (i in 0..100) {
            val j = year(i / 100f)!!
            assertTrue("Bei $i% springt das Jahr zurück: $before -> $j", j <= before)
            before = j
        }
    }

    @Test
    fun `without a distribution or without sets there is no label`() {
        assertNull(CatalogYearMath.yearAnPosition(0.5f, TOTAL, emptyList()))
        assertNull(CatalogYearMath.yearAnPosition(0.5f, 0, DISTRIBUTION))
    }

    @Test
    fun `a loaded tile beats the calculation`() {
        // First choice as in the web app: if the slot is loaded, its year applies —
        // even if the distribution would give something else.
        assertEquals(1999, CatalogYearMath.yearFor(0.9f, TOTAL, DISTRIBUTION) { 1999 })
        // Not loaded -> the calculation.
        assertEquals(2024, CatalogYearMath.yearFor(0.9f, TOTAL, DISTRIBUTION) { null })
    }

    @Test
    fun `touch and handle position are inverse to each other`() {
        for (percent in 0..100) {
            val share = percent / 100f
            val offset = CatalogYearMath.thumbOffset(share, H, T)
            // Die Griffmitte an dieser Stelle ergibt wieder denselben Anteil.
            val back = CatalogYearMath.shareFrom(offset + T / 2f, H, T)
            assertEquals("Anteil $share", share, back, 0.002f)
        }
        assertEquals(0, CatalogYearMath.thumbOffset(0f, H, T))
        assertEquals(H - T, CatalogYearMath.thumbOffset(1f, H, T))
    }

    @Test
    fun `number and share are inverse to each other`() {
        for (n in 0 until TOTAL) {
            assertEquals(n, CatalogYearMath.numberFrom(CatalogYearMath.shareFromNumber(n, TOTAL), TOTAL))
        }
        // A list with a single entry has no span.
        assertEquals(0f, CatalogYearMath.shareFromNumber(0, 1), 0f)
        assertEquals(0, CatalogYearMath.numberFrom(0.5f, 0))
    }

    @Test
    fun `degenerate cases do not crash`() {
        // Bar smaller than the handle (extremely small layout)
        val a = CatalogYearMath.shareFrom(10f, 20, T)
        assertTrue(a in 0f..1f)
        assertEquals(0, CatalogYearMath.thumbOffset(a, 20, T))
        // Distribution covers less than `total` — sets without a year count in
        // `total` but don't appear in the distribution. Then the
        // last year applies, exactly as in the web app.
        assertEquals(1965, CatalogYearMath.yearAnPosition(1f, 500, DISTRIBUTION))
    }
}
