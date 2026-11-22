package ch.brickinventoryapp.ui.theme

import ch.brickinventoryapp.model.ui.theme.Design

/*
 * The rules of the dark variant; the generator produces the values in
 * DarkTokens.kt from shared/design-tokens.json (section `dark`).
 */

/** Werkbank is already dark and has no variant of its own. */
fun hasDarkVersion(design: Design): Boolean = design.identifier in DarkTokens.designs

/** A token of the dark variant: first the theme (including `erbt`), then the base. */
fun darkToken(design: Design, token: String): String? {
    val own = DarkTokens.designs[design.identifier] ?: DarkTokens.designs.getValue(Design.DEFAULT.identifier)
    val inherited = own["erbt"]?.let { DarkTokens.designs[it] }.orEmpty()
    return own[token]?.takeIf { token != "erbt" } ?: inherited[token] ?: DarkTokens.basis[token]
}

/** "#rrggbb" as opaque ARGB. */
fun argb(hex: String): Long = 0xFF000000L or hex.removePrefix("#").toLong(16)

/**
 * The dark variant's Material roles, from the tokens: the same mapping
 * as the Werkbank scheme (Theme.kt), only with the theme's brand colors.
 * As numbers, so the mapping is testable without Compose.
 */
data class DarkRoles(
    val primary: Long, val onPrimary: Long, val primaryContainer: Long, val onPrimaryContainer: Long,
    val secondary: Long, val onSecondary: Long, val secondaryContainer: Long, val onSecondaryContainer: Long,
    val tertiary: Long, val onTertiary: Long, val tertiaryContainer: Long, val onTertiaryContainer: Long,
    val background: Long, val surface: Long, val surfaceVariant: Long,
    val onSurface: Long, val onSurfaceVariant: Long, val outline: Long, val outlineVariant: Long,
    val error: Long,
    val success: Long, val warning: Long,
    val chartNew: Long, val chartUsed: Long, val chartRaster: Long, val chartDimmed: Long,
)

fun darkRoles(design: Design): DarkRoles {
    fun t(name: String) = argb(darkToken(design, name) ?: error("Token --$name fehlt in der dunklen Fassung"))
    // Selected chips and the small button carry secondaryContainer, in the dark theme in the tone
    // of the primary color: amber next to light blue (brick, formerly also classic) used to be two
    // accents. Fächer and Noppe are light-neutral and stay that way here.
    val (secondSurface, onSecondSurface) = when (design) {
        Design.BRICK, Design.CLASSIC -> t("b50") to t("b700")
        else -> t("s200") to t("txt")
    }
    return DarkRoles(
        primary = t("b600"), onPrimary = t("auf-primaer"),
        primaryContainer = t("b50"), onPrimaryContainer = t("b700"),
        secondary = t("b700"), onSecondary = t("auf-primaer"),
        secondaryContainer = secondSurface, onSecondaryContainer = onSecondSurface,
        tertiary = t("a500"), onTertiary = t("auf-primaer"),
        tertiaryContainer = t("a100"), onTertiaryContainer = t("a-schrift"),
        background = t("bg"), surface = t("sur"), surfaceVariant = t("s200"),
        onSurface = t("txt"), onSurfaceVariant = t("mut"),
        // s500, not s400: a border needs 3:1 even on the highest surface level too.
        outline = t("s500"), outlineVariant = t("bdr"),
        error = t("r500"),
        success = t("gewinn"), warning = t("a500"),
        chartNew = t("chart-new"), chartUsed = t("chart-used"),
        chartRaster = t("s200"), chartDimmed = t("s400"),
    )
}

/** Colors of the brick decoration as ARGB: studs over the edge, the slate tile and its text. */
data class BrickDecorColors(val studs: Long, val slate: Long, val onSlate: Long)

/**
 * The brick decoration in the dark variant of „brick“, as with [data-dunkel] on
 * the web (`themes/brick.css`): studs --b400, slate tile --b600 with text
 * --auf-primaer. In light mode they're the same tokens from DesignTokens.kt; hardcoded,
 * the light tones stayed in place even in the dark theme.
 */
fun darkBrickDecor(): BrickDecorColors {
    fun t(name: String) = argb(darkToken(Design.BRICK, name) ?: error("Token --$name fehlt in der dunklen Fassung"))
    return BrickDecorColors(studs = t("b400"), slate = t("b600"), onSlate = t("auf-primaer"))
}
