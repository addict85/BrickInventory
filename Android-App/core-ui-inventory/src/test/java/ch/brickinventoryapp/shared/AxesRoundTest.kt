package ch.brickinventoryapp.shared

import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.model.domain.Waehrung
import ch.brickinventoryapp.model.domain.ChartAxis
import ch.brickinventoryapp.model.domain.PreisDiagrammAnsicht
import ch.brickinventoryapp.model.domain.PricePointView
import ch.brickinventoryapp.model.domain.PriceSeriesView
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale
import ch.brickinventoryapp.shared.ui.PriceChartMath
import ch.brickinventoryapp.shared.ui.localValues

/**
 * Achsen, die man lesen kann: Der Preisverlauf beschriftet runde Werte (790/810/840
 * statt 787/801/816), und das Wertdiagramm kürzt bei grosser Schrift auf „1.7k“.
 *
 * Gegenproben (Patches unter gegenproben/, gemessen nur in der CI):
 *   preisachse-krumm       Schritt ohne Rundung → rot „Wertachse des Preisverlaufs …“
 *   wertachse-ausgeschrieben  kompakt ignoriert → rot „grosse Schrift beschriftet …“
 */
class AxesRoundTest {

    private fun verlauf(vararg werte: Double) = PreisDiagrammAnsicht(
        values = listOf(PriceSeriesView("N", werte.mapIndexed { i, w -> PricePointView("2026-0${i + 1}-01", Geld.aus(w)!!) })),
        x = werte.indices.map { "2026-0${it + 1}-01" })

    @Test
    fun `Wertachse des Preisverlaufs steht auf runden Werten`() {
        for (series in listOf(doubleArrayOf(787.0, 801.0, 816.0), doubleArrayOf(41.9, 44.5, 39.0), doubleArrayOf(1712.4, 1650.0, 1801.0))) {
            val b = PriceChartMath.bounds(PriceChartMath.buildLines(verlauf(*series)))!!
            val ticks = PriceChartMath.yTicks(b)
            assertTrue("Alle Werte im Bereich: $ticks", ticks.first() <= series.min() && ticks.last() >= series.max())
            // Rund heisst: ein Vielfaches der Zehnerpotenz unter einem Viertel der Spanne
            // (Spanne 60 → Zehner, Spanne 8 → Einer).
            val power = Math.pow(10.0, kotlin.math.floor(kotlin.math.log10((ticks.last() - ticks.first()) / 4)))
            for (t in ticks) {
                val rest = Math.IEEEremainder(t, power)
                assertTrue("$t ist kein Vielfaches von $power ($ticks)", kotlin.math.abs(rest) < 1e-6)
            }
        }
    }

    @Test
    fun `grosse Schrift beschriftet die Wertachse kurz`() {
        val axis = listOf(ChartAxis("CHF 1'712", Geld.aus(1712.4)!!, 1.0), ChartAxis("CHF 850", Geld.aus(850.0)!!, 0.0),
            ChartAxis("CHF 12'400", Geld.aus(12_400.0)!!, 0.5))
        val de = Locale.forLanguageTag("de-CH")
        assertEquals(listOf("1.7k", "850", "12k"), localValues(axis, Waehrung("CHF"), de, compact = true).map { it.label })
        // Ohne kompakt bleibt der ausgeschriebene Betrag.
        assertTrue(localValues(axis, Waehrung("CHF"), de).first().label.contains("CHF"))
    }
}
