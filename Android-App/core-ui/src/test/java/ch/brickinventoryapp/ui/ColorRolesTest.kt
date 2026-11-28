package ch.brickinventoryapp.ui

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.toArgb
import ch.brickinventoryapp.model.appearance.Design
import ch.brickinventoryapp.ui.theme.colorScheme
import ch.brickinventoryapp.ui.theme.hasDarkVersion
import ch.brickinventoryapp.ui.theme.skeletonTone
import ch.brickinventoryapp.ui.theme.statusColorsFor
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Every design fills the roles that dialogs, menus, snackbar and text fields
 * read, with its own colors instead of Material3's purple base palette.
 *
 * Counter-check: `.let { supplementRoles(…) }` removed from colorScheme() — both
 * tests red (surfaceContainer* equal to the base palette, and in the dark `werkbank`
 * design the steps also reversed). tertiaryContainer removed from StudColors
 * — the first test red for `noppe` and `hochglanz`.
 *
 * Counter-check for borders (Oct 28, measured on a rebuild without the Android SDK: the same
 * formula in Python, surface steps mixed in Oklab like Compose): with the old
 * outline values red for classic (1.00:1 against surfaceContainerHighest), brick
 * (1.19), `werkbank` (1.03) and `farbfaecher` (1.01); `noppe` stayed green (13.8).
 */
class ColorRolesTest {

    private val light = Design.entries

    /** Every design and its dark version (DarkTokens.kt): name, scheme, status colors, dark? */
    private data class Version(val name: String, val schema: ColorScheme, val success: Int, val dark: Boolean)

    private val versions: List<Version> = light.map {
        Version(it.identifier, colorScheme(it), statusColorsFor(it).success.toArgb(), it == Design.WORKBENCH)
    } + light.filter { hasDarkVersion(it) }.map {
        Version("${it.identifier}/dunkel", colorScheme(it, dark = true), statusColorsFor(it, dark = true).success.toArgb(), true)
    }

    private val roles: List<Pair<String, (ColorScheme) -> Any>> = listOf(
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
     * Counter-check:
     * with the old #16A34A red for classic (3.30:1 on surface), `farbfaecher`
     * and `noppe`; with #15803D red for `noppe` (4.43:1 on background).
     */
    @Test
    fun `profit color is readable as text on every surface`() {
        val error = mutableListOf<String>()
        for (f in versions) {
            val d = f.name
            val s = f.schema
            val success = f.success
            for ((name, surface) in listOf("surface" to s.surface, "surfaceContainer" to s.surfaceContainer,
                                           "background" to s.background)) {
                val k = Contrast.ratio(success, surface.toArgb())
                if (k < 4.5) error += "$d.$name %.2f".format(k)
            }
        }
        assertTrue("profit color below 4.5:1: $error", error.isEmpty())
    }

    @Test
    fun `no design inherits roles from the base palette`() {
        val error = mutableListOf<String>()
        for (f in versions) {
            val d = f.name
            val s = f.schema
            val reason = if (f.dark) darkColorScheme() else lightColorScheme()
            for ((name, role) in roles) {
                if (role(s) == role(reason)) error += "$d.$name"
            }
        }
        assertTrue("inherited from the Material base palette: $error", error.isEmpty())
    }

    @Test
    fun `outline stands out with at least 3 to 1 from every surface`() {
        val error = mutableListOf<String>()
        for (f in versions) {
            val d = f.name
            val s = f.schema
            val frame = s.outline.toArgb()
            val surfaces = mapOf("surface" to s.surface, "background" to s.background,
                "surfaceVariant" to s.surfaceVariant, "surfaceContainerHigh" to s.surfaceContainerHigh,
                "surfaceContainerHighest" to s.surfaceContainerHighest)
            for ((name, surface) in surfaces) {
                val k = Contrast.ratio(frame, surface.toArgb())
                if (k < Contrast.FRAME) error += "$d.outline/$name " + "%.2f".format(k)
            }
            // Dividers take outlineVariant; it must stay the quieter tone.
            val quiet = Contrast.ratio(s.outlineVariant.toArgb(), s.surface.toArgb())
            if (quiet >= Contrast.ratio(frame, s.surface.toArgb())) error += "$d.outlineVariant"
        }
        assertTrue("frames too weak: $error", error.isEmpty())
    }

    /**
     * The loading skeleton (Skeleton.kt) draws skeletonTone on background.
     * Counter-check: skeletonTone returning surfaceVariant →
     * red „Ladekacheln heben sich …“ (classic 1.05, brick 1.03, `farbfaecher` 1.05, `noppe` 1.07).
     */
    @Test
    fun `loading tiles stand out from the background`() {
        val error = mutableListOf<String>()
        for (f in versions) {
            val k = Contrast.ratio(skeletonTone(f.schema).toArgb(), f.schema.background.toArgb())
            if (k < SKELETON_CONTRAST) error += "${f.name} %.2f".format(k)
        }
        assertTrue("loading tiles too pale: $error", error.isEmpty())
    }

    private companion object {
        /** No text threshold, but visible: well above the measured 1.05:1. */
        const val SKELETON_CONTRAST = 1.2
    }

    @Test
    fun `surface levels move away from surface step by step`() {
        for (f in versions) {
            val d = f.name
            val s = f.schema
            val levels = listOf(s.surface, s.surfaceContainerLow, s.surfaceContainer,
                s.surfaceContainerHigh, s.surfaceContainerHighest).map { it.luminance() }
            // In the light every step gets darker, in the dark lighter.
            val correct = if (f.dark) levels.zipWithNext().all { (a, b) -> b > a }
                          else levels.zipWithNext().all { (a, b) -> b < a }
            assertTrue("$d: brightness of the levels $levels", correct)
        }
    }

    /**
     * Werkbank is its own design, not "classic dark" under another name: warm
     * graphite and brass against cool anthracite and blue, as in `themes/werkbank.css`.
     * Counter-check workbench-as-classic-dark: `werkbank` given the cool surfaces again
     * with light blue as the secondary color → red.
     */
    @Test
    fun `Workbench and Classic dark differ in surface and accent`() {
        val workbench = colorScheme(Design.WORKBENCH)
        val classic = colorScheme(Design.CLASSIC, dark = true)
        assertTrue("workbench surface not warm: ${workbench.surface}", workbench.surface.red > workbench.surface.blue)
        assertTrue("classic dark not cool: ${classic.surface}", classic.surface.blue > classic.surface.red)
        assertTrue("workbench secondary color not warm: ${workbench.secondary}", workbench.secondary.red > workbench.secondary.blue)
    }
}
