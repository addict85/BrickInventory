package ch.brickinventoryapp.shared

import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.model.domain.Waehrung
import ch.brickinventoryapp.model.domain.ChartAxis
import ch.brickinventoryapp.model.domain.DiagrammPunkt
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale
import ch.brickinventoryapp.shared.ui.localAxis
import ch.brickinventoryapp.shared.ui.localValues

/**
 * Die Achsen der Wertentwicklung folgen der App-Sprache statt der festen
 * Schweizer Form des Servers („03.10“, „CHF 1'234“).
 *
 * Gegenproben:
 *   A  localAxis gibt `punkte` unverändert zurück → rot: die beiden Tagesfälle
 *      und „month resolution shows month and year“
 *   C  maximumFractionDigits = 2 in localValues → rot: „y-Achse ganze Beträge …“
 * Gegenproben: Tagesbeschriftung wieder "MMM d" → rot
 * „English day before month like every date“; withCurrencyGap in localValues
 * entfernt → rot „y-Achse ganze Beträge …“ („CHF1,234“).
 */
class ChartAxesTest {

    private val punkte = listOf(
        DiagrammPunkt("03.10", Geld.aus(100.0)!!, 0.0),
        DiagrammPunkt("", Geld.aus(110.0)!!, 0.5),
        DiagrammPunkt("05.10", Geld.aus(120.0)!!, 1.0),
    )
    private val days = listOf("2026-10-03", "2026-10-04", "2026-10-05")

    @Test
    fun `English day before month like every date`() {
        val l = localAxis(punkte, days, Locale.forLanguageTag("en-GB")).map { it.xLabel }
        assertEquals(listOf("3 Oct", "", "5 Oct"), l)
    }

    @Test
    fun `German with dots like every date`() {
        val l = localAxis(punkte, days, Locale.forLanguageTag("de-CH")).map { it.xLabel }
        assertEquals(listOf("03.10.", "", "05.10."), l)
    }

    @Test
    fun `month resolution shows month and year`() {
        val month = listOf(DiagrammPunkt("10/25", Geld.aus(1.0)!!, 0.0), DiagrammPunkt("11/25", Geld.aus(2.0)!!, 1.0))
        val l = localAxis(month, listOf("2025-10-01", "2025-11-01"), Locale.forLanguageTag("en-GB"))
        assertEquals(listOf("Oct 25", "Nov 25"), l.map { it.xLabel })
    }

    @Test
    fun `without matching days the server's text stays`() {
        assertEquals(punkte, localAxis(punkte, days.take(2), Locale.forLanguageTag("en-GB")))
    }

    @Test
    fun `y axis whole amounts with the language's thousands separators`() {
        val axis = listOf(ChartAxis("CHF 1'234", Geld.aus(1234.0)!!, 0.0), ChartAxis("CHF 2'000", Geld.aus(2000.4)!!, 1.0))
        val en = localValues(axis, Waehrung("CHF"), Locale.forLanguageTag("en-GB")).map { it.label }
        assertTrue(en.toString(), en[0].contains("1,234") && en[1].contains("2,000") && en.none { "." in it })
        assertEquals("CHF\u00A01,234", en[0])
        val de = localValues(axis, Waehrung("CHF"), Locale.forLanguageTag("de-CH")).map { it.label }
        assertTrue(de.toString(), de[0].contains("1’234") || de[0].contains("1'234"))
    }
}
