package ch.brickinventoryapp

import ch.brickinventoryapp.data.model.PriceChartData
import ch.brickinventoryapp.data.model.PriceChartPoint
import ch.brickinventoryapp.data.model.PriceChartSeries
import ch.brickinventoryapp.ui.PriceChartMath
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Diagramm-Mathematik für den Preisverlauf (ui/PriceChartMath.kt).
 *
 * Die beiden Fehler, die hier abgesichert werden, sind am Gerät kaum als
 * Fehler zu erkennen — sie sehen wie echte Preisbewegungen aus:
 *
 *   1. Die vom Server vorne aufgefüllten NULLEN als Punkt gezeichnet ergeben
 *      eine Linie, die bei null beginnt und senkrecht hochspringt. Das sieht
 *      aus wie ein Kurssturz, den es nie gab.
 *   2. Eine INDEXBASIERTE x-Achse streckt zwei unterschiedlich lange Reihen
 *      beide über die volle Breite. Punkte aus verschiedenen Monaten liegen
 *      dann übereinander, und das Diagramm zeigt einen Vergleich, den es
 *      nicht gibt. Gebrauchtpreise setzen für viele Sets später ein — der
 *      Normalfall, nicht die Ausnahme.
 */
class PriceChartMathTest {

    private fun series(name: String, first: Int, vararg pts: Pair<String, Double>) =
        PriceChartSeries(
            name = name,
            values = pts.map { PriceChartPoint(it.first, it.second) },
            firstRealIndex = first
        )

    @Test
    fun `aufgefuellte Nullen vor firstRealIndex werden nicht gezeichnet`() {
        // Gebraucht setzt erst am dritten Messpunkt ein.
        val chart = PriceChartData(
            values = listOf(
                series("N", 0, "2026-01-01" to 100.0, "2026-02-01" to 110.0, "2026-03-01" to 120.0),
                series("U", 2, "2026-01-01" to 0.0, "2026-02-01" to 0.0, "2026-03-01" to 80.0),
            ),
            x = listOf("2026-01-01", "2026-02-01", "2026-03-01")
        )
        val lines = PriceChartMath.buildLines(chart)
        assertEquals(2, lines.size)
        val used = lines.first { it.condition == "U" }
        assertEquals("nur der echte Wert bleibt übrig", 1, used.points.size)
        assertEquals(80.0, used.points[0].value, 0.0001)
    }

    @Test
    fun `eine 0 nach firstRealIndex zaehlt ebenfalls als kein Wert`() {
        // Der Server füllt nur vorne auf — eine 0 mittendrin wäre ein Preis von
        // null Franken, den es nicht gibt. Sicherheitshalber trotzdem raus.
        val chart = PriceChartData(
            values = listOf(series("N", 0, "2026-01-01" to 100.0, "2026-02-01" to 0.0)),
            x = listOf("2026-01-01", "2026-02-01")
        )
        assertEquals(1, PriceChartMath.buildLines(chart).first().points.size)
    }

    @Test
    fun `eine Reihe ganz ohne echte Werte faellt weg`() {
        val chart = PriceChartData(
            values = listOf(
                series("N", 0, "2026-01-01" to 100.0),
                series("U", 1, "2026-01-01" to 0.0),
            ),
            x = listOf("2026-01-01")
        )
        val lines = PriceChartMath.buildLines(chart)
        assertEquals("keine Legendenzeile ohne Linie", 1, lines.size)
        assertEquals("N", lines[0].condition)
    }

    @Test
    fun `die x-Position kommt vom Datum, nicht vom Index`() {
        // Zwei Reihen unterschiedlicher Länge: Der gemeinsame letzte Tag muss
        // bei beiden an derselben Stelle landen, der spätere Beginn der
        // zweiten Reihe weiter rechts.
        val chart = PriceChartData(
            values = listOf(
                series("N", 0, "2026-01-01" to 100.0, "2026-07-01" to 110.0),
                series("U", 1, "2026-01-01" to 0.0, "2026-07-01" to 80.0),
            ),
            x = listOf("2026-01-01", "2026-07-01")
        )
        val lines = PriceChartMath.buildLines(chart)
        val b = PriceChartMath.bounds(lines)!!
        val newLine  = lines.first { it.condition == "N" }
        val usedLine = lines.first { it.condition == "U" }

        assertEquals(0f, b.xFraction(newLine.points.first().day), 0.0001f)
        assertEquals(1f, b.xFraction(newLine.points.last().day), 0.0001f)
        assertEquals("gemeinsamer letzter Tag → gleiche Position",
            b.xFraction(newLine.points.last().day),
            b.xFraction(usedLine.points.first().day), 0.0001f)
        assertTrue("die kürzere Reihe darf nicht gestreckt werden",
            b.xFraction(usedLine.points.first().day) > 0.5f)
    }

    @Test
    fun `beide Reihen teilen sich eine Skala`() {
        // Der interessante Vergleich ist der ABSTAND zwischen Neu und
        // Gebraucht; getrennte Skalen machen genau den unsichtbar.
        val chart = PriceChartData(
            values = listOf(
                series("N", 0, "2026-01-01" to 200.0),
                series("U", 0, "2026-01-01" to 100.0),
            ),
            x = listOf("2026-01-01")
        )
        val b = PriceChartMath.bounds(PriceChartMath.buildLines(chart))!!
        assertTrue(b.minValue < 100.0)
        assertTrue(b.maxValue > 200.0)
        // Gebraucht liegt tiefer als Neu (y wird von oben gemessen).
        assertTrue(b.yFraction(100.0) > b.yFraction(200.0))
    }

    @Test
    fun `alle Werte gleich ergibt trotzdem eine brauchbare Spanne`() {
        // Sonst wäre die Spanne 0 und die Division im Zeichencode undefiniert.
        val chart = PriceChartData(
            values = listOf(series("N", 0, "2026-01-01" to 50.0, "2026-02-01" to 50.0)),
            x = listOf("2026-01-01", "2026-02-01")
        )
        val b = PriceChartMath.bounds(PriceChartMath.buildLines(chart))!!
        assertTrue(b.maxValue > b.minValue)
        assertTrue("keine negative Achse", b.minValue >= 0.0)
    }

    @Test
    fun `leere Daten ergeben nichts zu zeichnen`() {
        assertTrue(PriceChartMath.buildLines(PriceChartData()).isEmpty())
        assertNull(PriceChartMath.bounds(emptyList()))
        assertNull(PriceChartMath.axisRange(PriceChartData()))
    }

    @Test
    fun `Datumsformat und Achsenraender`() {
        assertEquals("31.1.2026", PriceChartMath.formatDay("2026-01-31"))
        assertEquals("31.1.2026", PriceChartMath.formatDay("2026-01-31T10:00:00Z"))
        assertEquals("kaputt", PriceChartMath.formatDay("kaputt"))
        val range = PriceChartMath.axisRange(
            PriceChartData(x = listOf("2026-01-01", "2026-02-01", "2026-03-01")))
        assertEquals("2026-01-01" to "2026-03-01", range)
    }
}
