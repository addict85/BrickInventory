package ch.brickinventoryapp.shared

import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.domain.ChartAxis
import ch.brickinventoryapp.model.domain.PricePoint
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale
import ch.brickinventoryapp.shared.ui.localAxis
import ch.brickinventoryapp.shared.ui.localValues

/**
 * The axes of the value development follow the app language instead of the server's
 * fixed Swiss form („03.10“, „CHF 1'234“).
 *
 * Counter-checks:
 *   A  localAxis returns `points` unchanged → red: the two day cases
 *      and „month resolution shows month and year“
 *   C  maximumFractionDigits = 2 in localValues → red: „y-Achse ganze Beträge …“
 * Counter-checks: day label reverted to "MMM d" → red
 * „English day before month like every date“; withCurrencyGap in localValues
 * removed → red „y-Achse ganze Beträge …“ („CHF1,234“).
 */
class ChartAxesTest {

    private val points = listOf(
        PricePoint("03.10", Money.from(100.0)!!, 0.0),
        PricePoint("", Money.from(110.0)!!, 0.5),
        PricePoint("05.10", Money.from(120.0)!!, 1.0),
    )
    private val days = listOf("2026-10-03", "2026-10-04", "2026-10-05")

    @Test
    fun `English day before month like every date`() {
        val l = localAxis(points, days, Locale.forLanguageTag("en-GB")).map { it.xLabel }
        assertEquals(listOf("3 Oct", "", "5 Oct"), l)
    }

    @Test
    fun `German with dots like every date`() {
        val l = localAxis(points, days, Locale.forLanguageTag("de-CH")).map { it.xLabel }
        assertEquals(listOf("03.10.", "", "05.10."), l)
    }

    @Test
    fun `month resolution shows month and year`() {
        val month = listOf(PricePoint("10/25", Money.from(1.0)!!, 0.0), PricePoint("11/25", Money.from(2.0)!!, 1.0))
        val l = localAxis(month, listOf("2025-10-01", "2025-11-01"), Locale.forLanguageTag("en-GB"))
        assertEquals(listOf("Oct 25", "Nov 25"), l.map { it.xLabel })
    }

    @Test
    fun `without matching days the server's text stays`() {
        assertEquals(points, localAxis(points, days.take(2), Locale.forLanguageTag("en-GB")))
    }

    @Test
    fun `y axis whole amounts with the language's thousands separators`() {
        val axis = listOf(ChartAxis("CHF 1'234", Money.from(1234.0)!!, 0.0), ChartAxis("CHF 2'000", Money.from(2000.4)!!, 1.0))
        val en = localValues(axis, CurrencyCode("CHF"), Locale.forLanguageTag("en-GB")).map { it.label }
        assertTrue(en.toString(), en[0].contains("1,234") && en[1].contains("2,000") && en.none { "." in it })
        assertEquals("CHF\u00A01,234", en[0])
        val de = localValues(axis, CurrencyCode("CHF"), Locale.forLanguageTag("de-CH")).map { it.label }
        assertTrue(de.toString(), de[0].contains("1’234") || de[0].contains("1'234"))
    }
}
