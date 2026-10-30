package ch.brickinventoryapp.ui.theme

/*
 * Die Regeln der dunklen Fassung; die Werte erzeugt der Generator in
 * DunkelTokens.kt aus shared/design-tokens.json (Abschnitt `dunkel`).
 */

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

/** Farben der Stein-Dekoration als ARGB: Noppen über der Kante, die Schieferkachel und ihre Schrift. */
data class SteinDekorFarben(val noppen: Long, val schiefer: Long, val aufSchiefer: Long)

/**
 * Die Stein-Dekoration in der dunklen Fassung von „brick“, wie [data-dunkel] im
 * Web (themes/brick.css): Noppen --b400, Schieferkachel --b600 mit Schrift
 * --auf-primaer. Hell sind es dieselben Tokens aus DesignTokens.kt; fest
 * eingesetzt blieben die hellen Töne auch im Dunkeln stehen.
 */
fun dunkleSteinDekor(): SteinDekorFarben {
    fun t(name: String) = argb(dunkelToken("brick", name) ?: error("Token --$name fehlt in der dunklen Fassung"))
    return SteinDekorFarben(noppen = t("b400"), schiefer = t("b600"), aufSchiefer = t("auf-primaer"))
}
