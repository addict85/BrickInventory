package ch.brickinventoryapp.ui

import androidx.compose.ui.graphics.Color
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.ui.theme.accentSurfaces
import ch.brickinventoryapp.ui.theme.colorScheme
import ch.brickinventoryapp.ui.theme.hasDarkVersion
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Red means loss or error. The surfaces that carry a value or a state —
 * main color, its container ("New" badge, market value card in the dark),
 * secondaryContainer (selected chips, hints) and the market value tile — are
 * never red in any design or version.
 *
 * Counter-checks (patches under counter-checks/, measured only in CI):
 *   noppe-container-rot        `noppe`'s primaryContainer back to StudRedLight
 *                              → red „value and state surfaces are never red“ (`noppe`.primaryContainer)
 *   noppe-dunkel-container-rot `noppe` in the dark without its own primaryContainer (back to #2a1415)
 *                              → red „value and state surfaces are never red“ (`noppe/dunkel`.primaryContainer)
 */
class RedOnlyForWarningTest {

    private val designs = listOf(Design.CLASSIC, Design.BRICK, Design.WORKBENCH, Design.COLOR_FAN, Design.STUD, Design.GLOSSY)

    /** Hue in degrees and chroma (max − min of channels); gray has no hue. */
    private fun toneAndChroma(c: Color): Pair<Float, Float> {
        val r = c.red; val g = c.green; val b = c.blue
        val max = maxOf(r, g, b); val min = minOf(r, g, b); val d = max - min
        if (d == 0f) return 0f to 0f
        val tone = when (max) {
            r -> 60f * (((g - b) / d) % 6f)
            g -> 60f * ((b - r) / d + 2f)
            else -> 60f * ((r - g) / d + 4f)
        }
        return (if (tone < 0f) tone + 360f else tone) to d
    }

    /** Red: hue between 340° and 20° and visibly chromatic (not a warm gray). */
    private fun red(c: Color): Boolean {
        val (tone, chroma) = toneAndChroma(c)
        return chroma >= MIN_CHROMA && (tone >= 340f || tone <= 20f)
    }

    @Test
    fun `value and state surfaces are never red`() {
        val versions = designs.map { it to false } + designs.filter { hasDarkVersion(it) }.map { it to true }
        val error = versions.flatMap { (design, dark) ->
            val s = colorScheme(design, dark)
            val name = if (dark) "${design.identifier}/dunkel" else design.identifier
            listOf("primary" to s.primary, "primaryContainer" to s.primaryContainer,
                "secondaryContainer" to s.secondaryContainer,
                "markt" to accentSurfaces(design, dark, s).market)
                .filter { (_, c) -> red(c) }.map { (role, _) -> "$name.$role" }
        }
        assertTrue("red on a value or state surface: $error", error.isEmpty())
    }

    /** The measurement itself: it detects error red, not blue, gray or sand. */
    @Test
    fun `the red measurement separates red from blue, gray and sand`() {
        assertTrue(red(Color(0xFFB91C1C)))
        assertTrue(red(Color(0xFFFDECEC)))
        assertTrue(!red(Color(0xFF2563EB)) && !red(Color(0xFFF4F4F4)) && !red(Color(0xFFE9DED0)))
    }

    private companion object {
        /** From here a hue is visible; below that lie the warm grays of the surfaces. */
        const val MIN_CHROMA = 0.05f
    }
}
