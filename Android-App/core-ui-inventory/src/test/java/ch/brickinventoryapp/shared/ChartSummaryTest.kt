package ch.brickinventoryapp.shared

import ch.brickinventoryapp.contract.ChartPoint
import ch.brickinventoryapp.contract.mapping.asView
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import ch.brickinventoryapp.shared.ui.chartSummary

/**
 * The summary that PortfolioChart reads out as contentDescription.
 *
 * Counter-checks (measured 28.10., kotlinc against a copy of
 * shared/ui/ChartSummary.kt):
 *   A  the server's figure bypassed (always computed itself) → red „die
 *      Veraenderung des Servers geht vor"
 *   B  `of` taken from the first point instead of the first label → red
 *      „the period comes from the outermost labels"
 *   C  threshold `< 2` → `< 1` → red „a single point is not a history"
 */
class ChartSummaryTest {

    private fun p(label: String, value: Double) = ChartPoint(xLabel = label, value = value).asView()

    @Test
    fun `a single point is not a history`() {
        assertNull(chartSummary(listOf(p("1. Okt", 100.0)), null))
        assertNull(chartSummary(emptyList(), 5.0))
    }

    @Test
    fun `start, end and change from the points`() {
        val z = chartSummary(listOf(p("1. Okt", 200.0), p("8. Okt", 250.0)), null)!!
        assertEquals(200.0, z.begin, 1e-9)
        assertEquals(250.0, z.end, 1e-9)
        assertEquals(25.0, z.changePercent!!, 1e-9)
    }

    @Test
    fun `the server's change takes precedence`() {
        val z = chartSummary(listOf(p("a", 200.0), p("b", 250.0)), 12.5)!!
        assertEquals(12.5, z.changePercent!!, 1e-9)
    }

    @Test
    fun `the period comes from the outermost labels`() {
        val z = chartSummary(
            listOf(p("", 1.0), p("2. Okt", 2.0), p("", 3.0), p("5. Okt", 4.0), p("", 5.0)), null)!!
        assertEquals("2. Okt", z.of)
        assertEquals("5. Okt", z.until)
    }

    @Test
    fun `without a start value there is no percentage`() {
        assertNull(chartSummary(listOf(p("a", 0.0), p("b", 10.0)), null)!!.changePercent)
    }
}
