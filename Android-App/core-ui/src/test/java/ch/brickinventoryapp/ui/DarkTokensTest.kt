package ch.brickinventoryapp.ui

import androidx.compose.ui.graphics.toArgb
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.ui.theme.DarkTokens
import ch.brickinventoryapp.ui.theme.SlateBlueStud
import ch.brickinventoryapp.ui.theme.argb
import ch.brickinventoryapp.ui.theme.darkBrickDecor
import ch.brickinventoryapp.ui.theme.darkRoles
import ch.brickinventoryapp.ui.theme.darkToken
import ch.brickinventoryapp.ui.theme.hasDarkVersion
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.awt.Color
import java.io.File

/**
 * The dark version for each design comes from the same tokens as the web
 * (shared/design-tokens.json, `dark` section), and its roles are readable.
 *
 * That DarkTokens.kt reflects the source is checked by the generator itself
 * (`generate-design-tokens.js --verify` in the Android run, job vertrag).
 *
 * Counter-checks:
 *   B  the `farbfaecher` entry renamed → red „jedes Design der Quelle hat seine dunkle Fassung“
 *   C  `erbt` not resolved in darkToken() → red „`hochglanz` erbt die Farben von `noppe`“ and the three role checks (b600 missing, classic kicks in)
 *   D  outline at s400 instead of s500 → red „borders stand out with 3 to 1“
 *   E  onPrimary at "txt" instead of "auf-primaer" → red „Text auf Flächen ist lesbar“
 * Counter-checks:
 *   F  darkBrickDecor() with the light studs (#6d94b8) → red „die Stein-Dekoration wird im Dunkeln dunkel“
 *   G  the text on the slate tile left white → red there too
 */
class DarkTokensTest {

    private val source = JSONObject(File("../../shared/design-tokens.json").readText()).getJSONObject("dunkel")

    @Test
    fun `every design of the source has its dark version`() {
        val names = source.getJSONObject("designs").keys().asSequence().toSet()
        assertEquals(names, DarkTokens.designs.keys)
        for (n in names) assertTrue(n, hasDarkVersion(checkNotNull(Design.from(n)) { "$n is not a design of the app" }))
        assertFalse("workbench is already dark", hasDarkVersion(Design.WORKBENCH))
    }

    @Test
    fun `hochglanz inherits the colors of noppe`() {
        for (t in listOf("b600", "b700", "chart-new", "ink")) {
            assertEquals(t, darkToken(Design.STUD, t), darkToken(Design.GLOSSY, t))
        }
        assertEquals("surfaces come from the base", DarkTokens.basis["bg"], darkToken(Design.BRICK, "bg"))
    }

    private fun k(a: Long, b: Long) = Contrast.ratio(a.toInt(), b.toInt())

    @Test
    fun `text on surfaces is readable`() {
        val error = mutableListOf<String>()
        for (d in DarkTokens.designs.keys) {
            val r = darkRoles(checkNotNull(Design.from(d)))
            val pairs = mapOf(
                "onSurface/surface" to (r.onSurface to r.surface),
                "onSurfaceVariant/surface" to (r.onSurfaceVariant to r.surface),
                "onPrimary/primary" to (r.onPrimary to r.primary),
                "onPrimaryContainer/primaryContainer" to (r.onPrimaryContainer to r.primaryContainer),
                "onSecondaryContainer/secondaryContainer" to (r.onSecondaryContainer to r.secondaryContainer),
                "erfolg/surface" to (r.success to r.surface),
                "error/surface" to (r.error to r.surface),
            )
            for ((name, p) in pairs) if (k(p.first, p.second) < 4.5) error += "$d.$name %.2f".format(k(p.first, p.second))
        }
        assertTrue("below 4.5:1: $error", error.isEmpty())
    }

    @Test
    fun `borders stand out with 3 to 1`() {
        val error = mutableListOf<String>()
        for (d in DarkTokens.designs.keys) {
            val r = darkRoles(checkNotNull(Design.from(d)))
            // surfaceContainerHighest sits ten percent toward onSurface; s300 is lighter.
            for ((name, surface) in mapOf("surface" to r.surface, "background" to r.background,
                    "surfaceVariant" to r.surfaceVariant, "s300" to argb(DarkTokens.basis.getValue("s300")))) {
                if (k(r.outline, surface) < Contrast.FRAME) error += "$d.outline/$name"
            }
            if (k(r.outlineVariant, r.surface) >= k(r.outline, r.surface)) error += "$d.outlineVariant"
        }
        assertTrue("frames too weak: $error", error.isEmpty())
    }

    @Test
    fun `the surfaces are dark and the text light`() {
        for (d in DarkTokens.designs.keys) {
            val r = darkRoles(checkNotNull(Design.from(d)))
            assertTrue(d, Contrast.luminance(r.background.toInt()) < 0.05)
            assertTrue(d, Contrast.luminance(r.onSurface.toInt()) > 0.7)
        }
    }

    /**
     * Like [data-dunkel] in the web: studs and slate tile from the dark version.
     * Hardcoded, the light tones of "brick" stayed on even in the dark.
     */
    @Test
    fun `the stone decoration becomes dark in the dark`() {
        val d = darkBrickDecor()
        assertEquals(argb(darkToken(Design.BRICK, "b400")!!), d.studs)
        assertTrue("the studs are darker in the dark than in light (SlateBlueStud, --b400 of brick)",
            Contrast.luminance(d.studs.toInt()) < Contrast.luminance(SlateBlueStud.toArgb()))
        val card = darkRoles(Design.BRICK).surface
        assertTrue("the studs stand out from the card", k(d.studs, card) >= Contrast.FRAME)
        assertTrue("text on the slate tile readable", k(d.onSlate, d.slate) >= 4.5)
    }

    /**
     * One accent per design: selected chips and the tonal button (secondaryContainer)
     * sit in the dark in the hue of the main color or neutral — classic and brick
     * showed amber next to light blue ("Weiter" brown/gold under the blue QR button).
     * Counter-check: classic put back on a100/a-schrift → red.
     */
    @Test
    fun `in the dark every design carries an accent`() {
        fun hsb(argb: Long): FloatArray {
            val c = argb.toInt()
            return Color.RGBtoHSB((c shr 16) and 0xFF, (c shr 8) and 0xFF, c and 0xFF, null)
        }
        for (design in DarkTokens.designs.keys) {
            val r = darkRoles(checkNotNull(Design.from(design)))
            val second = hsb(r.secondaryContainer)
            val spacing = kotlin.math.abs(second[0] * 360f - hsb(r.primary)[0] * 360f).let { minOf(it, 360f - it) }
            assertTrue("$design dark: secondary surface %.0f° next to the main color".format(spacing),
                second[1] < 0.35f || spacing < 30f)
            assertTrue("$design readable", k(r.onSecondaryContainer, r.secondaryContainer) >= 4.5)
        }
    }
}
