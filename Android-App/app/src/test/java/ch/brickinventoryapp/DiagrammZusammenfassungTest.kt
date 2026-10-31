package ch.brickinventoryapp

import ch.brickinventoryapp.data.model.ChartPoint
import ch.brickinventoryapp.ui.model.alsAnsicht
import ch.brickinventoryapp.ui.diagrammZusammenfassung
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Die Zusammenfassung, die PortfolioChart als contentDescription vorliest.
 *
 * Gegenproben (gemessen am 28.10., kotlinc gegen eine Kopie von
 * ui/DiagrammZusammenfassung.kt):
 *   A  die Zahl des Servers übergangen (immer selbst gerechnet) → rot „die
 *      Veraenderung des Servers geht vor"
 *   B  `von` aus dem ersten Punkt statt aus der ersten Beschriftung → rot
 *      „der Zeitraum kommt aus den aeussersten Beschriftungen"
 *   C  Grenze `< 2` → `< 1` → rot „ein einzelner Punkt ist kein Verlauf"
 */
class DiagrammZusammenfassungTest {

    private fun p(label: String, wert: Double) = ChartPoint(xLabel = label, value = wert).alsAnsicht()

    @Test
    fun `ein einzelner Punkt ist kein Verlauf`() {
        assertNull(diagrammZusammenfassung(listOf(p("1. Okt", 100.0)), null))
        assertNull(diagrammZusammenfassung(emptyList(), 5.0))
    }

    @Test
    fun `Anfang, Ende und Veraenderung aus den Punkten`() {
        val z = diagrammZusammenfassung(listOf(p("1. Okt", 200.0), p("8. Okt", 250.0)), null)!!
        assertEquals(200.0, z.anfang, 1e-9)
        assertEquals(250.0, z.ende, 1e-9)
        assertEquals(25.0, z.veraenderungProzent!!, 1e-9)
    }

    @Test
    fun `die Veraenderung des Servers geht vor`() {
        val z = diagrammZusammenfassung(listOf(p("a", 200.0), p("b", 250.0)), 12.5)!!
        assertEquals(12.5, z.veraenderungProzent!!, 1e-9)
    }

    @Test
    fun `der Zeitraum kommt aus den aeussersten Beschriftungen`() {
        val z = diagrammZusammenfassung(
            listOf(p("", 1.0), p("2. Okt", 2.0), p("", 3.0), p("5. Okt", 4.0), p("", 5.0)), null)!!
        assertEquals("2. Okt", z.von)
        assertEquals("5. Okt", z.bis)
    }

    @Test
    fun `ohne Anfangswert gibt es keine Prozentzahl`() {
        assertNull(diagrammZusammenfassung(listOf(p("a", 0.0), p("b", 10.0)), null)!!.veraenderungProzent)
    }
}
