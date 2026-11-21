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
 * Gesperrte Knöpfe und Dialoge in jedem Design, hell und dunkel: Schrift 4,5:1 auf ihrer
 * Fläche, Fläche und Rand eines Knopfs 3:1 auf surface und background, die Schrift eines
 * Dialogs 4,5:1 auf der Dialogfläche und diese 3:1 auf dem abgedunkelten Grund dahinter.
 * Gemessen vorher im Design „noppe“: gesperrte Schrift 2,29:1, Fläche 1,28:1.
 *
 * Gegenproben (gemessen lokal, JVM):
 *   gesperrt-material-deckkraft  Materials feste Deckkraft (12 % / 38 %) → rot „gesperrte Knoepfe …“
 *   dialog-flaeche-grau          Dialogfläche im Hellen outlineVariant → rot „Dialogschrift haelt …“
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
            // Hinter dem Dialog: die Seite unter der Abdunkelung des Fensters. Nur im Hellen: Im
            // Dunkeln trägt die Abdunkelung kaum, dort hebt der Tonwert ab (offen, kein Befund).
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
        /** Abdunkelung hinter einem Dialogfenster (backgroundDimAmount der Plattform). */
        const val DIMMING = 0.6f
    }
}
