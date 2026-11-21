package ch.brickinventoryapp.ui

import ch.brickinventoryapp.model.ui.theme.Design
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.toArgb
import ch.brickinventoryapp.ui.theme.farbschema
import ch.brickinventoryapp.ui.theme.hatDarkVersion
import ch.brickinventoryapp.ui.theme.skeletonTone
import ch.brickinventoryapp.ui.theme.statusColorsFor
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Jedes Design belegt die Rollen, die Dialoge, Menüs, Snackbar und Textfelder
 * lesen, mit eigenen Farben statt mit der lila Grundpalette von Material3.
 *
 * Gegenprobe: `.let { supplementRoles(…) }` in farbschema() entfernt — beide
 * Tests rot (surfaceContainer* gleich der Grundpalette, im dunklen Werkbank-
 * Design zudem die Stufen falsch herum). tertiaryContainer in StudColors
 * entfernt — der erste Test rot für "noppe" und "hochglanz".
 *
 * Gegenprobe Rahmen (28.10., ohne Android-SDK am Nachbau gemessen: dieselbe
 * Formel in Python, Flächenstufen in Oklab gemischt wie Compose): mit den alten
 * outline-Werten rot für classic (1,00:1 gegen surfaceContainerHighest), brick
 * (1,19), werkbank (1,03) und farbfaecher (1,01); noppe blieb grün (13,8).
 */
class ColorRolesTest {

    private val hell = Design.entries

    /** Jedes Design, dazu seine dunkle Fassung (DunkelTokens.kt): Name, Schema, Statusfarben, dunkel? */
    private data class Fassung(val name: String, val schema: ColorScheme, val erfolg: Int, val dunkel: Boolean)

    private val versions: List<Fassung> = hell.map {
        Fassung(it.kennung, farbschema(it), statusColorsFor(it).erfolg.toArgb(), it == Design.WERKBANK)
    } + hell.filter { hatDarkVersion(it) }.map {
        Fassung("${it.kennung}/dunkel", farbschema(it, dunkel = true), statusColorsFor(it, dunkel = true).erfolg.toArgb(), true)
    }

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
     * Gegenprobe:
     * mit dem alten #16A34A rot für classic (3,30:1 auf surface), farbfaecher
     * und noppe; mit #15803D rot für noppe (4,43:1 auf background).
     */
    @Test
    fun `profit color is readable as text on every surface`() {
        val fehler = mutableListOf<String>()
        for (f in versions) {
            val d = f.name
            val s = f.schema
            val erfolg = f.erfolg
            for ((name, flaeche) in listOf("surface" to s.surface, "surfaceContainer" to s.surfaceContainer,
                                           "background" to s.background)) {
                val k = Contrast.verhaeltnis(erfolg, flaeche.toArgb())
                if (k < 4.5) fehler += "$d.$name %.2f".format(k)
            }
        }
        assertTrue("Gewinnfarbe unter 4,5:1: $fehler", fehler.isEmpty())
    }

    @Test
    fun `no design inherits roles from the base palette`() {
        val fehler = mutableListOf<String>()
        for (f in versions) {
            val d = f.name
            val s = f.schema
            val grund = if (f.dunkel) darkColorScheme() else lightColorScheme()
            for ((name, rolle) in rollen) {
                if (rolle(s) == rolle(grund)) fehler += "$d.$name"
            }
        }
        assertTrue("Aus der Material-Grundpalette geerbt: $fehler", fehler.isEmpty())
    }

    @Test
    fun `outline stands out with at least 3 to 1 from every surface`() {
        val fehler = mutableListOf<String>()
        for (f in versions) {
            val d = f.name
            val s = f.schema
            val frame = s.outline.toArgb()
            val surfaces = mapOf("surface" to s.surface, "background" to s.background,
                "surfaceVariant" to s.surfaceVariant, "surfaceContainerHigh" to s.surfaceContainerHigh,
                "surfaceContainerHighest" to s.surfaceContainerHighest)
            for ((name, flaeche) in surfaces) {
                val k = Contrast.verhaeltnis(frame, flaeche.toArgb())
                if (k < Contrast.FRAME) fehler += "$d.outline/$name " + "%.2f".format(k)
            }
            // Trennlinien nehmen outlineVariant; es muss der leisere Ton bleiben.
            val quiet = Contrast.verhaeltnis(s.outlineVariant.toArgb(), s.surface.toArgb())
            if (quiet >= Contrast.verhaeltnis(frame, s.surface.toArgb())) fehler += "$d.outlineVariant"
        }
        assertTrue("Zu schwache Rahmen: $fehler", fehler.isEmpty())
    }

    /**
     * Das Ladeskelett (Skelett.kt) zeichnet skeletonTone auf background.
     * Gegenprobe: in skeletonTone surfaceVariant zurückgegeben →
     * rot „Ladekacheln heben sich …“ (classic 1,05, brick 1,03, farbfaecher 1,05, noppe 1,07).
     */
    @Test
    fun `loading tiles stand out from the background`() {
        val fehler = mutableListOf<String>()
        for (f in versions) {
            val k = Contrast.verhaeltnis(skeletonTone(f.schema).toArgb(), f.schema.background.toArgb())
            if (k < SKELETON_CONTRAST) fehler += "${f.name} %.2f".format(k)
        }
        assertTrue("Ladekacheln zu blass: $fehler", fehler.isEmpty())
    }

    private companion object {
        /** Keine Textgrenze, aber sichtbar: deutlich über den gemessenen 1,05:1. */
        const val SKELETON_CONTRAST = 1.2
    }

    @Test
    fun `surface levels move away from surface step by step`() {
        for (f in versions) {
            val d = f.name
            val s = f.schema
            val stufen = listOf(s.surface, s.surfaceContainerLow, s.surfaceContainer,
                s.surfaceContainerHigh, s.surfaceContainerHighest).map { it.luminance() }
            // Im Hellen wird jede Stufe dunkler, im Dunklen heller.
            val correct = if (f.dunkel) stufen.zipWithNext().all { (a, b) -> b > a }
                          else stufen.zipWithNext().all { (a, b) -> b < a }
            assertTrue("$d: Helligkeit der Stufen $stufen", correct)
        }
    }

    /**
     * Werkbank ist ein eigenes Design, nicht „Klassisch dunkel“ unter anderem Namen: warmes
     * Graphit und Messing gegen kühles Anthrazit und Blau, wie themes/werkbank.css.
     * Gegenprobe werkbank-wie-klassisch-dunkel: Werkbank wieder mit den kühlen Flächen und
     * Hellblau als Zweitfarbe → rot.
     */
    @Test
    fun `Workbench and Classic dark differ in surface and accent`() {
        val werkbank = farbschema(Design.WERKBANK)
        val classic = farbschema(Design.CLASSIC, dunkel = true)
        assertTrue("Werkbank-Fläche nicht warm: ${werkbank.surface}", werkbank.surface.red > werkbank.surface.blue)
        assertTrue("Klassisch dunkel nicht kühl: ${classic.surface}", classic.surface.blue > classic.surface.red)
        assertTrue("Werkbank-Zweitfarbe nicht warm: ${werkbank.secondary}", werkbank.secondary.red > werkbank.secondary.blue)
    }
}
