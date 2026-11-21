package ch.brickinventoryapp.ui.theme

import ch.brickinventoryapp.model.ui.theme.Design
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import ch.brickinventoryapp.resources.R

// Lets composables recognize whether the "Stein (Blau)" theme is active,
// so structural brick elements (stud lid, sage badges …) are only shown there.
val LocalIsBrickTheme = staticCompositionLocalOf { false }

// The same for the color fan: only there do the tiles carry a
// theme stripe. A dedicated flag instead of a comparison against the
// theme name across the screens — otherwise every spot would have to know the
// name.
val LocalIsColorSlotsTheme = staticCompositionLocalOf { false }

/**
 * Does the tile carry a stud lid in the "noppe" theme?
 *
 * Like [LocalIsColorSlotsTheme]: the tile itself should keep the same
 * markup in every theme, and only this Local decides whether the
 * lid is added.
 */
val LocalIsStudTheme = staticCompositionLocalOf { false }

/**
 * Does the surface carry the gloss of the "hochglanz" theme? Separate from
 * [LocalIsStudTheme]: "hochglanz" is "noppe" in a different material; the tile
 * asks both, a Local with three states would force a case distinction everywhere.
 */
val LocalIsGloss = staticCompositionLocalOf { false }

// BrandBlue, BrandBlueDark, BrandBlueLight and BrandBlue50 live in
// DesignTokens.kt — generated from shared/design-tokens.json, so they can't
// drift apart from the web app. Same file, same package, so
// usable here without an import.

// Keep BrandRed for accents / G&V
val BrandRed        = Color(0xFFE63329)
val BrandRedDark    = Color(0xFFB5231C)
val BrandYellow     = Color(0xFFF5A800)

private val LightColors = lightColorScheme(
    primary             = BrandBlue,
    onPrimary           = Color.White,
    // BrandBlue50 carried primary at only 4.24:1; the lighter tone holds 4.5:1.
    primaryContainer    = BrandBlueLight,
    onPrimaryContainer  = BrandBlueDark,
    secondary           = BrandBlueDark,
    onSecondary         = Color.White,
    secondaryContainer  = BrandBlueLight,
    onSecondaryContainer = BrandBlueDark,
    // BrandRed itself carries white text at only 4.3:1.
    tertiary            = BrandRedDark,
    onTertiary          = Color.White,
    tertiaryContainer   = Color(0xFFFFDAD6),
    onTertiaryContainer = BrandRedDark,
    // --s100 of the web app: Compose has three levels (background, surface,
    // surfaceVariant), the web has two. With --s50, background and surfaceVariant
    // would be equal, and labels and placeholders on top of it would disappear.
    background          = Color(0xFFF1F5F9),  // --s100
    surface             = Color.White,
    surfaceVariant      = Color(0xFFF8FAFC),
    onSurface           = Color(0xFF1E293B),
    // --s600 instead of --s500: secondary text also sits on the container levels.
    onSurfaceVariant    = Color(0xFF475569),
    // outline borders controls (text fields) and needs 3:1 against any
    // surface; the light tone is only good for dividers.
    outline             = Color(0xFF748399),
    outlineVariant      = Color(0xFFE2E8F0),
    error               = Color(0xFFB91C1C),
)

// ── Brick theme (blue) — muted slate blue, matching the web app ──────────────
// SlateBlue, SlateBlueDark, SlateBlueLight and Petrol live in
// DesignTokens.kt (generated, see above).
val PetrolLight      = Color(0xFFCFE3E8)
val BrickSand        = Color(0xFFE9DED0)  // "Gebraucht"-Akzent (Container)
val BrickSandText    = Color(0xFF5C4A2E)
val BrickSay        = Color(0xFFE1EBE2)  // "New" accent (container, sage green)
val BrickSayText    = Color(0xFF4A6B52)
val BrickStud        = Color(0xFF6E8CB0)  // Noppen-/Deckelfarbe (heller Schiefer)

private val BrickBlueColors = lightColorScheme(
    primary             = SlateBlue,
    onPrimary           = Color.White,
    primaryContainer    = SlateBlueLight,
    onPrimaryContainer  = SlateBlueDark,
    secondary           = Petrol,
    onSecondary         = Color.White,
    secondaryContainer  = BrickSand,
    onSecondaryContainer = BrickSandText,
    tertiary            = Petrol,
    onTertiary          = Color.White,
    tertiaryContainer   = PetrolLight,
    onTertiaryContainer = Color(0xFF204A54),
    background          = Color(0xFFE9EEF3),
    surface             = Color.White,
    surfaceVariant      = Color(0xFFEEF1F5),
    onSurface           = Color(0xFF26323F),
    onSurfaceVariant    = Color(0xFF56616E),
    outline             = Color(0xFF768391),
    outlineVariant      = Color(0xFFCDD7E2),
    // The same tone as the "error" status color; #C0564E carried white text at only 4.48:1.
    error               = Color(0xFFA34B3C),
)

// ── Diagrammfarben je Zustand ────────────────────────────────────────────────
/**
 * Colors of the history lines from the theme, like --chart-new/--chart-used on the
 * web. In the brick theme, sage green and sand, the same colors as the
 * condition badges, as a solid tone, because the containers would barely be visible on a white
 * background. The defaults of [linie] and [raster] are the classic values; [gedaempft] is
 * for text (axes, hints) and therefore comes from [diagrammFarben].
 */
data class ChartColors(
    val new: Color,
    val used: Color,
    val linie: Color = Color(0xFF2563EB),
    val raster: Color = Color(0xFFE2E8F0),
    val gedaempft: Color = Color(0xFF56616E),
)

// The four Chart*-colors live in DesignTokens.kt (generated, see above) —
// including the reasoning for why the used line is sand in the brick theme.

// Werkbank (dark): darkColorScheme, because some components (text-field borders,
// ripple) read their brightness from it. Values as in themes/werkbank.css: warm graphite
// and brass instead of anthracite with blue, otherwise it would match „Classic dark“ (DunkelTokens.kt).
private val WerkbankColors = darkColorScheme(
    primary              = WerkbankAzur,
    onPrimary            = Color(0xFF1E1608),
    primaryContainer     = WerkbankAzurDunkel,
    onPrimaryContainer   = WerkbankAzurHell,
    secondary            = Color(0xFFC9963F),
    onSecondary          = Color(0xFF1E1608),
    secondaryContainer   = Color(0xFF2A2418),
    onSecondaryContainer = Color(0xFFD9A84E),
    tertiary             = Color(0xFFD9A84E),
    onTertiary           = Color(0xFF241C0C),
    tertiaryContainer    = Color(0xFF2A2418),
    onTertiaryContainer  = Color(0xFFD9A84E),
    background           = Color(0xFF17140F),
    surface              = Color(0xFF211C16),
    // Must differ from surface — the same reasoning as in the
    // base theme: surfaces that sit WITH surfaceVariant ON surface
    // would otherwise disappear.
    surfaceVariant       = Color(0xFF2C261E),
    onSurface            = Color(0xFFECE4D8),
    onSurfaceVariant     = Color(0xFFA89C8B),
    outline              = Color(0xFFA89C8B),
    outlineVariant       = Color(0xFF3A3127),
    error                = Color(0xFFE07A72),
)

// ── Color fan ─────────────────────────────────────────────────────────────
//
// Gray control: the brand color here is near-black, so the
// theme colors (FaecherFarben in DesignTokens.kt) are the only colorful
// surfaces and thus mean something.
private val ColorSlotsColors = lightColorScheme(
    primary              = FaecherTinte,
    onPrimary            = Color.White,
    primaryContainer     = FaecherTinteHell,
    onPrimaryContainer   = FaecherTinteDunkel,
    secondary            = Color(0xFF5A5A5A),
    onSecondary          = Color.White,
    secondaryContainer   = Color(0xFFE8E8E8),
    onSecondaryContainer = Color(0xFF2B2B2B),
    tertiary             = Color(0xFF5A5A5A),
    onTertiary           = Color.White,
    tertiaryContainer    = Color(0xFFE8E8E8),
    onTertiaryContainer  = Color(0xFF2B2B2B),
    background           = Color(0xFFFAFAFA),
    surface              = Color.White,
    surfaceVariant       = Color(0xFFF4F4F4),
    onSurface            = Color(0xFF2B2B2B),
    onSurfaceVariant     = Color(0xFF5E5E5E),
    outline              = Color(0xFF7F7F7F),
    outlineVariant       = Color(0xFFE6E6E6),
    error                = Color(0xFFB91C1C),
)

// Noppe: white surfaces, ink edge; values from DesignTokens.kt.
// `outline` is the INK, because in this theme the border carries it, not the shadow.
// Red appears in no role, only on the stud lids: in the value card, the „New“ badge
// and buttons it read as loss or error. Blue leads, yellow is the accent.
private val StudBlue = Color(0xFF1A5FB8)
private val StudBlueLight = Color(0xFFE3EDFA)
private val StudYellowLight = Color(0xFFFFF3C4)
private val StudOcker = Color(0xFF7A5200)

private val StudColors = lightColorScheme(
    primary              = StudBlue,
    onPrimary            = Color.White,
    primaryContainer     = StudBlueLight,
    onPrimaryContainer   = NoppeTinte,
    secondary            = NoppeTinte,
    onSecondary          = Color.White,
    secondaryContainer   = Color(0xFFEEF1F6),
    onSecondaryContainer = NoppeTinte,
    tertiary             = StudOcker,
    onTertiary           = Color.White,
    tertiaryContainer    = StudYellowLight,
    onTertiaryContainer  = NoppeTinte,
    background           = Color(0xFFEEF1F6),
    surface              = Color.White,
    surfaceVariant       = Color(0xFFF7F9FC),
    onSurface            = NoppeTinte,
    onSurfaceVariant     = Color(0xFF5A6270),
    outline              = NoppeTinte,
    // The same value that supplementRoles() previously blended from surface and onSurface.
    outlineVariant       = Color(0xFFD7D8DA),
    error                = Color(0xFFB91C1C),
)

/**
 * Nunito, the font of the "noppe" theme: the system font stays
 * angular even at 900. Three static cuts instead of the variable one, which would need
 * FontVariation and thus a higher API level; the same shapes as public/vendor/fonts/ on the web.
 */
private val NunitoFamily = FontFamily(
    Font(R.font.nunito_regular, FontWeight.Normal),
    Font(R.font.nunito_bold, FontWeight.Bold),
    Font(R.font.nunito_black, FontWeight.Black),
)

/**
 * Plus Jakarta Sans — the web app's font (styles.css --font) for all
 * themes except "noppe". Static cuts from the web app's variable
 * cut, for the same reason as with Nunito above.
 */
private val JakartaFamily = FontFamily(
    Font(R.font.plus_jakarta_sans_regular, FontWeight.Normal),
    Font(R.font.plus_jakarta_sans_medium, FontWeight.Medium),
    Font(R.font.plus_jakarta_sans_semibold, FontWeight.SemiBold),
    Font(R.font.plus_jakarta_sans_bold, FontWeight.Bold),
    Font(R.font.plus_jakarta_sans_extrabold, FontWeight.ExtraBold),
)

/**
 * The Material scale with a different family. Only the family is
 * swapped, no size and no weight — otherwise a theme change would shift the
 * whole UI, and AbstandsskalaTest would be right to report it.
 */
private fun withFamily(f: FontFamily): Typography = Typography().let { t ->
    Typography(
        displayLarge = t.displayLarge.copy(fontFamily = f),
        displayMedium = t.displayMedium.copy(fontFamily = f),
        displaySmall = t.displaySmall.copy(fontFamily = f),
        headlineLarge = t.headlineLarge.copy(fontFamily = f),
        headlineMedium = t.headlineMedium.copy(fontFamily = f),
        headlineSmall = t.headlineSmall.copy(fontFamily = f),
        titleLarge = t.titleLarge.copy(fontFamily = f),
        titleMedium = t.titleMedium.copy(fontFamily = f),
        titleSmall = t.titleSmall.copy(fontFamily = f),
        bodyLarge = t.bodyLarge.copy(fontFamily = f),
        bodyMedium = t.bodyMedium.copy(fontFamily = f),
        bodySmall = t.bodySmall.copy(fontFamily = f),
        labelLarge = t.labelLarge.copy(fontFamily = f),
        labelMedium = t.labelMedium.copy(fontFamily = f),
        labelSmall = t.labelSmall.copy(fontFamily = f),
    )
}

/** The typography of the "noppe" theme: the same scale, a different font. */
private val StudTypography: Typography = withFamily(NunitoFamily)
private val BrandsTypography: Typography = withFamily(JakartaFamily)

/**
 * The cap color of a tile in the "noppe" design.
 *
 * Position modulo six, exactly like `.sc:nth-child(6n+…)` in themes/noppe.css.
 * It means NOTHING and only gives rhythm — the explicit difference to
 * [slotsTone] below, where the color IS the theme.
 */
fun brickTone(position: Int): Color =
    SteinFarben[((position % SteinFarben.size) + SteinFarben.size) % SteinFarben.size]

/**
 * The tone of a LEGO theme in the "farbfaecher" design.
 *
 * Theme number modulo twelve, exactly like `--slots-tone` in the web app. Without
 * a number there is no tone — then the stripe stays off instead of showing a
 * wrong one (the same rule as applyTheme(): no information changes nothing).
 */
fun slotsTone(themeNumber: Int?): Color? =
    themeNumber?.let { FaecherFarben[((it % FaecherFarben.size) + FaecherFarben.size) % FaecherFarben.size] }

val LocalChartColors = staticCompositionLocalOf {
    ChartColors(new = ChartNewClassic, used = ChartUsedClassic)
}

/** Colors of the brick decoration (studs, slate tile) — light or dark, see darkBrickDecor(). */
data class BrickDecor(val studs: Color, val slate: Color, val onSlate: Color)

val LocalBrickDecor = staticCompositionLocalOf { BrickDecor(SlateBlueNoppe, SlateBlue, Color.White) }

/**
 * The dark version of a design from the tokens (DunkelTokens.kt). Same
 * mapping as WerkbankColors, only with the design's brand colors.
 */
private fun darkSchema(theme: Design): ColorScheme = darkRoles(theme).let { r ->
    darkColorScheme(
        primary = Color(r.primary), onPrimary = Color(r.onPrimary),
        primaryContainer = Color(r.primaryContainer), onPrimaryContainer = Color(r.onPrimaryContainer),
        secondary = Color(r.secondary), onSecondary = Color(r.onSecondary),
        secondaryContainer = Color(r.secondaryContainer), onSecondaryContainer = Color(r.onSecondaryContainer),
        tertiary = Color(r.tertiary), onTertiary = Color(r.onTertiary),
        tertiaryContainer = Color(r.tertiaryContainer), onTertiaryContainer = Color(r.onTertiaryContainer),
        background = Color(r.background), surface = Color(r.surface), surfaceVariant = Color(r.surfaceVariant),
        onSurface = Color(r.onSurface), onSurfaceVariant = Color(r.onSurfaceVariant),
        outline = Color(r.outline), outlineVariant = Color(r.outlineVariant),
        error = Color(r.error),
    )
}

/**
 * The complete color scheme of a design, light or in its dark version.
 * `when` instead of nested conditions: another design costs one line.
 */
internal fun farbschema(theme: Design, dunkel: Boolean = false): ColorScheme =
    if (dunkel && hatDarkVersion(theme)) supplementRoles(darkSchema(theme).let {
        // Like light: noppe red is barely distinguishable from the error color in the dark.
        // Main color becomes the blue of the chart line, the containers take the blue steps
        // from classic, and the accent stays the amber of the base.
        if (theme == Design.NOPPE || theme == Design.HOCHGLANZ) it.copy(primary = Color(0xFF6AA8FF),
            primaryContainer = Color(argb(darkToken(Design.CLASSIC, "b50") ?: "#13233d")),
            onPrimaryContainer = Color(argb(darkToken(Design.CLASSIC, "b700") ?: "#a9caff")))
        else it
    }, dunkel = true)
    else when (theme) {
        Design.BRICK -> BrickBlueColors
        Design.WERKBANK -> WerkbankColors
        Design.FARBFAECHER -> ColorSlotsColors
        // Glossy is noppe in a different material, not in different colors (`inherits`).
        Design.NOPPE, Design.HOCHGLANZ -> StudColors
        Design.CLASSIC -> LightColors
    }.let { supplementRoles(it, dunkel = theme == Design.WERKBANK) }

/**
 * Surfaces with their own color that don't follow from a single material role:
 * app bar, detail page bar, and the market value and purchase price value tiles.
 * In the dark always container roles (Material 3): the light brand tones as a
 * surface would glow on black, and the purchase price tile outshone the market value.
 */
data class Akzentflaechen(
    val leiste: Color, val onBar: Color,
    val detailLeiste: Color, val onDetailBar: Color,
    val markt: Color, val onMarket: Color,
    val kauf: Color, val onPurchase: Color,
)

/**
 * One accent per design: only light "brick" carries colored bars and the web's
 * petrol tile; otherwise bars on surface, market value in the main color and
 * purchase price neutral, so that the page's most important value also stands
 * out most (primaryContainer was as pale as the neutral tile in farbfaecher and noppe).
 */
internal fun akzentflaechen(theme: Design, dunkel: Boolean, s: ColorScheme): Akzentflaechen {
    val stein = theme == Design.BRICK && !dunkel
    // In the dark, primaryContainer (--b50) barely sits above surface; a quarter of the
    // main color mixed into surface gives a mid-dark tone like Material 3's step 30.
    val night = s.surface.luminance() < 0.2f
    val markt = when {
        stein -> Petrol
        night -> lerp(s.surface, s.primary, 0.28f)
        else -> s.primary
    }
    return Akzentflaechen(
        leiste = if (stein) s.primary else s.surface, onBar = if (stein) s.onPrimary else s.onSurface,
        detailLeiste = if (stein) s.secondary else s.surface, onDetailBar = if (stein) s.onSecondary else s.onSurface,
        markt = markt, onMarket = if (stein) Color.White else if (night) s.onSurface else s.onPrimary,
        // Purchase price like P&L on surface with border: two steps (market value highlighted,
        // the rest calm) instead of three card styles side by side.
        kauf = s.surface, onPurchase = s.onSurface,
    )
}

val LocalAkzentflaechen = staticCompositionLocalOf { akzentflaechen(Design.CLASSIC, false, LightColors) }

/**
 * Status colors per design. `erfolg` (success) also colors profit figures and
 * needs 4.5:1 as text on the surface.
 * Muted in the brick design, so it doesn't stick out next to sage green and sand.
 */
internal fun statusColorsFor(theme: Design, dunkel: Boolean = false): StatusFarben = if (dunkel && hatDarkVersion(theme)) {
    darkRoles(theme).let { StatusFarben(erfolg = Color(it.erfolg), warnung = Color(it.warnung), fehler = Color(it.error)) }
} else when (theme) {
    // Warning draws bars and icons: 3:1 on every light surface (WCAG 1.4.11).
    Design.BRICK -> StatusFarben(erfolg = Color(0xFF4E7058), warnung = Color(0xFF8C6A28), fehler = Color(0xFFA34B3C))
    Design.WERKBANK -> StatusFarben(erfolg = Color(0xFF6FBF7F), warnung = Color(0xFFD9A84E), fehler = Color(0xFFE07A72))
    else -> StatusFarben(erfolg = Color(0xFF166534), warnung = Color(0xFF9A6B00), fehler = Color(0xFFB91C1C))
}

/** Colors of the navigation bar and side bar (MainScaffold). */
data class TabColors(
    val leiste: Color, val anzeige: Color, val aufAnzeige: Color,
    val gewaehlt: Color, val ungewaehlt: Color,
)

/**
 * The display of the selected destination in full main color: Material would color
 * it with secondaryContainer, which barely stood out from the bar (1.03:1). So the
 * surface carries the difference, not the icon's hue alone (WCAG 1.4.11).
 */
fun tabColors(s: ColorScheme) = TabColors(
    leiste = s.surfaceContainer, anzeige = s.primary, aufAnzeige = s.onPrimary,
    gewaehlt = s.primary, ungewaehlt = s.onSurfaceVariant,
)

/**
 * Base tone of the loading tiles (Skelett.kt), measured against the background
 * instead of surface: surfaceVariant and even surfaceContainerHighest sat only
 * 1.03–1.18:1 above background in the light designs, the tiles were barely visible.
 */
fun skeletonTone(s: ColorScheme, share: Float = 0.12f): Color = lerp(s.background, s.onSurface, share)

/**
 * Fills the roles the palettes above don't name, from their own colors.
 *
 * Material3 fills missing roles with its purple base palette. Dialogs, menus,
 * snackbar, switches and text fields read exactly these roles and were
 * therefore tinted purple in every design. The steps lie between surface and
 * onSurface: darker in the light, lighter in the dark — as Material intends.
 */
internal fun supplementRoles(s: ColorScheme, dunkel: Boolean): ColorScheme {
    fun stufe(share: Float) = lerp(s.surface, s.onSurface, share)
    // Dialogs and menus sit on the container steps and carry text in primary,
    // error and onSurfaceVariant; the steps are compressed until all hold 4.5:1.
    val schrift = listOf(s.primary, s.error, s.onSurfaceVariant)
    var mass = 1f
    while (mass > 0.3f && schrift.any { contrast(it, stufe(LEVEL_HIGHEST * mass)) < TEXT_CONTRAST }) mass -= 0.05f
    fun container(share: Float) = stufe(share * mass)
    return s.copy(
        onBackground = s.onSurface,
        surfaceTint = s.primary,
        surfaceContainerLowest = if (dunkel) s.background else s.surface,
        surfaceContainerLow = container(0.025f),
        surfaceContainer = container(0.05f),
        surfaceContainerHigh = container(0.075f),
        surfaceContainerHighest = container(LEVEL_HIGHEST),
        surfaceDim = if (dunkel) s.background else stufe(0.08f),
        surfaceBright = if (dunkel) stufe(0.12f) else s.surface,
        inverseSurface = s.onSurface,
        inverseOnSurface = s.surface,
        // Die Snackbar-Aktion: so weit aufgehellt bzw. abgedunkelt, bis sie 4,5:1 erreicht.
        inversePrimary = withContrast(lerp(s.primary, if (dunkel) Color.Black else Color.White, 0.45f), s.onSurface),
        // Material sets #690005 in the dark, only 4.48:1 on the light error tones.
        onError = if (dunkel) s.background else Color.White,
        errorContainer = lerp(s.error, s.surface, 0.85f),
        onErrorContainer = lerp(s.error, s.onSurface, 0.5f),
    )
}

private const val LEVEL_HIGHEST = 0.10f
private const val TEXT_CONTRAST = 4.5f
private const val GRAPHIC_CONTRAST = 3f

/** Contrast ratio per WCAG 2 (1 to 21). */
fun contrast(a: Color, b: Color): Float {
    val la = a.luminance(); val lb = b.luminance()
    return (maxOf(la, lb) + 0.05f) / (minOf(la, lb) + 0.05f)
}

/** [farbe], schrittweise von [gegen] weg gemischt, bis sie [ziel]:1 erreicht. */
fun withContrast(farbe: Color, gegen: Color, ziel: Float = TEXT_CONTRAST): Color {
    val weg = if (gegen.luminance() > 0.5f) Color.Black else Color.White
    var share = 0f
    var c = farbe
    while (contrast(c, gegen) < ziel && share < 1f) { share += 0.05f; c = lerp(farbe, weg, share) }
    return c
}

/**
 * Chart colors of a design for its color scheme [s]. The axis text
 * ([ChartColors.gedaempft]) is onSurfaceVariant: the former slate gray #94A3B8
 * reached only 2.1:1 on white, and text must hit 4.5:1 like everything else.
 */
internal fun diagrammFarben(theme: Design, dunkel: Boolean, s: ColorScheme): ChartColors {
    val gedaempft = s.onSurfaceVariant
    return if (dunkel && hatDarkVersion(theme)) darkRoles(theme).let {
        ChartColors(Color(it.chartNew), Color(it.chartUsed), linie = Color(it.chartNew),
            raster = Color(it.chartRaster), gedaempft = gedaempft)
    } else when (theme) {
        Design.BRICK -> ChartColors(ChartNewBrick, ChartUsedBrick,
            linie = ChartNewBrick, raster = Color(0xFFE0DACE), gedaempft = gedaempft)
        // On a dark background the grid must be LIGHTER than the background, not
        // darker — otherwise it disappears.
        Design.WERKBANK -> ChartColors(ChartNewWerkbank, ChartUsedWerkbank,
            linie = ChartNewWerkbank, raster = Color(0xFF2C261E), gedaempft = gedaempft)
        // Farbfaecher and noppe color themes or tiles, NOT states: new stays
        // blue, used amber/orange, so the color systems don't get confused.
        Design.FARBFAECHER -> ChartColors(ChartNewFarbfaecher, ChartUsedFarbfaecher, gedaempft = gedaempft)
        // The web's orange (ChartUsedNoppe) reaches only 2.6:1 on white; as a line it needs 3:1.
        Design.NOPPE, Design.HOCHGLANZ -> ChartColors(ChartNewNoppe, ChartUsedNoppe.let { withContrast(it, s.surface, GRAPHIC_CONTRAST) },
            raster = Color(0xFFE4E8EF), gedaempft = gedaempft)
        Design.CLASSIC -> ChartColors(ChartNewClassic, ChartUsedClassic, gedaempft = gedaempft)
    }
}

/**
 * [systemfarben]: Material You — colors from the system, shapes and text from
 * the design. The charts then take the scheme's roles so their colors match
 * the surface; the status colors stay, because profit must stay green.
 */
@Composable
fun BrickInventoryManagerTheme(
    theme: Design = Design.DEFAULT, dunkel: Boolean = false, systemfarben: Boolean = false,
    content: @Composable () -> Unit,
) {
    val isBrick = theme == Design.BRICK
    val context = androidx.compose.ui.platform.LocalContext.current
    val dynamisch = systemfarben && android.os.Build.VERSION.SDK_INT >= SYSTEMFARBEN_AB_SDK
    val colors = remember(theme, dunkel, dynamisch) {
        if (dynamisch) systemSchema(context, dunkel) else farbschema(theme, dunkel)
    }
    val chartColors = if (dynamisch) ChartColors(colors.primary, colors.tertiary, linie = colors.primary,
        raster = colors.outlineVariant, gedaempft = colors.onSurfaceVariant)
    else diagrammFarben(theme, dunkel, colors)
    // Dark system colors under a design with no dark version: the dark
    // status colors from classic, otherwise dark green would stand on a dark background.
    val statusColors = if (dynamisch && dunkel && !hatDarkVersion(theme)) statusColorsFor(Design.CLASSIC, true)
                       else statusColorsFor(theme, dunkel)
    val brickDecor = if (dunkel && isBrick) darkBrickDecor().let { BrickDecor(Color(it.studs), Color(it.slate), Color(it.onSlate)) }
                     else BrickDecor(SlateBlueNoppe, SlateBlue, Color.White)
    CompositionLocalProvider(
        LocalIsBrickTheme provides isBrick,
        LocalIsColorSlotsTheme provides (theme == Design.FARBFAECHER),
        LocalIsStudTheme provides (theme == Design.NOPPE || theme == Design.HOCHGLANZ),
        LocalIsGloss provides (theme == Design.HOCHGLANZ),
        LocalChartColors  provides chartColors,
        LocalStatusFarben provides statusColors,
        LocalBrickDecor provides brickDecor,
        LocalAkzentflaechen provides akzentflaechen(theme, dunkel, colors),
    ) {
        MaterialTheme(
            colorScheme = colors,
            typography  = if (theme == Design.NOPPE || theme == Design.HOCHGLANZ) StudTypography else BrandsTypography,
            content     = content
        )
    }
}

/** Only call from Android 12 on ([SYSTEMFARBEN_AB_SDK]); the caller checks that. */
@android.annotation.SuppressLint("NewApi")
private fun systemSchema(context: android.content.Context, dunkel: Boolean): ColorScheme =
    if (dunkel) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
