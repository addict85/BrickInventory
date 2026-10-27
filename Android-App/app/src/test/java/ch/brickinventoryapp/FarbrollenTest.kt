package ch.brickinventoryapp

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.luminance
import ch.brickinventoryapp.ui.theme.farbschema
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
