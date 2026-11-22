package ch.brickinventoryapp.shared

import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.domain.PriceChartView
import ch.brickinventoryapp.model.domain.PricePointView
import ch.brickinventoryapp.model.domain.PriceSeriesView
import ch.brickinventoryapp.shared.ui.PriceChartMath
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Chart math for the price history (shared/ui/PriceChartMath.kt).
 *
 * The two bugs guarded against here are hardly recognizable as
 * bugs on the device — they look like real price movements:
 *
 *   1. The ZEROS the server pads at the front, drawn as a point, produce
 *      a line that starts at zero and jumps straight up. That looks
 *      like a price crash that never happened.
 *
 * Plus the description for TalkBack. Counter-checks:
 *   A  in summary() start and end by index instead of by day → red „die Beschreibung nennt je Linie Zeitraum, Anfang, Ende, Tief und Hoch“
 *   B  the semantics on the canvas is checked by PriceChartDescriptionTest (app), drawn;
 *      counter-checks/preisdiagramm-stumm.patch
 */
class PriceChartMathTest {

    private fun series(name: String, first: Int, vararg pts: Pair<String, Double>) =
        PriceSeriesView(
            name = name,
            values = pts.map { PricePointView(it.first, Money.from(it.second)!!) },
            firstRealIndex = first
        )

    @Test
    fun `padded zeros before firstRealIndex are not drawn`() {
        // Used only starts in at the third data point.
        val chart = PriceChartView(
            values = listOf(
                series("N", 0, "2026-01-01" to 100.0, "2026-02-01" to 110.0, "2026-03-01" to 120.0),
                series("U", 2, "2026-01-01" to 0.0, "2026-02-01" to 0.0, "2026-03-01" to 80.0),
            ),
            x = listOf("2026-01-01", "2026-02-01", "2026-03-01")
        )
        val lines = PriceChartMath.buildLines(chart)
        assertEquals(2, lines.size)
        val used = lines.first { it.condition == Condition.USED }
        assertEquals("nur der echte Wert bleibt übrig", 1, used.points.size)
        assertEquals(80.0, used.points[0].value, 0.0001)
    }

    @Test
    fun `a 0 after firstRealIndex also counts as no value`() {
        // The server only pads at the front — a 0 in the middle would be a price of
        // zero francs, which doesn't exist. Removed anyway, just to be safe.
        val chart = PriceChartView(
            values = listOf(series("N", 0, "2026-01-01" to 100.0, "2026-02-01" to 0.0)),
            x = listOf("2026-01-01", "2026-02-01")
        )
        assertEquals(1, PriceChartMath.buildLines(chart).first().points.size)
    }

    @Test
    fun `a series entirely without real values is dropped`() {
        val chart = PriceChartView(
            values = listOf(
                series("N", 0, "2026-01-01" to 100.0),
                series("U", 1, "2026-01-01" to 0.0),
            ),
            x = listOf("2026-01-01")
        )
        val lines = PriceChartMath.buildLines(chart)
        assertEquals("keine Legendenzeile ohne Linie", 1, lines.size)
        assertEquals(Condition.NEW, lines[0].condition)
    }

    @Test
    fun `the x position comes from the date, not from the index`() {
        // Two series of different length: the shared last day has to
        // land at the same spot for both, the second series' later start
        // further to the right.
        val chart = PriceChartView(
            values = listOf(
                series("N", 0, "2026-01-01" to 100.0, "2026-07-01" to 110.0),
                series("U", 1, "2026-01-01" to 0.0, "2026-07-01" to 80.0),
            ),
            x = listOf("2026-01-01", "2026-07-01")
        )
        val lines = PriceChartMath.buildLines(chart)
        val b = PriceChartMath.bounds(lines)!!
        val newLine  = lines.first { it.condition == Condition.NEW }
        val usedLine = lines.first { it.condition == Condition.USED }

        assertEquals(0f, b.xFraction(newLine.points.first().day), 0.0001f)
        assertEquals(1f, b.xFraction(newLine.points.last().day), 0.0001f)
        assertEquals("gemeinsamer letzter Tag → gleiche Position",
            b.xFraction(newLine.points.last().day),
            b.xFraction(usedLine.points.first().day), 0.0001f)
        assertTrue("die kürzere Reihe darf nicht gestreckt werden",
            b.xFraction(usedLine.points.first().day) > 0.5f)
    }

    @Test
    fun `both series share one scale`() {
        // The interesting comparison is the GAP between new and
        // used; separate scales would make exactly that invisible.
        val chart = PriceChartView(
            values = listOf(
                series("N", 0, "2026-01-01" to 200.0),
                series("U", 0, "2026-01-01" to 100.0),
            ),
            x = listOf("2026-01-01")
        )
        val b = PriceChartMath.bounds(PriceChartMath.buildLines(chart))!!
        assertTrue(b.minValue < 100.0)
        assertTrue(b.maxValue > 200.0)
        // Used sits lower than new (y is measured from the top).
        assertTrue(b.yFraction(100.0) > b.yFraction(200.0))
    }

    @Test
    fun `all values equal still give a usable span`() {
        // Otherwise the span would be 0 and the division in the drawing code undefined.
        val chart = PriceChartView(
            values = listOf(series("N", 0, "2026-01-01" to 50.0, "2026-02-01" to 50.0)),
            x = listOf("2026-01-01", "2026-02-01")
        )
        val b = PriceChartMath.bounds(PriceChartMath.buildLines(chart))!!
        assertTrue(b.maxValue > b.minValue)
        assertTrue("keine negative Achse", b.minValue >= 0.0)
    }

    @Test
    fun `empty data give nothing to draw`() {
        assertTrue(PriceChartMath.buildLines(PriceChartView()).isEmpty())
        assertNull(PriceChartMath.bounds(emptyList()))
        assertNull(PriceChartMath.axisRange(PriceChartView()))
    }

    @Test
    fun `date format and axis margins`() {
        val de = Locale.forLanguageTag("de-CH")
        assertEquals("31.01.2026", PriceChartMath.formatDay("2026-01-31", de))
        assertEquals("31.01.2026", PriceChartMath.formatDay("2026-01-31T10:00:00Z", de))
        assertEquals("31 Jan 2026", PriceChartMath.formatDay("2026-01-31", Locale.forLanguageTag("en-GB")))
        assertEquals("kaputt", PriceChartMath.formatDay("kaputt", de))
        val range = PriceChartMath.axisRange(
            PriceChartView(x = listOf("2026-01-01", "2026-02-01", "2026-03-01")))
        assertEquals("2026-01-01" to "2026-03-01", range)
    }

    @Test
    fun `the description names period, start, end, low and high per line`() {
        // Delivered out of order: start and end are determined by the day.
        val chart = PriceChartView(
            values = listOf(
                series("N", 0, "2026-03-01" to 120.0, "2026-01-01" to 100.0, "2026-02-01" to 90.0),
                series("U", 1, "2026-01-01" to 0.0, "2026-02-01" to 70.0, "2026-03-01" to 80.0),
            ),
            x = listOf("2026-01-01", "2026-02-01", "2026-03-01")
        )
        val z = PriceChartMath.summary(PriceChartMath.buildLines(chart), Locale.forLanguageTag("de-CH")).associateBy { it.condition }
        val newValue = z.getValue(Condition.NEW)
        assertEquals(listOf("01.01.2026", "01.03.2026"), listOf(newValue.of, newValue.until))
        assertEquals(listOf(100.0, 120.0, 90.0, 120.0), listOf(newValue.begin, newValue.end, newValue.deep, newValue.high))
        val used = z.getValue(Condition.USED)
        assertEquals("Die aufgefüllte Null zählt nicht", "01.02.2026", used.of)
        assertEquals(70.0, used.deep, 0.0)
    }
}
