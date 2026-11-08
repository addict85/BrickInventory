package ch.brickinventoryapp.ui

import androidx.compose.ui.graphics.Color
import ch.brickinventoryapp.ui.theme.akzentflaechen
import ch.brickinventoryapp.ui.theme.farbschema
import ch.brickinventoryapp.ui.theme.hatDunkleFassung
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Rot heisst Verlust oder Fehler. Die Flächen, die einen Wert oder einen Zustand
 * tragen — Hauptfarbe, ihr Container („Neu“-Plakette, Marktwert-Karte im Dunkeln),
 * secondaryContainer (gewählte Chips, Hinweise) und die Marktwert-Kachel —, sind in
 * keinem Design und keiner Fassung rot.
 *
 * Gegenproben (Patches unter gegenproben/, gemessen nur in der CI):
 *   noppe-container-rot        primaryContainer von Noppe wieder NoppeRotHell
 *                              → rot „Wert- und Zustandsflaechen sind nie rot“ (noppe.primaryContainer)
 *   noppe-dunkel-container-rot Noppe im Dunkeln ohne eigenen primaryContainer (wieder #2a1415)
 *                              → rot „Wert- und Zustandsflaechen sind nie rot“ (noppe/dunkel.primaryContainer)
 */
class RotNurFuerWarnungTest {

    private val designs = listOf("classic", "brick", "werkbank", "farbfaecher", "noppe", "hochglanz")

    /** Farbton in Grad und Buntheit (max − min der Kanäle); Grau hat keinen Ton. */
    private fun tonUndBuntheit(c: Color): Pair<Float, Float> {
        val r = c.red; val g = c.green; val b = c.blue
        val max = maxOf(r, g, b); val min = minOf(r, g, b); val d = max - min
        if (d == 0f) return 0f to 0f
        val ton = when (max) {
            r -> 60f * (((g - b) / d) % 6f)
            g -> 60f * ((b - r) / d + 2f)
            else -> 60f * ((r - g) / d + 4f)
        }
        return (if (ton < 0f) ton + 360f else ton) to d
    }

    /** Rot: Ton zwischen 340° und 20° und sichtbar bunt (nicht ein warmes Grau). */
    private fun rot(c: Color): Boolean {
        val (ton, buntheit) = tonUndBuntheit(c)
        return buntheit >= MIN_BUNTHEIT && (ton >= 340f || ton <= 20f)
    }

    @Test
    fun `Wert- und Zustandsflaechen sind nie rot`() {
        val fassungen = designs.map { it to false } + designs.filter { hatDunkleFassung(it) }.map { it to true }
        val fehler = fassungen.flatMap { (design, dunkel) ->
            val s = farbschema(design, dunkel)
            val name = if (dunkel) "$design/dunkel" else design
            listOf("primary" to s.primary, "primaryContainer" to s.primaryContainer,
                "secondaryContainer" to s.secondaryContainer,
                "markt" to akzentflaechen(design, dunkel, s).markt)
                .filter { (_, c) -> rot(c) }.map { (rolle, _) -> "$name.$rolle" }
        }
        assertTrue("Rot auf einer Wert- oder Zustandsfläche: $fehler", fehler.isEmpty())
    }

    /** Die Messung selbst: Fehlerrot erkennt sie, Blau, Grau und Sand nicht. */
    @Test
    fun `die Rotmessung trennt Rot von Blau, Grau und Sand`() {
        assertTrue(rot(Color(0xFFB91C1C)))
        assertTrue(rot(Color(0xFFFDECEC)))
        assertTrue(!rot(Color(0xFF2563EB)) && !rot(Color(0xFFF4F4F4)) && !rot(Color(0xFFE9DED0)))
    }

    private companion object {
        /** Ab hier ist ein Ton sichtbar; darunter liegen die warmen Grautöne der Flächen. */
        const val MIN_BUNTHEIT = 0.05f
    }
}
