package ch.brickinventoryapp.ui

import androidx.compose.material3.ColorScheme
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.toArgb
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.ui.theme.colorScheme
import ch.brickinventoryapp.ui.theme.hasDarkVersion
import ch.brickinventoryapp.ui.theme.lockedColors
import ch.brickinventoryapp.ui.theme.windowSurface
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Locked buttons and dialogs in every design, light and dark: text 4.5:1 on its
 * surface, a button's surface and border 3:1 on surface and background, a dialog's
 * text 4.5:1 on the dialog surface and that surface 3:1 on the dimmed background
 * behind it. Measured beforehand in the `noppe` design: locked text 2.29:1, surface 1.28:1.
 *
 * Counter-checks (measured locally, JVM):
 *   gesperrt-material-deckkraft  Material's fixed opacity (12% / 38%) → red „gesperrte Knoepfe …“
 *   dialog-flaeche-grau          dialog surface at outlineVariant in the light → red „Dialogschrift haelt …“
 */
class LockedContrastTest {

    private val versions: List<Pair<String, ColorScheme>> =
        Design.entries.map { it.identifier to colorScheme(it) } +
            Design.entries.filter { hasDarkVersion(it) }.map { "${it.identifier}/dunkel" to colorScheme(it, dark = true) }

    private fun k(a: Color, b: Color) = Contrast.ratio(a.toArgb(), b.toArgb())

    @Test
    fun `disabled buttons keep 4,5 to 1 for text and 3 to 1 for surface and border`() {
        val error = mutableListOf<String>()
        for ((name, s) in versions) {
            val g = lockedColors(s)
            if (k(g.onSurface, g.surface) < TEXT) error += "$name Schrift/Fläche %.2f".format(k(g.onSurface, g.surface))
            for ((reason, color) in listOf("surface" to s.surface, "background" to s.background)) {
                if (k(g.surface, color) < GRAPHIC) error += "$name Fläche/$reason %.2f".format(k(g.surface, color))
                if (k(g.edge, color) < GRAPHIC) error += "$name Rand/$reason %.2f".format(k(g.edge, color))
                if (k(g.font, color) < TEXT) error += "$name Schrift/$reason %.2f".format(k(g.font, color))
            }
        }
        assertTrue("Gesperrte Knöpfe zu blass: $error", error.isEmpty())
    }

    @Test
    fun `dialog text keeps 4,5 to 1 and the dialog stands out with 3 to 1 from the background`() {
        val error = mutableListOf<String>()
        for ((name, s) in versions) {
            val surface = windowSurface(s)
            for ((role, color) in listOf("onSurface" to s.onSurface, "onSurfaceVariant" to s.onSurfaceVariant,
                                          "primary" to s.primary, "error" to s.error)) {
                if (k(color, surface) < TEXT) error += "$name $role %.2f".format(k(color, surface))
            }
            // Behind the dialog: the page under the window's dimming. Only in the light: in the
            // dark the dimming barely carries, there the tone value is the deciding factor (open, no finding).
            if (s.surface.luminance() < 0.5f) continue
            for ((reason, color) in listOf("surface" to s.surface, "background" to s.background)) {
                val behind = Color.Black.copy(alpha = DIMMING).compositeOver(color)
                if (k(surface, behind) < GRAPHIC) error += "$name Dialog/$reason %.2f".format(k(surface, behind))
            }
        }
        assertTrue("Dialoge zu blass: $error", error.isEmpty())
    }

    private companion object {
        const val TEXT = 4.5
        const val GRAPHIC = 3.0
        /** Dimming behind a dialog window (platform's backgroundDimAmount). */
        const val DIMMING = 0.6f
    }
}
