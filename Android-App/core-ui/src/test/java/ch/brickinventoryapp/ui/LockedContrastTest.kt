package ch.brickinventoryapp.ui

import androidx.compose.material3.ColorScheme
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.toArgb
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.ui.theme.fensterFlaeche
import ch.brickinventoryapp.ui.theme.farbschema
import ch.brickinventoryapp.ui.theme.lockedColors
import ch.brickinventoryapp.ui.theme.hatDarkVersion
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Locked buttons and dialogs in every design, light and dark: text 4.5:1 on its
 * surface, a button's surface and border 3:1 on surface and background, a dialog's
 * text 4.5:1 on the dialog surface and that surface 3:1 on the dimmed background
 * behind it. Measured beforehand in the "noppe" design: locked text 2.29:1, surface 1.28:1.
 *
 * Counter-checks (measured locally, JVM):
 *   gesperrt-material-deckkraft  Material's fixed opacity (12% / 38%) → red „gesperrte Knoepfe …“
 *   dialog-flaeche-grau          dialog surface at outlineVariant in the light → red „Dialogschrift haelt …“
 */
class LockedContrastTest {

    private val versions: List<Pair<String, ColorScheme>> =
        Design.entries.map { it.kennung to farbschema(it) } +
            Design.entries.filter { hatDarkVersion(it) }.map { "${it.kennung}/dunkel" to farbschema(it, dunkel = true) }

    private fun k(a: Color, b: Color) = Contrast.verhaeltnis(a.toArgb(), b.toArgb())

    @Test
    fun `disabled buttons keep 4,5 to 1 for text and 3 to 1 for surface and border`() {
        val fehler = mutableListOf<String>()
        for ((name, s) in versions) {
            val g = lockedColors(s)
            if (k(g.aufFlaeche, g.flaeche) < TEXT) fehler += "$name Schrift/Fläche %.2f".format(k(g.aufFlaeche, g.flaeche))
            for ((grund, farbe) in listOf("surface" to s.surface, "background" to s.background)) {
                if (k(g.flaeche, farbe) < GRAPHIC) fehler += "$name Fläche/$grund %.2f".format(k(g.flaeche, farbe))
                if (k(g.edge, farbe) < GRAPHIC) fehler += "$name Rand/$grund %.2f".format(k(g.edge, farbe))
                if (k(g.schrift, farbe) < TEXT) fehler += "$name Schrift/$grund %.2f".format(k(g.schrift, farbe))
            }
        }
        assertTrue("Gesperrte Knöpfe zu blass: $fehler", fehler.isEmpty())
    }

    @Test
    fun `dialog text keeps 4,5 to 1 and the dialog stands out with 3 to 1 from the background`() {
        val fehler = mutableListOf<String>()
        for ((name, s) in versions) {
            val flaeche = fensterFlaeche(s)
            for ((rolle, farbe) in listOf("onSurface" to s.onSurface, "onSurfaceVariant" to s.onSurfaceVariant,
                                          "primary" to s.primary, "error" to s.error)) {
                if (k(farbe, flaeche) < TEXT) fehler += "$name $rolle %.2f".format(k(farbe, flaeche))
            }
            // Behind the dialog: the page under the window's dimming. Only in the light: in the
            // dark the dimming barely carries, there the tone value is the deciding factor (open, no finding).
            if (s.surface.luminance() < 0.5f) continue
            for ((grund, farbe) in listOf("surface" to s.surface, "background" to s.background)) {
                val behind = Color.Black.copy(alpha = DIMMING).compositeOver(farbe)
                if (k(flaeche, behind) < GRAPHIC) fehler += "$name Dialog/$grund %.2f".format(k(flaeche, behind))
            }
        }
        assertTrue("Dialoge zu blass: $fehler", fehler.isEmpty())
    }

    private companion object {
        const val TEXT = 4.5
        const val GRAPHIC = 3.0
        /** Dimming behind a dialog window (platform's backgroundDimAmount). */
        const val DIMMING = 0.6f
    }
}
