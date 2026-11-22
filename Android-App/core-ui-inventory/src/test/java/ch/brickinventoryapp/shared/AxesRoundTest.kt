package ch.brickinventoryapp.shared

import ch.brickinventoryapp.model.domain.ChartAxis
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.domain.PriceChartView
import ch.brickinventoryapp.model.domain.PricePointView
import ch.brickinventoryapp.model.domain.PriceSeriesView
import ch.brickinventoryapp.shared.ui.PriceChartMath
import ch.brickinventoryapp.shared.ui.localValues
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Axes you can actually read: the price history labels round values (790/810/840
 * instead of 787/801/816), and the value chart abbreviates to „1.7k“ at large text sizes.
 *
 * Counter-checks (patches under counter-checks/, measured only in CI):
 *   preisachse-krumm       step without rounding → red „Wertachse des Preisverlaufs …“
 *   wertachse-ausgeschrieben  compact ignored → red „grosse Schrift beschriftet …“
 */
class AxesRoundTest {

    private fun history(vararg values: Double) = PriceChartView(
        values = listOf(PriceSeriesView("N", values.mapIndexed { i, w -> PricePointView("2026-0${i + 1}-01", Money.from(w)!!) })),
        x = values.indices.map { "2026-0${it + 1}-01" })

    @Test
    fun `value axis of the price history is on round values`() {
        for (series in listOf(doubleArrayOf(787.0, 801.0, 816.0), doubleArrayOf(41.9, 44.5, 39.0), doubleArrayOf(1712.4, 1650.0, 1801.0))) {
            val b = PriceChartMath.bounds(PriceChartMath.buildLines(history(*series)))!!
            val ticks = PriceChartMath.yTicks(b)
            assertTrue("all values in range: $ticks", ticks.first() <= series.min() && ticks.last() >= series.max())
            // Round means: a multiple of the power of ten below a quarter of the span
            // (span 60 → tens, span 8 → ones).
            val power = Math.pow(10.0, kotlin.math.floor(kotlin.math.log10((ticks.last() - ticks.first()) / 4)))
            for (t in ticks) {
                val rest = Math.IEEEremainder(t, power)
                assertTrue("$t is not a multiple of $power ($ticks)", kotlin.math.abs(rest) < 1e-6)
            }
        }
    }

    @Test
    fun `large font labels the value axis briefly`() {
        val axis = listOf(ChartAxis("CHF 1'712", Money.from(1712.4)!!, 1.0), ChartAxis("CHF 850", Money.from(850.0)!!, 0.0),
            ChartAxis("CHF 12'400", Money.from(12_400.0)!!, 0.5))
        val de = Locale.forLanguageTag("de-CH")
        assertEquals(listOf("1.7k", "850", "12k"), localValues(axis, CurrencyCode("CHF"), de, compact = true).map { it.label })
        // Without compact, the amount stays written out in full.
        assertTrue(localValues(axis, CurrencyCode("CHF"), de).first().label.contains("CHF"))
    }
}
