package ch.brickinventoryapp

import androidx.compose.material3.ColorScheme
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import ch.brickinventoryapp.ui.theme.StatusFarben
import ch.brickinventoryapp.ui.theme.farbschema
import ch.brickinventoryapp.ui.theme.hatDunkleFassung
import ch.brickinventoryapp.ui.theme.statusFarbenFuer
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Jede Schriftrolle erreicht auf jeder Fläche, auf der Material sie zeichnet,
 * 4,5:1 (WCAG 1.4.3) — in allen sechs Designs, hell und in der dunklen Fassung.
 * Dazu sind Fehler- und Hauptfarbe unterscheidbar, damit Rot nicht doppelt spricht.
 *
 * Gegenproben (01.11.2026, kotlinc gegen Compose Desktop, Theme.kt ohne Composable):
 *   A  alte Farben: beide ersten Tests rot, 33 Paare unter 4,5:1, darunter
 *      brick.onSurfaceVariant/background 3,91, classic …/surfaceContainerHighest 3,85,
 *      noppe.primary/background 4,44, onError/error in allen dunklen Fassungen 4,48;
 *      der dritte rot mit noppe 0,03 und noppe/dunkel 0,13.
 *   B  brick.onSurfaceVariant zurück auf #6B7785 → rot (3,91 auf background)
 *   C  noppe.primary zurück auf NoppeRot → rot: „Hauptfarbe zu nah …“ (0,13)
 */
class TextKontrastTest {

    private val designs = listOf("classic", "brick", "werkbank", "farbfaecher", "noppe", "hochglanz")

    private data class Fassung(val name: String, val s: ColorScheme, val status: StatusFarben)

    private val fassungen: List<Fassung> = designs.map { Fassung(it, farbschema(it), statusFarbenFuer(it)) } +
        designs.filter { hatDunkleFassung(it) }.map {
            Fassung("$it/dunkel", farbschema(it, dunkel = true), statusFarbenFuer(it, dunkel = true))
        }

    /** Schrift auf Fläche, so wie Material3 die Rollen paart; dazu Schrift in Haupt-, Fehler- und Gewinnfarbe. */
    private fun textPaare(f: Fassung): Map<String, Pair<Color, Color>> {
        val s = f.s
        val flaechen = mapOf("surface" to s.surface, "background" to s.background,
            "surfaceVariant" to s.surfaceVariant, "surfaceContainerLow" to s.surfaceContainerLow,
            "surfaceContainer" to s.surfaceContainer, "surfaceContainerHigh" to s.surfaceContainerHigh,
            "surfaceContainerHighest" to s.surfaceContainerHighest)
        val paare = mutableMapOf<String, Pair<Color, Color>>()
        for ((n, fl) in flaechen) {
            paare["onSurface/$n"] = s.onSurface to fl
            paare["onSurfaceVariant/$n"] = s.onSurfaceVariant to fl
        }
        for (n in listOf("surface", "background", "surfaceContainer")) {
            paare["primary/$n"] = s.primary to flaechen.getValue(n)
            paare["error/$n"] = s.error to flaechen.getValue(n)
            paare["erfolg/$n"] = f.status.erfolg to flaechen.getValue(n)
            paare["fehler/$n"] = f.status.fehler to flaechen.getValue(n)
        }
        paare["onPrimary/primary"] = s.onPrimary to s.primary
        paare["onPrimaryContainer/primaryContainer"] = s.onPrimaryContainer to s.primaryContainer
        paare["onSecondary/secondary"] = s.onSecondary to s.secondary
        paare["onSecondaryContainer/secondaryContainer"] = s.onSecondaryContainer to s.secondaryContainer
        paare["onTertiary/tertiary"] = s.onTertiary to s.tertiary
        paare["onTertiaryContainer/tertiaryContainer"] = s.onTertiaryContainer to s.tertiaryContainer
        paare["onError/error"] = s.onError to s.error
        paare["onErrorContainer/errorContainer"] = s.onErrorContainer to s.errorContainer
        paare["inverseOnSurface/inverseSurface"] = s.inverseOnSurface to s.inverseSurface
        return paare
    }

    private fun k(a: Color, b: Color) = Kontrast.verhaeltnis(a.toArgb(), b.toArgb())

    @Test
    fun `jede Schriftrolle erreicht 4,5 zu 1 auf ihrer Flaeche`() {
        val fehler = fassungen.flatMap { f ->
            textPaare(f).mapNotNull { (n, p) -> k(p.first, p.second).takeIf { it < 4.5 }?.let { "${f.name}.$n %.2f".format(it) } }
        }
        assertTrue("Unter 4,5:1: $fehler", fehler.isEmpty())
    }

    @Test
    fun `Rahmen von Bedienelementen erreichen 3 zu 1`() {
        val fehler = fassungen.flatMap { f ->
            val s = f.s
            listOf("surface" to s.surface, "background" to s.background, "surfaceVariant" to s.surfaceVariant,
                "surfaceContainerHighest" to s.surfaceContainerHighest, "primaryContainer" to s.primaryContainer)
                .mapNotNull { (n, fl) -> k(s.outline, fl).takeIf { it < Kontrast.RAHMEN }?.let { "${f.name}.outline/$n %.2f".format(it) } }
        }
        assertTrue("Unter 3:1: $fehler", fehler.isEmpty())
    }

    /**
     * Löschen und Fehler dürfen nicht wie die Hauptfarbe aussehen. Maß ist der
     * Abstand im RGB-Raum (0 bis 1,73): Blau gegen Rot liegt über 0,8, das
     * Noppe-Rot #D91F26 neben #B91C1C bei 0,13.
     */
    @Test
    fun `Fehlerfarbe weicht deutlich von der Hauptfarbe ab`() {
        val fehler = fassungen.mapNotNull { f ->
            val a = f.s.primary; val b = f.s.error
            val d = kotlin.math.sqrt(((a.red - b.red) * (a.red - b.red) + (a.green - b.green) * (a.green - b.green) +
                (a.blue - b.blue) * (a.blue - b.blue)).toDouble())
            if (d < 0.15) "${f.name} %.2f".format(d) else null
        }
        assertTrue("Hauptfarbe zu nah an der Fehlerfarbe: $fehler", fehler.isEmpty())
    }
}
