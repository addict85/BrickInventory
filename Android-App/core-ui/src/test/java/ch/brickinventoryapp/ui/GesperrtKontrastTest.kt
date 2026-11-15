package ch.brickinventoryapp.ui

import androidx.compose.material3.ColorScheme
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.toArgb
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.ui.theme.fensterFlaeche
import ch.brickinventoryapp.ui.theme.farbschema
import ch.brickinventoryapp.ui.theme.gesperrtFarben
import ch.brickinventoryapp.ui.theme.hatDunkleFassung
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
class GesperrtKontrastTest {

    private val fassungen: List<Pair<String, ColorScheme>> =
        Design.entries.map { it.kennung to farbschema(it) } +
            Design.entries.filter { hatDunkleFassung(it) }.map { "${it.kennung}/dunkel" to farbschema(it, dunkel = true) }

    private fun k(a: Color, b: Color) = Kontrast.verhaeltnis(a.toArgb(), b.toArgb())

    @Test
    fun `gesperrte Knoepfe halten 4,5 zu 1 fuer Schrift und 3 zu 1 fuer Flaeche und Rand`() {
        val fehler = mutableListOf<String>()
        for ((name, s) in fassungen) {
            val g = gesperrtFarben(s)
            if (k(g.aufFlaeche, g.flaeche) < TEXT) fehler += "$name Schrift/Fläche %.2f".format(k(g.aufFlaeche, g.flaeche))
            for ((grund, farbe) in listOf("surface" to s.surface, "background" to s.background)) {
                if (k(g.flaeche, farbe) < GRAFIK) fehler += "$name Fläche/$grund %.2f".format(k(g.flaeche, farbe))
                if (k(g.rand, farbe) < GRAFIK) fehler += "$name Rand/$grund %.2f".format(k(g.rand, farbe))
                if (k(g.schrift, farbe) < TEXT) fehler += "$name Schrift/$grund %.2f".format(k(g.schrift, farbe))
            }
        }
        assertTrue("Gesperrte Knöpfe zu blass: $fehler", fehler.isEmpty())
    }

    @Test
    fun `Dialogschrift haelt 4,5 zu 1 und der Dialog hebt sich mit 3 zu 1 vom Grund ab`() {
        val fehler = mutableListOf<String>()
        for ((name, s) in fassungen) {
            val flaeche = fensterFlaeche(s)
            for ((rolle, farbe) in listOf("onSurface" to s.onSurface, "onSurfaceVariant" to s.onSurfaceVariant,
                                          "primary" to s.primary, "error" to s.error)) {
                if (k(farbe, flaeche) < TEXT) fehler += "$name $rolle %.2f".format(k(farbe, flaeche))
            }
            // Hinter dem Dialog: die Seite unter der Abdunkelung des Fensters. Nur im Hellen: Im
            // Dunkeln trägt die Abdunkelung kaum, dort hebt der Tonwert ab (offen, kein Befund).
            if (s.surface.luminance() < 0.5f) continue
            for ((grund, farbe) in listOf("surface" to s.surface, "background" to s.background)) {
                val dahinter = Color.Black.copy(alpha = ABDUNKELUNG).compositeOver(farbe)
                if (k(flaeche, dahinter) < GRAFIK) fehler += "$name Dialog/$grund %.2f".format(k(flaeche, dahinter))
            }
        }
        assertTrue("Dialoge zu blass: $fehler", fehler.isEmpty())
    }

    private companion object {
        const val TEXT = 4.5
        const val GRAFIK = 3.0
        /** Abdunkelung hinter einem Dialogfenster (backgroundDimAmount der Plattform). */
        const val ABDUNKELUNG = 0.6f
    }
}
