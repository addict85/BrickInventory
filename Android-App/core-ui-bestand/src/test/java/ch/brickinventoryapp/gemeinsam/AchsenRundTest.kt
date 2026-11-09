package ch.brickinventoryapp.gemeinsam

import ch.brickinventoryapp.model.ui.model.DiagrammAchse
import ch.brickinventoryapp.model.ui.model.PreisDiagrammAnsicht
import ch.brickinventoryapp.model.ui.model.PreisPunktAnsicht
import ch.brickinventoryapp.model.ui.model.PreisReiheAnsicht
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale
import ch.brickinventoryapp.gemeinsam.ui.PriceChartMath
import ch.brickinventoryapp.gemeinsam.ui.lokaleWerte

/**
 * Achsen, die man lesen kann: Der Preisverlauf beschriftet runde Werte (790/810/840
 * statt 787/801/816), und das Wertdiagramm kürzt bei grosser Schrift auf „1.7k“.
 *
 * Gegenproben (Patches unter gegenproben/, gemessen nur in der CI):
 *   preisachse-krumm       Schritt ohne Rundung → rot „Wertachse des Preisverlaufs …“
 *   wertachse-ausgeschrieben  kompakt ignoriert → rot „grosse Schrift beschriftet …“
 */
class AchsenRundTest {

    private fun verlauf(vararg werte: Double) = PreisDiagrammAnsicht(
        values = listOf(PreisReiheAnsicht("N", werte.mapIndexed { i, w -> PreisPunktAnsicht("2026-0${i + 1}-01", w) })),
        x = werte.indices.map { "2026-0${it + 1}-01" })

    @Test
    fun `Wertachse des Preisverlaufs steht auf runden Werten`() {
        for (reihe in listOf(doubleArrayOf(787.0, 801.0, 816.0), doubleArrayOf(41.9, 44.5, 39.0), doubleArrayOf(1712.4, 1650.0, 1801.0))) {
            val b = PriceChartMath.bounds(PriceChartMath.buildLines(verlauf(*reihe)))!!
            val ticks = PriceChartMath.yTicks(b)
            assertTrue("Alle Werte im Bereich: $ticks", ticks.first() <= reihe.min() && ticks.last() >= reihe.max())
            // Rund heisst: ein Vielfaches der Zehnerpotenz unter einem Viertel der Spanne
            // (Spanne 60 → Zehner, Spanne 8 → Einer).
            val potenz = Math.pow(10.0, kotlin.math.floor(kotlin.math.log10((ticks.last() - ticks.first()) / 4)))
            for (t in ticks) {
                val rest = Math.IEEEremainder(t, potenz)
                assertTrue("$t ist kein Vielfaches von $potenz ($ticks)", kotlin.math.abs(rest) < 1e-6)
            }
        }
    }

    @Test
    fun `grosse Schrift beschriftet die Wertachse kurz`() {
        val achse = listOf(DiagrammAchse("CHF 1'712", 1712.4, 1.0), DiagrammAchse("CHF 850", 850.0, 0.0),
            DiagrammAchse("CHF 12'400", 12_400.0, 0.5))
        val de = Locale.forLanguageTag("de-CH")
        assertEquals(listOf("1.7k", "850", "12k"), lokaleWerte(achse, "CHF", de, kompakt = true).map { it.label })
        // Ohne kompakt bleibt der ausgeschriebene Betrag.
        assertTrue(lokaleWerte(achse, "CHF", de).first().label.contains("CHF"))
    }
}
