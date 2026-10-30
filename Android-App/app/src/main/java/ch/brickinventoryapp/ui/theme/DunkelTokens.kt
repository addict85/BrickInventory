package ch.brickinventoryapp.ui.theme

/**
 * Die dunkle Fassung je Design, wie das Web sie mit <html data-dunkel> zeigt:
 * Abschrift des Abschnitts `dunkel` aus shared/design-tokens.json. 'basis'
 * belegt Flächen, Grauachse und Meldefarben für alle Designs, je Design stehen
 * nur die aufgehellten Markenfarben. DunkelTokensTest vergleicht jeden Wert mit
 * der Quelle; DesignTokens.kt erzeugt der Generator noch ohne diesen Abschnitt.
 */
object DunkelTokens {
    val basis: Map<String, String> = mapOf(
        "s50" to "#11151a", "s100" to "#161b21", "s200" to "#262d36", "s300" to "#2f3843",
        "s400" to "#6f7986", "s500" to "#8d96a3", "s600" to "#b6bec9", "s700" to "#cfd6de",
        "s800" to "#e6e9ed", "bg" to "#14181d", "sur" to "#1b2027", "bdr" to "#2f3843",
        "txt" to "#e6e9ed", "mut" to "#9aa3af", "screen-bg" to "#14181d", "auf-primaer" to "#0b1a2e",
        "g100" to "#1d2a20", "g500" to "#6fbf7f", "g700" to "#7fcf8f", "gewinn" to "#7fcf8f",
        "r100" to "#2c1c1c", "r500" to "#e07a72", "r700" to "#f08c84", "a100" to "#2a2418",
        "a500" to "#d9a84e", "a-schrift" to "#e0b462", "p100" to "#241d2e", "p600" to "#b087d6",
    )

    val designs: Map<String, Map<String, String>> = mapOf(
        "classic" to mapOf(
            "b50" to "#13233d", "b100" to "#172c4d", "b200" to "#1e3a63", "b300" to "#2b4f85",
            "b400" to "#3f6db5", "b500" to "#5b8def", "b600" to "#7ab0ff", "b700" to "#a9caff",
            "chart-new" to "#7ab0ff", "chart-used" to "#f0a54a",
        ),
        "brick" to mapOf(
            "b50" to "#18222d", "b100" to "#1d2a38", "b200" to "#273849", "b300" to "#35506a",
            "b400" to "#4c6f93", "b500" to "#7397bd", "b600" to "#93b6dc", "b700" to "#bcd3ec",
            "chart-new" to "#93b6dc", "chart-used" to "#c9a46a",
        ),
        "farbfaecher" to mapOf(
            "b50" to "#1c1c1c", "b100" to "#242424", "b200" to "#333333", "b300" to "#4a4a4a",
            "b400" to "#6e6e6e", "b500" to "#a0a0a0", "b600" to "#d6d6d6", "b700" to "#f0f0f0",
            "chart-new" to "#7ab0ff", "chart-used" to "#f0a54a",
        ),
        "noppe" to mapOf(
            "b50" to "#2a1415", "b100" to "#3a1a1c", "b200" to "#5a2226", "b300" to "#8a2c32",
            "b400" to "#c43c43", "b500" to "#e8585f", "b600" to "#ff7479", "b700" to "#ffa4a8",
            "chart-new" to "#6aa8ff", "chart-used" to "#ff9a40", "ink" to "#05070a",
        ),
        "hochglanz" to mapOf(
            "erbt" to "noppe",
        ),
    )
}

/** Werkbank ist schon dunkel und hat keine eigene Fassung. */
fun hatDunkleFassung(design: String): Boolean = design in DunkelTokens.designs

/** Ein Token der dunklen Fassung: erst das Design (samt `erbt`), dann die Basis. */
fun dunkelToken(design: String, token: String): String? {
    val eigen = DunkelTokens.designs[design] ?: DunkelTokens.designs.getValue("classic")
    val geerbt = eigen["erbt"]?.let { DunkelTokens.designs[it] }.orEmpty()
    return eigen[token]?.takeIf { token != "erbt" } ?: geerbt[token] ?: DunkelTokens.basis[token]
}

/** "#rrggbb" als undurchsichtiges ARGB. */
fun argb(hex: String): Long = 0xFF000000L or hex.removePrefix("#").toLong(16)

/**
 * Die Material-Rollen der dunklen Fassung, aus den Tokens: dieselbe Zuordnung
 * wie das Werkbank-Schema (Theme.kt), nur mit den Markenfarben des Designs.
 * Als Zahlen, damit die Zuordnung ohne Compose prüfbar ist.
 */
data class DunkleRollen(
    val primary: Long, val onPrimary: Long, val primaryContainer: Long, val onPrimaryContainer: Long,
    val secondary: Long, val onSecondary: Long, val secondaryContainer: Long, val onSecondaryContainer: Long,
    val tertiary: Long, val onTertiary: Long, val tertiaryContainer: Long, val onTertiaryContainer: Long,
    val background: Long, val surface: Long, val surfaceVariant: Long,
    val onSurface: Long, val onSurfaceVariant: Long, val outline: Long, val outlineVariant: Long,
    val error: Long,
    val erfolg: Long, val warnung: Long,
    val chartNeu: Long, val chartGebraucht: Long, val chartRaster: Long, val chartGedaempft: Long,
)

fun dunkleRollen(design: String): DunkleRollen {
    fun t(name: String) = argb(dunkelToken(design, name) ?: error("Token --$name fehlt in der dunklen Fassung"))
    return DunkleRollen(
        primary = t("b600"), onPrimary = t("auf-primaer"),
        primaryContainer = t("b50"), onPrimaryContainer = t("b700"),
        secondary = t("b700"), onSecondary = t("auf-primaer"),
        secondaryContainer = t("a100"), onSecondaryContainer = t("a-schrift"),
        tertiary = t("a500"), onTertiary = t("auf-primaer"),
        tertiaryContainer = t("a100"), onTertiaryContainer = t("a-schrift"),
        background = t("bg"), surface = t("sur"), surfaceVariant = t("s200"),
        onSurface = t("txt"), onSurfaceVariant = t("mut"),
        // s500, nicht s400: Ein Rahmen braucht 3:1 auch auf der höchsten Flächenstufe.
        outline = t("s500"), outlineVariant = t("bdr"),
        error = t("r500"),
        erfolg = t("gewinn"), warnung = t("a500"),
        chartNeu = t("chart-new"), chartGebraucht = t("chart-used"),
        chartRaster = t("s200"), chartGedaempft = t("s400"),
    )
}
