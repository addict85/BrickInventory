package ch.brickinventoryapp

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.toArgb
import ch.brickinventoryapp.ui.theme.farbschema
import ch.brickinventoryapp.ui.theme.statusFarbenFuer
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Jedes Design belegt die Rollen, die Dialoge, Menüs, Snackbar und Textfelder
 * lesen, mit eigenen Farben statt mit der lila Grundpalette von Material3.
 *
 * Gegenprobe: `.let { ergaenzeRollen(…) }` in farbschema() entfernt — beide
 * Tests rot (surfaceContainer* gleich der Grundpalette, im dunklen Werkbank-
 * Design zudem die Stufen falsch herum). tertiaryContainer in NoppeColors
 * entfernt — der erste Test rot für "noppe" und "hochglanz".
 *
 * Gegenprobe Rahmen (28.10., ohne Android-SDK am Nachbau gemessen: dieselbe
 * Formel in Python, Flächenstufen in Oklab gemischt wie Compose): mit den alten
 * outline-Werten rot für classic (1,00:1 gegen surfaceContainerHighest), brick
 * (1,19), werkbank (1,03) und farbfaecher (1,01); noppe blieb grün (13,8).
 */
class FarbrollenTest {

    private val designs = listOf("classic", "brick", "werkbank", "farbfaecher", "noppe", "hochglanz")

    private val rollen: List<Pair<String, (ColorScheme) -> Any>> = listOf(
        "surfaceContainerLow" to { it.surfaceContainerLow },
        "surfaceContainer" to { it.surfaceContainer },
        "surfaceContainerHigh" to { it.surfaceContainerHigh },
        "surfaceContainerHighest" to { it.surfaceContainerHighest },
        "surfaceDim" to { it.surfaceDim },
        "outlineVariant" to { it.outlineVariant },
        "inverseSurface" to { it.inverseSurface },
        "inverseOnSurface" to { it.inverseOnSurface },
        "inversePrimary" to { it.inversePrimary },
        "tertiaryContainer" to { it.tertiaryContainer },
        "onTertiaryContainer" to { it.onTertiaryContainer },
        "errorContainer" to { it.errorContainer },
        "onBackground" to { it.onBackground },
    )

    /**
     * Gegenprobe (28.10.2026, ohne Android-SDK an der WCAG-Formel gemessen):
     * mit dem alten #16A34A rot für classic (3,30:1 auf surface), farbfaecher
     * und noppe; mit #15803D rot für noppe (4,43:1 auf background).
     */
    @Test
    fun `Gewinnfarbe ist als Text auf jeder Flaeche lesbar`() {
        val fehler = mutableListOf<String>()
        for (d in designs) {
            val s = farbschema(d)
            val erfolg = statusFarbenFuer(d).erfolg.toArgb()
            for ((name, flaeche) in listOf("surface" to s.surface, "surfaceContainer" to s.surfaceContainer,
                                           "background" to s.background)) {
                val k = Kontrast.verhaeltnis(erfolg, flaeche.toArgb())
                if (k < 4.5) fehler += "$d.$name %.2f".format(k)
            }
        }
        assertTrue("Gewinnfarbe unter 4,5:1: $fehler", fehler.isEmpty())
    }

    @Test
    fun `kein Design erbt Rollen aus der Grundpalette`() {
        val fehler = mutableListOf<String>()
        for (d in designs) {
            val s = farbschema(d)
            val grund = if (d == "werkbank") darkColorScheme() else lightColorScheme()
            for ((name, rolle) in rollen) {
                if (rolle(s) == rolle(grund)) fehler += "$d.$name"
            }
        }
        assertTrue("Aus der Material-Grundpalette geerbt: $fehler", fehler.isEmpty())
    }

    @Test
    fun `outline hebt sich mit mindestens 3 zu 1 von jeder Flaeche ab`() {
        val fehler = mutableListOf<String>()
        for (d in designs) {
            val s = farbschema(d)
            val rahmen = s.outline.toArgb()
            val flaechen = mapOf("surface" to s.surface, "background" to s.background,
                "surfaceVariant" to s.surfaceVariant, "surfaceContainerHigh" to s.surfaceContainerHigh,
                "surfaceContainerHighest" to s.surfaceContainerHighest)
            for ((name, flaeche) in flaechen) {
                val k = Kontrast.verhaeltnis(rahmen, flaeche.toArgb())
                if (k < Kontrast.RAHMEN) fehler += "$d.outline/$name " + "%.2f".format(k)
            }
            // Trennlinien nehmen outlineVariant; es muss der leisere Ton bleiben.
            val leise = Kontrast.verhaeltnis(s.outlineVariant.toArgb(), s.surface.toArgb())
            if (leise >= Kontrast.verhaeltnis(rahmen, s.surface.toArgb())) fehler += "$d.outlineVariant"
        }
        assertTrue("Zu schwache Rahmen: $fehler", fehler.isEmpty())
    }

    @Test
    fun `Flaechenstufen entfernen sich schrittweise von surface`() {
        for (d in designs) {
            val s = farbschema(d)
            val stufen = listOf(s.surface, s.surfaceContainerLow, s.surfaceContainer,
                s.surfaceContainerHigh, s.surfaceContainerHighest).map { it.luminance() }
            // Im Hellen wird jede Stufe dunkler, im Dunklen heller.
            val richtig = if (d == "werkbank") stufen.zipWithNext().all { (a, b) -> b > a }
                          else stufen.zipWithNext().all { (a, b) -> b < a }
            assertTrue("$d: Helligkeit der Stufen $stufen", richtig)
        }
    }
}
