package ch.brickinventoryapp.ui

import androidx.compose.material3.ColorScheme
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.ui.theme.ChartColors
import ch.brickinventoryapp.ui.theme.StatusColors
import ch.brickinventoryapp.ui.theme.accentSurfaces
import ch.brickinventoryapp.ui.theme.chartColors
import ch.brickinventoryapp.ui.theme.colorScheme
import ch.brickinventoryapp.ui.theme.hasDarkVersion
import ch.brickinventoryapp.ui.theme.statusColorsFor
import ch.brickinventoryapp.ui.theme.tabColors
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Every text role reaches 4.5:1 (WCAG 1.4.3) on every surface Material draws
 * it on — in all six designs, light and in the dark version.
 * On top of that, error and main color are distinguishable, so red doesn't speak twice.
 *
 * Counter-checks:
 *   A  old colors: both first tests red, 33 pairs under 4.5:1, among them
 *      brick.onSurfaceVariant/background 3.91, classic …/surfaceContainerHighest 3.85,
 *      `noppe`.primary/background 4.44, onError/error in all dark versions 4.48;
 *      the third red with `noppe` 0.03 and `noppe/dunkel` 0.13.
 *   B  brick.onSurfaceVariant back to #6B7785 → red (3.91 on background)
 *   C  `noppe`.primary back to StudRed → red: „Hauptfarbe zu nah …“ (0.13)
 *
 * Chart colors:
 *   D  the muted color hardcoded back to #94A3B8 in chartColors() → red „Diagrammschrift …“
 *      with classic 2.56 on surface and 2.07 on surfaceContainerHighest
 *
 * Accent surfaces:
 *   E  the brick surfaces also in the dark in accentSurfaces() (as before M5: bars in
 *      primary/secondary, market value petrol) → red „im Dunkeln leuchtet …“ with
 *      `brick/dunkel.leiste` 0.45, `.detailBar` 0.63, `.markt` 0.17
 *
 * Counter-checks for the color roles (`thema.py` against Compose Desktop; patches under counter-checks/):
 *   container-ohne-stauchung   → red classic.primary/surfaceContainerHighest 4.18
 *   primarycontainer-blau50    → red classic.primary/primaryContainer 4.24
 *   inverseprimary-ungeprueft  → red `farbfaecher`.inversePrimary/inverseSurface 3.73
 *   gebraucht-linie-blass      → red `noppe.gebraucht`/surface 2.61
 *   reiteranzeige-blass        → red `classic.anzeige/leiste` 1.02
 *   warnfarbe-hell             → red `classic.warnung`/surface 1.95
 */
class TextContrastTest {

    private val designs = Design.entries

    private data class Version(val name: String, val s: ColorScheme, val status: StatusColors, val chart: ChartColors)

    private val versions: List<Version> = designs.map {
        Version(it.identifier, colorScheme(it), statusColorsFor(it), chartColors(it, false, colorScheme(it)))
    } + designs.filter { hasDarkVersion(it) }.map {
        val s = colorScheme(it, dark = true)
        Version("${it.identifier}/dunkel", s, statusColorsFor(it, dark = true), chartColors(it, true, s))
    }

    /**
     * Axes and hints in the chart are text: 4.5:1 on every surface a card can sit
     * on. The lines are graphics and need 3:1 (WCAG 1.4.11),
     * the used line included.
     */
    @Test
    fun `chart text and lines are readable`() {
        val error = versions.flatMap { f ->
            val s = f.s; val d = f.chart
            val surfaces = listOf("surface" to s.surface, "background" to s.background,
                "surfaceContainerHighest" to s.surfaceContainerHighest)
            surfaces.mapNotNull { (n, fl) -> k(d.muted, fl).takeIf { it < 4.5 }?.let { "${f.name}.gedaempft/$n %.2f".format(it) } } +
                listOf("linie" to d.line, "neu" to d.new, "gebraucht" to d.used).mapNotNull { (n, c) ->
                    k(c, s.surface).takeIf { it < Contrast.FRAME }?.let { "${f.name}.$n/surface %.2f".format(it) } }
        }
        assertTrue("chart text or line too weak: $error", error.isEmpty())
    }

    /** Text on surface, the way Material3 pairs the roles; plus text in main, error and profit color. */
    private fun textPairs(f: Version): Map<String, Pair<Color, Color>> {
        val s = f.s
        val surfaces = mapOf("surface" to s.surface, "background" to s.background,
            "surfaceVariant" to s.surfaceVariant, "surfaceContainerLow" to s.surfaceContainerLow,
            "surfaceContainer" to s.surfaceContainer, "surfaceContainerHigh" to s.surfaceContainerHigh,
            "surfaceContainerHighest" to s.surfaceContainerHighest)
        val pairs = mutableMapOf<String, Pair<Color, Color>>()
        for ((n, fl) in surfaces) {
            pairs["onSurface/$n"] = s.onSurface to fl
            pairs["onSurfaceVariant/$n"] = s.onSurfaceVariant to fl
        }
        // Dialogs, menus and sheets sit on the container steps; their text buttons are primary.
        for ((n, fl) in surfaces) {
            pairs["primary/$n"] = s.primary to fl
            pairs["error/$n"] = s.error to fl
        }
        for (n in listOf("surface", "background", "surfaceContainer")) {
            pairs["erfolg/$n"] = f.status.success to surfaces.getValue(n)
            pairs["fehler/$n"] = f.status.error to surfaces.getValue(n)
        }
        pairs["primary/primaryContainer"] = s.primary to s.primaryContainer
        pairs["inversePrimary/inverseSurface"] = s.inversePrimary to s.inverseSurface
        pairs["onPrimary/primary"] = s.onPrimary to s.primary
        pairs["onPrimaryContainer/primaryContainer"] = s.onPrimaryContainer to s.primaryContainer
        pairs["onSecondary/secondary"] = s.onSecondary to s.secondary
        pairs["onSecondaryContainer/secondaryContainer"] = s.onSecondaryContainer to s.secondaryContainer
        pairs["onTertiary/tertiary"] = s.onTertiary to s.tertiary
        pairs["onTertiaryContainer/tertiaryContainer"] = s.onTertiaryContainer to s.tertiaryContainer
        pairs["onError/error"] = s.onError to s.error
        pairs["onErrorContainer/errorContainer"] = s.onErrorContainer to s.errorContainer
        pairs["inverseOnSurface/inverseSurface"] = s.inverseOnSurface to s.inverseSurface
        return pairs
    }

    private fun k(a: Color, b: Color) = Contrast.ratio(a.toArgb(), b.toArgb())

    private fun accent(f: Version) = accentSurfaces(checkNotNull(Design.from(f.name.substringBefore('/'))), f.name.endsWith("/dunkel"), f.s)

    /** App bars and value tiles: text on their surface like any other role. */
    @Test
    fun `bars and value tiles carry readable text`() {
        val error = versions.flatMap { f ->
            val a = accent(f)
            listOf("leiste" to (a.onBar to a.bar), "detailBar" to (a.onDetailBar to a.detailBar),
                "markt" to (a.onMarket to a.market), "kauf" to (a.onPurchase to a.purchase))
                .mapNotNull { (n, p) -> k(p.first, p.second).takeIf { it < 4.5 }?.let { "${f.name}.$n %.2f".format(it) } }
        }
        assertTrue("below 4.5:1: $error", error.isEmpty())
    }

    /**
     * No light surfaces in the dark (Material 3: container roles): a bar or
     * tile lighter than the text on it glows on black and pulls the eye
     * away from the content. Measured as relative luminance; onSurface sits around 0.8.
     */
    @Test
    fun `in the dark no bar and no tile glows`() {
        val error = versions.filter { it.name.endsWith("/dunkel") || it.name == "werkbank" }.flatMap { f ->
            val a = accent(f)
            listOf("leiste" to a.bar, "detailBar" to a.detailBar, "markt" to a.market, "kauf" to a.purchase)
                .mapNotNull { (n, c) -> Contrast.luminance(c.toArgb()).takeIf { it > 0.1 }?.let { "${f.name}.$n %.2f".format(it) } }
        }
        assertTrue("light surface in the dark: $error", error.isEmpty())
    }

    /** The market value is the detail page's most important value; its tile stands out more than the purchase price. */
    @Test
    fun `the market value tile is more prominent than the purchase price tile`() {
        val error = versions.mapNotNull { f ->
            val a = accent(f)
            val market = k(a.market, f.s.surface); val purchase = k(a.purchase, f.s.surface)
            if (market < purchase * 1.2) "${f.name} %.2f gegen %.2f".format(market, purchase) else null
        }
        assertTrue("purchase price tile stronger than the market value: $error", error.isEmpty())
    }

    @Test
    fun `every text role reaches 4,5 to 1 on its surface`() {
        val error = versions.flatMap { f ->
            textPairs(f).mapNotNull { (n, p) -> k(p.first, p.second).takeIf { it < 4.5 }?.let { "${f.name}.$n %.2f".format(it) } }
        }
        assertTrue("below 4.5:1: $error", error.isEmpty())
    }

    /** The navigation's selected destination is recognizable by its indicator's surface, not only by its hue. */
    @Test
    fun `the indicator of the selected tab stands out from bar and side bar`() {
        val error = versions.flatMap { f ->
            val r = tabColors(f.s)
            listOf("leiste" to r.bar, "seitenleiste" to f.s.surface).mapNotNull { (n, fl) ->
                k(r.display, fl).takeIf { it < Contrast.FRAME }?.let { "${f.name}.anzeige/$n %.2f".format(it) }
            } + listOf("onDisplay" to (r.onDisplay to r.display), "gewaehlt" to (r.chosen to r.bar),
                "ungewaehlt" to (r.unselected to r.bar)).mapNotNull { (n, p) ->
                k(p.first, p.second).takeIf { it < 4.5 }?.let { "${f.name}.$n %.2f".format(it) }
            }
        }
        assertTrue("selected tab hardly recognizable: $error", error.isEmpty())
    }

    /** Warning color draws bars and icons (monitoring, CSV report): graphics need 3:1. */
    @Test
    fun `warning color is visible as a graphic on every surface`() {
        val error = versions.flatMap { f ->
            listOf("surface" to f.s.surface, "background" to f.s.background, "surfaceContainer" to f.s.surfaceContainer)
                .mapNotNull { (n, fl) -> k(f.status.warning, fl).takeIf { it < Contrast.FRAME }?.let { "${f.name}.warnung/$n %.2f".format(it) } }
        }
        assertTrue("below 3:1: $error", error.isEmpty())
    }

    @Test
    fun `borders of controls reach 3 to 1`() {
        val error = versions.flatMap { f ->
            val s = f.s
            listOf("surface" to s.surface, "background" to s.background, "surfaceVariant" to s.surfaceVariant,
                "surfaceContainerHighest" to s.surfaceContainerHighest, "primaryContainer" to s.primaryContainer)
                .mapNotNull { (n, fl) -> k(s.outline, fl).takeIf { it < Contrast.FRAME }?.let { "${f.name}.outline/$n %.2f".format(it) } }
        }
        assertTrue("below 3:1: $error", error.isEmpty())
    }

    /**
     * Delete and error must not look like the main color. The measure is the
     * distance in RGB space (0 to 1.73): blue against red is above 0.8, the
     * `noppe` red #D91F26 next to #B91C1C at 0.13.
     */
    @Test
    fun `error color deviates clearly from the primary color`() {
        val error = versions.mapNotNull { f ->
            val a = f.s.primary; val b = f.s.error
            val d = kotlin.math.sqrt(((a.red - b.red) * (a.red - b.red) + (a.green - b.green) * (a.green - b.green) +
                (a.blue - b.blue) * (a.blue - b.blue)).toDouble())
            if (d < 0.15) "${f.name} %.2f".format(d) else null
        }
        assertTrue("main color too close to the error color: $error", error.isEmpty())
    }
}
