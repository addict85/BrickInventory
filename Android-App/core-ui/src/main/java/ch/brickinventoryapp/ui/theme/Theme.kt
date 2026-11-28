package ch.brickinventoryapp.ui.theme

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
import ch.brickinventoryapp.model.appearance.Design
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
 * Does the tile carry a stud lid in the `noppe` theme?
 *
 * Like [LocalIsColorSlotsTheme]: the tile itself should keep the same
 * markup in every theme, and only this Local decides whether the
 * lid is added.
 */
val LocalIsStudTheme = staticCompositionLocalOf { false }

/**
 * Does the surface carry the gloss of the `hochglanz` theme? Separate from
 * [LocalIsStudTheme]: `hochglanz` is `noppe` in a different material; the tile
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

// ── Chart colors per state ────────────────────────────────────────────────
/**
 * Colors of the history lines from the theme, like --chart-new/--chart-used on the
 * web. In the brick theme, sage green and sand, the same colors as the
 * condition badges, as a solid tone, because the containers would barely be visible on a white
 * background. The defaults of [line] and [raster] are the classic values; [muted] is
 * for text (axes, hints) and therefore comes from [chartColors].
 */
data class ChartColors(
    val new: Color,
    val used: Color,
    val line: Color = Color(0xFF2563EB),
    val raster: Color = Color(0xFFE2E8F0),
    val muted: Color = Color(0xFF56616E),
)

// The four Chart*-colors live in DesignTokens.kt (generated, see above) —
// including the reasoning for why the used line is sand in the brick theme.

// Werkbank (dark): darkColorScheme, because some components (text-field borders,
// ripple) read their brightness from it. Values as in `themes/werkbank.css`: warm graphite
// and brass instead of anthracite with blue, otherwise it would match „Classic dark“ (DarkTokens.kt).
private val WorkbenchColors = darkColorScheme(
    primary              = WorkbenchAzure,
    onPrimary            = Color(0xFF1E1608),
    primaryContainer     = WorkbenchAzureDark,
    onPrimaryContainer   = WorkbenchAzureLight,
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
// theme colors (FanColors in DesignTokens.kt) are the only colorful
// surfaces and thus mean something.
private val ColorSlotsColors = lightColorScheme(
    primary              = FanInk,
    onPrimary            = Color.White,
    primaryContainer     = FanInkLight,
    onPrimaryContainer   = FanInkDark,
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
private val StudOchre = Color(0xFF7A5200)

private val StudColors = lightColorScheme(
    primary              = StudBlue,
    onPrimary            = Color.White,
    primaryContainer     = StudBlueLight,
    onPrimaryContainer   = StudInk,
    secondary            = StudInk,
    onSecondary          = Color.White,
    secondaryContainer   = Color(0xFFEEF1F6),
    onSecondaryContainer = StudInk,
    tertiary             = StudOchre,
    onTertiary           = Color.White,
    tertiaryContainer    = StudYellowLight,
    onTertiaryContainer  = StudInk,
    background           = Color(0xFFEEF1F6),
    surface              = Color.White,
    surfaceVariant       = Color(0xFFF7F9FC),
    onSurface            = StudInk,
    onSurfaceVariant     = Color(0xFF5A6270),
    outline              = StudInk,
    // The same value that supplementRoles() previously blended from surface and onSurface.
    outlineVariant       = Color(0xFFD7D8DA),
    error                = Color(0xFFB91C1C),
)

/**
 * Nunito, the font of the `noppe` theme: the system font stays
 * angular even at 900. Three static cuts instead of the variable one, which would need
 * FontVariation and thus a higher API level; the same shapes as public/vendor/fonts/ on the web.
 */
private val NunitoFamily = FontFamily(
    Font(R.font.nunito_regular, FontWeight.Normal),
    Font(R.font.nunito_bold, FontWeight.Bold),
    Font(R.font.nunito_black, FontWeight.Black),
)

/**
 * Plus Jakarta Sans — the web app's font (`styles.css` --font) for all
 * themes except `noppe`. Static cuts from the web app's variable
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
 * whole UI, and SpacingScaleTest would be right to report it.
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

/** The typography of the `noppe` theme: the same scale, a different font. */
private val StudTypography: Typography = withFamily(NunitoFamily)
private val BrandsTypography: Typography = withFamily(JakartaFamily)

/**
 * The cap color of a tile in the `noppe` design.
 *
 * Position modulo six, exactly like `.sc:nth-child(6n+…)` in `themes/noppe.css`.
 * It means NOTHING and only gives rhythm — the explicit difference to
 * [slotsTone] below, where the color IS the theme.
 */
fun brickTone(position: Int): Color =
    BrickColors[((position % BrickColors.size) + BrickColors.size) % BrickColors.size]

/**
 * The tone of a LEGO theme in the `farbfaecher` design.
 *
 * Theme number modulo twelve, exactly like `--slots-tone` in the web app. Without
 * a number there is no tone — then the stripe stays off instead of showing a
 * wrong one (the same rule as applyTheme(): no information changes nothing).
 */
fun slotsTone(themeNumber: Int?): Color? =
    themeNumber?.let { FanColors[((it % FanColors.size) + FanColors.size) % FanColors.size] }

val LocalChartColors = staticCompositionLocalOf {
    ChartColors(new = ChartNewClassic, used = ChartUsedClassic)
}

/** Colors of the brick decoration (studs, slate tile) — light or dark, see darkBrickDecor(). */
data class BrickDecor(val studs: Color, val slate: Color, val onSlate: Color)

val LocalBrickDecor = staticCompositionLocalOf { BrickDecor(SlateBlueStud, SlateBlue, Color.White) }

/**
 * The dark version of a design from the tokens (DarkTokens.kt). Same
 * mapping as WorkbenchColors, only with the design's brand colors.
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
internal fun colorScheme(theme: Design, dark: Boolean = false): ColorScheme =
    if (dark && hasDarkVersion(theme)) supplementRoles(darkSchema(theme).let {
        // Like light: `noppe` red is barely distinguishable from the error color in the dark.
        // Main color becomes the blue of the chart line, the containers take the blue steps
        // from classic, and the accent stays the amber of the base.
        if (theme == Design.STUD || theme == Design.GLOSSY) it.copy(primary = Color(0xFF6AA8FF),
            primaryContainer = Color(argb(darkToken(Design.CLASSIC, "b50") ?: "#13233d")),
            onPrimaryContainer = Color(argb(darkToken(Design.CLASSIC, "b700") ?: "#a9caff")))
        else it
    }, dark = true)
    else when (theme) {
        Design.BRICK -> BrickBlueColors
        Design.WORKBENCH -> WorkbenchColors
        Design.COLOR_FAN -> ColorSlotsColors
        // Glossy is `noppe` in a different material, not in different colors (`inherits`).
        Design.STUD, Design.GLOSSY -> StudColors
        Design.CLASSIC -> LightColors
    }.let { supplementRoles(it, dark = theme == Design.WORKBENCH) }

/**
 * Surfaces with their own color that don't follow from a single material role:
 * app bar, detail page bar, and the market value and purchase price value tiles.
 * In the dark always container roles (Material 3): the light brand tones as a
 * surface would glow on black, and the purchase price tile outshone the market value.
 */
data class AccentSurfaces(
    val bar: Color, val onBar: Color,
    val detailBar: Color, val onDetailBar: Color,
    val market: Color, val onMarket: Color,
    val purchase: Color, val onPurchase: Color,
)

/**
 * One accent per design: only light "brick" carries colored bars and the web's
 * petrol tile; otherwise bars on surface, market value in the main color and
 * purchase price neutral, so that the page's most important value also stands
 * out most (primaryContainer was as pale as the neutral tile in `farbfaecher` and `noppe`).
 */
internal fun accentSurfaces(theme: Design, dark: Boolean, s: ColorScheme): AccentSurfaces {
    val brick = theme == Design.BRICK && !dark
    // In the dark, primaryContainer (--b50) barely sits above surface; a quarter of the
    // main color mixed into surface gives a mid-dark tone like Material 3's step 30.
    val night = s.surface.luminance() < 0.2f
    val market = when {
        brick -> Petrol
        night -> lerp(s.surface, s.primary, 0.28f)
        else -> s.primary
    }
    return AccentSurfaces(
        bar = if (brick) s.primary else s.surface, onBar = if (brick) s.onPrimary else s.onSurface,
        detailBar = if (brick) s.secondary else s.surface, onDetailBar = if (brick) s.onSecondary else s.onSurface,
        market = market, onMarket = if (brick) Color.White else if (night) s.onSurface else s.onPrimary,
        // Purchase price like P&L on surface with border: two steps (market value highlighted,
        // the rest calm) instead of three card styles side by side.
        purchase = s.surface, onPurchase = s.onSurface,
    )
}

val LocalAccentSurfaces = staticCompositionLocalOf { accentSurfaces(Design.CLASSIC, false, LightColors) }

/**
 * Status colors per design. `success` (success) also colors profit figures and
 * needs 4.5:1 as text on the surface.
 * Muted in the brick design, so it doesn't stick out next to sage green and sand.
 */
internal fun statusColorsFor(theme: Design, dark: Boolean = false): StatusColors = if (dark && hasDarkVersion(theme)) {
    darkRoles(theme).let { StatusColors(success = Color(it.success), warning = Color(it.warning), error = Color(it.error)) }
} else when (theme) {
    // Warning draws bars and icons: 3:1 on every light surface (WCAG 1.4.11).
    Design.BRICK -> StatusColors(success = Color(0xFF4E7058), warning = Color(0xFF8C6A28), error = Color(0xFFA34B3C))
    Design.WORKBENCH -> StatusColors(success = Color(0xFF6FBF7F), warning = Color(0xFFD9A84E), error = Color(0xFFE07A72))
    else -> StatusColors(success = Color(0xFF166534), warning = Color(0xFF9A6B00), error = Color(0xFFB91C1C))
}

/** Colors of the navigation bar and side bar (MainScaffold). */
data class TabColors(
    val bar: Color, val display: Color, val onDisplay: Color,
    val chosen: Color, val unselected: Color,
)

/**
 * Material's quiet secondaryContainer for the selected destination, mixed toward the main
 * color just far enough to stand out from bar and side bar (3:1, WCAG 1.4.11): as is it reached only
 * 1.03:1, and the full main color shouted louder than the content.
 */
fun tabColors(s: ColorScheme): TabColors {
    val display = standingOut(s.secondaryContainer, s.primary, s.surfaceContainer, s.surface)
    val onDisplay = listOf(s.onSecondaryContainer, s.onPrimary, Color.Black, Color.White)
        .firstOrNull { contrast(it, display) >= TEXT_CONTRAST } ?: Color.White
    return TabColors(
        bar = s.surfaceContainer, display = display, onDisplay = onDisplay,
        chosen = s.primary, unselected = s.onSurfaceVariant,
    )
}

/** [color], mixed toward [toward] until it reaches 3:1 on both surfaces; the hue stays the design's. */
private fun standingOut(color: Color, toward: Color, bar: Color, side: Color): Color {
    var share = 0f
    var c = color
    while ((contrast(c, bar) < GRAPHIC_CONTRAST || contrast(c, side) < GRAPHIC_CONTRAST) && share < 1f) {
        share += 0.05f; c = lerp(color, toward, share)
    }
    return c
}

/**
 * Base tone of the loading tiles (Skeleton.kt), measured against the background
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
internal fun supplementRoles(s: ColorScheme, dark: Boolean): ColorScheme {
    fun level(share: Float) = lerp(s.surface, s.onSurface, share)
    // Dialogs and menus sit on the container steps and carry text in primary,
    // error and onSurfaceVariant; the steps are compressed until all hold 4.5:1.
    val font = listOf(s.primary, s.error, s.onSurfaceVariant)
    var mass = 1f
    while (mass > 0.3f && font.any { contrast(it, level(LEVEL_HIGHEST * mass)) < TEXT_CONTRAST }) mass -= 0.05f
    fun container(share: Float) = level(share * mass)
    return s.copy(
        onBackground = s.onSurface,
        surfaceTint = s.primary,
        surfaceContainerLowest = if (dark) s.background else s.surface,
        surfaceContainerLow = container(0.025f),
        surfaceContainer = container(0.05f),
        surfaceContainerHigh = container(0.075f),
        surfaceContainerHighest = container(LEVEL_HIGHEST),
        surfaceDim = if (dark) s.background else level(0.08f),
        surfaceBright = if (dark) level(0.12f) else s.surface,
        inverseSurface = s.onSurface,
        inverseOnSurface = s.surface,
        // The snackbar action: lightened or darkened until it reaches 4.5:1.
        inversePrimary = withContrast(lerp(s.primary, if (dark) Color.Black else Color.White, 0.45f), s.onSurface),
        // Material sets #690005 in the dark, only 4.48:1 on the light error tones.
        onError = if (dark) s.background else Color.White,
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

/** [color], mixed away from [against] step by step until it reaches [target]:1. */
fun withContrast(color: Color, against: Color, target: Float = TEXT_CONTRAST): Color {
    val gone = if (against.luminance() > 0.5f) Color.Black else Color.White
    var share = 0f
    var c = color
    while (contrast(c, against) < target && share < 1f) { share += 0.05f; c = lerp(color, gone, share) }
    return c
}

/**
 * Chart colors of a design for its color scheme [s]. The axis text
 * ([ChartColors.muted]) is onSurfaceVariant: the former slate gray #94A3B8
 * reached only 2.1:1 on white, and text must hit 4.5:1 like everything else.
 */
internal fun chartColors(theme: Design, dark: Boolean, s: ColorScheme): ChartColors {
    val muted = s.onSurfaceVariant
    return if (dark && hasDarkVersion(theme)) darkRoles(theme).let {
        ChartColors(Color(it.chartNew), Color(it.chartUsed), line = Color(it.chartNew),
            raster = Color(it.chartRaster), muted = muted)
    } else when (theme) {
        Design.BRICK -> ChartColors(ChartNewBrick, ChartUsedBrick,
            line = ChartNewBrick, raster = Color(0xFFE0DACE), muted = muted)
        // On a dark background the grid must be LIGHTER than the background, not
        // darker — otherwise it disappears.
        Design.WORKBENCH -> ChartColors(ChartNewWorkbench, ChartUsedWorkbench,
            line = ChartNewWorkbench, raster = Color(0xFF2C261E), muted = muted)
        // Farbfaecher and `noppe` color themes or tiles, NOT states: new stays
        // blue, used amber/orange, so the color systems don't get confused.
        Design.COLOR_FAN -> ChartColors(ChartNewColorFan, ChartUsedColorFan, muted = muted)
        // The web's orange (ChartUsedStud) reaches only 2.6:1 on white; as a line it needs 3:1.
        Design.STUD, Design.GLOSSY -> ChartColors(ChartNewStud, ChartUsedStud.let { withContrast(it, s.surface, GRAPHIC_CONTRAST) },
            raster = Color(0xFFE4E8EF), muted = muted)
        Design.CLASSIC -> ChartColors(ChartNewClassic, ChartUsedClassic, muted = muted)
    }
}

/**
 * [systemColors]: Material You — colors from the system, shapes and text from
 * the design. The charts then take the scheme's roles so their colors match
 * the surface; the status colors stay, because profit must stay green.
 */
@Composable
fun BrickInventoryManagerTheme(
    theme: Design = Design.DEFAULT, dark: Boolean = false, systemColors: Boolean = false,
    content: @Composable () -> Unit,
) {
    val isBrick = theme == Design.BRICK
    val context = androidx.compose.ui.platform.LocalContext.current
    val dynamic = systemColors && android.os.Build.VERSION.SDK_INT >= SYSTEM_COLORS_AB_SDK
    val colors = remember(theme, dark, dynamic) {
        if (dynamic) systemSchema(context, dark) else colorScheme(theme, dark)
    }
    val chartColors = if (dynamic) ChartColors(colors.primary, colors.tertiary, line = colors.primary,
        raster = colors.outlineVariant, muted = colors.onSurfaceVariant)
    else chartColors(theme, dark, colors)
    // Dark system colors under a design with no dark version: the dark
    // status colors from classic, otherwise dark green would stand on a dark background.
    val statusColors = if (dynamic && dark && !hasDarkVersion(theme)) statusColorsFor(Design.CLASSIC, true)
                       else statusColorsFor(theme, dark)
    val brickDecor = if (dark && isBrick) darkBrickDecor().let { BrickDecor(Color(it.studs), Color(it.slate), Color(it.onSlate)) }
                     else BrickDecor(SlateBlueStud, SlateBlue, Color.White)
    CompositionLocalProvider(
        LocalIsBrickTheme provides isBrick,
        LocalIsColorSlotsTheme provides (theme == Design.COLOR_FAN),
        LocalIsStudTheme provides (theme == Design.STUD || theme == Design.GLOSSY),
        LocalIsGloss provides (theme == Design.GLOSSY),
        LocalChartColors  provides chartColors,
        LocalStatusColors provides statusColors,
        LocalBrickDecor provides brickDecor,
        LocalAccentSurfaces provides accentSurfaces(theme, dark, colors),
    ) {
        MaterialTheme(
            colorScheme = colors,
            typography  = if (theme == Design.STUD || theme == Design.GLOSSY) StudTypography else BrandsTypography,
            content     = content
        )
    }
}

/** Only call from Android 12 on ([SYSTEM_COLORS_AB_SDK]); the caller checks that. */
@android.annotation.SuppressLint("NewApi")
private fun systemSchema(context: android.content.Context, dark: Boolean): ColorScheme =
    if (dark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
