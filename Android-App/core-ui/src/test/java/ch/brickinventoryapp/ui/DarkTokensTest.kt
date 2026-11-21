package ch.brickinventoryapp.ui

import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.ui.theme.DunkelTokens
import ch.brickinventoryapp.ui.theme.SlateBlueNoppe
import ch.brickinventoryapp.ui.theme.argb
import ch.brickinventoryapp.ui.theme.darkToken
import ch.brickinventoryapp.ui.theme.darkRoles
import ch.brickinventoryapp.ui.theme.darkBrickDecor
import ch.brickinventoryapp.ui.theme.hatDarkVersion
import androidx.compose.ui.graphics.toArgb
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.awt.Color

/**
 * Die dunkle Fassung je Design kommt aus denselben Tokens wie im Web
 * (shared/design-tokens.json, Abschnitt `dunkel`), und ihre Rollen sind lesbar.
 *
 * Dass DunkelTokens.kt die Quelle wiedergibt, prüft der Generator selbst
 * (`generate-design-tokens.js --pruefen` im Android-Lauf, Job vertrag).
 *
 * Gegenproben:
 *   B  den Eintrag "farbfaecher" umbenannt → rot „jedes Design der Quelle hat
 *      seine dunkle Fassung“
 *   C  in darkToken() `erbt` nicht aufgelöst → rot „hochglanz erbt die Farben
 *      von noppe“ und die drei Prüfungen der Rollen (b600 fehlt, es greift classic)
 *   D  outline auf s400 statt s500 → rot „borders stand out with 3 to 1“
 *   E  onPrimary auf "txt" statt "auf-primaer" → rot „Text auf Flächen ist lesbar“
 * Gegenproben:
 *   F  darkBrickDecor() mit den hellen Noppen (#6d94b8) → rot „die
 *      Stein-Dekoration wird im Dunkeln dunkel“
 *   G  die Schrift auf der Schieferkachel weiss gelassen → rot ebenda
 */
class DarkTokensTest {

    private val quelle = JSONObject(File("../../shared/design-tokens.json").readText()).getJSONObject("dunkel")

    @Test
    fun `every design of the source has its dark version`() {
        val namen = quelle.getJSONObject("designs").keys().asSequence().toSet()
        assertEquals(namen, DunkelTokens.designs.keys)
        for (n in namen) assertTrue(n, hatDarkVersion(checkNotNull(Design.aus(n)) { "$n ist kein Design der App" }))
        assertFalse("Werkbank ist schon dunkel", hatDarkVersion(Design.WERKBANK))
    }

    @Test
    fun `hochglanz inherits the colors of noppe`() {
        for (t in listOf("b600", "b700", "chart-new", "ink")) {
            assertEquals(t, darkToken(Design.NOPPE, t), darkToken(Design.HOCHGLANZ, t))
        }
        assertEquals("Flächen kommen aus der Basis", DunkelTokens.basis["bg"], darkToken(Design.BRICK, "bg"))
    }

    private fun k(a: Long, b: Long) = Contrast.verhaeltnis(a.toInt(), b.toInt())

    @Test
    fun `text on surfaces is readable`() {
        val fehler = mutableListOf<String>()
        for (d in DunkelTokens.designs.keys) {
            val r = darkRoles(checkNotNull(Design.aus(d)))
            val pairs = mapOf(
                "onSurface/surface" to (r.onSurface to r.surface),
                "onSurfaceVariant/surface" to (r.onSurfaceVariant to r.surface),
                "onPrimary/primary" to (r.onPrimary to r.primary),
                "onPrimaryContainer/primaryContainer" to (r.onPrimaryContainer to r.primaryContainer),
                "onSecondaryContainer/secondaryContainer" to (r.onSecondaryContainer to r.secondaryContainer),
                "erfolg/surface" to (r.erfolg to r.surface),
                "error/surface" to (r.error to r.surface),
            )
            for ((name, p) in pairs) if (k(p.first, p.second) < 4.5) fehler += "$d.$name %.2f".format(k(p.first, p.second))
        }
        assertTrue("Unter 4,5:1: $fehler", fehler.isEmpty())
    }

    @Test
    fun `borders stand out with 3 to 1`() {
        val fehler = mutableListOf<String>()
        for (d in DunkelTokens.designs.keys) {
            val r = darkRoles(checkNotNull(Design.aus(d)))
            // surfaceContainerHighest liegt zehn Prozent Richtung onSurface; s300 ist heller.
            for ((name, flaeche) in mapOf("surface" to r.surface, "background" to r.background,
                    "surfaceVariant" to r.surfaceVariant, "s300" to argb(DunkelTokens.basis.getValue("s300")))) {
                if (k(r.outline, flaeche) < Contrast.FRAME) fehler += "$d.outline/$name"
            }
            if (k(r.outlineVariant, r.surface) >= k(r.outline, r.surface)) fehler += "$d.outlineVariant"
        }
        assertTrue("Zu schwache Rahmen: $fehler", fehler.isEmpty())
    }

    @Test
    fun `the surfaces are dark and the text light`() {
        for (d in DunkelTokens.designs.keys) {
            val r = darkRoles(checkNotNull(Design.aus(d)))
            assertTrue(d, Contrast.luminance(r.background.toInt()) < 0.05)
            assertTrue(d, Contrast.luminance(r.onSurface.toInt()) > 0.7)
        }
    }

    /**
     * Wie [data-dunkel] im Web: Noppen und Schieferkachel aus der dunklen Fassung.
     * Fest eingesetzt blieben die hellen Töne von „brick“ auch im Dunkeln stehen.
     */
    @Test
    fun `the stone decoration becomes dark in the dark`() {
        val d = darkBrickDecor()
        assertEquals(argb(darkToken(Design.BRICK, "b400")!!), d.studs)
        assertTrue("Die Noppen sind im Dunkeln dunkler als hell (SlateBlueNoppe, --b400 von brick)",
            Contrast.luminance(d.studs.toInt()) < Contrast.luminance(SlateBlueNoppe.toArgb()))
        val karte = darkRoles(Design.BRICK).surface
        assertTrue("Die Noppen heben sich von der Karte ab", k(d.studs, karte) >= Contrast.FRAME)
        assertTrue("Schrift auf der Schieferkachel lesbar", k(d.onSlate, d.slate) >= 4.5)
    }

    /**
     * Ein Akzent je Design: Gewählte Chips und der Tonal-Knopf (secondaryContainer)
     * stehen im Dunkeln im Farbton der Hauptfarbe oder neutral — classic und brick
     * zeigten Bernstein neben Hellblau („Weiter“ braun/gold unter dem blauen QR-Knopf).
     * Gegenprobe: classic wieder auf a100/a-schrift → rot.
     */
    @Test
    fun `in the dark every design carries an accent`() {
        fun hsb(argb: Long): FloatArray {
            val c = argb.toInt()
            return Color.RGBtoHSB((c shr 16) and 0xFF, (c shr 8) and 0xFF, c and 0xFF, null)
        }
        for (design in DunkelTokens.designs.keys) {
            val r = darkRoles(checkNotNull(Design.aus(design)))
            val zweit = hsb(r.secondaryContainer)
            val abstand = kotlin.math.abs(zweit[0] * 360f - hsb(r.primary)[0] * 360f).let { minOf(it, 360f - it) }
            assertTrue("$design dunkel: Zweitfläche %.0f° neben der Hauptfarbe".format(abstand),
                zweit[1] < 0.35f || abstand < 30f)
            assertTrue("$design lesbar", k(r.onSecondaryContainer, r.secondaryContainer) >= 4.5)
        }
    }
}
