package ch.brickinventoryapp.ui.theme

import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

// Ermöglicht Composables zu erkennen, ob das "Stein (Blau)"-Design aktiv ist,
// um strukturelle Stein-Elemente (Noppen-Deckel, Salbei-Badges …) nur dort zu zeigen.
val LocalIsBrickTheme = staticCompositionLocalOf { false }

// BrandBlue, BrandBlueDark, BrandBlueLight und BrandBlue50 stehen in
// DesignTokens.kt — erzeugt aus shared/design-tokens.json, damit sie mit der
// Webapp nicht auseinanderlaufen koennen. Gleiche Datei, gleiches Paket, also
// hier ohne Import nutzbar.

// Keep BrandRed for accents / G&V
val BrandRed        = Color(0xFFE63329)
val BrandRedDark    = Color(0xFFB5231C)
val BrandYellow     = Color(0xFFF5A800)

private val LightColors = lightColorScheme(
    primary             = BrandBlue,
    onPrimary           = Color.White,
    primaryContainer    = BrandBlue50,
    onPrimaryContainer  = BrandBlueDark,
    secondary           = BrandBlueDark,
    onSecondary         = Color.White,
    secondaryContainer  = BrandBlueLight,
    onSecondaryContainer = BrandBlueDark,
    tertiary            = BrandRed,
    onTertiary          = Color.White,
    tertiaryContainer   = Color(0xFFFFDAD6),
    // --s100 der Webapp, NICHT --s50 (dort steht der Seitenhintergrund --bg).
    // Hier stand jahrelang "// --s50 equivalent", waehrend der Wert --s100 war —
    // ein Kommentar, der seinem eigenen Wert widersprach.
    //
    // Richtig ist der WERT: Compose fuehrt mit background, surface und
    // surfaceVariant drei Ebenen, wo das Web mit --bg und --sur zwei fuehrt.
    // surfaceVariant traegt unten bereits --s50 (#f8fafc). Bekaeme background
    // denselben Wert, waeren beide identisch — und die Flaechen, die mit
    // surfaceVariant auf dem Hintergrund liegen (Etiketten, Fortschrittsspur,
    // ausgewaehlte Zeile, die Platzhalter-Kacheln des Katalogs), verschwaenden.
    background          = Color(0xFFF1F5F9),  // --s100
    surface             = Color.White,
    surfaceVariant      = Color(0xFFF8FAFC),
    onSurface           = Color(0xFF1E293B),
    onSurfaceVariant    = Color(0xFF64748B),
    outline             = Color(0xFFE2E8F0),
    error               = Color(0xFFDC2626),
)

// ── Stein-Design (blau) — gedämpftes Schieferblau, passend zur Webapp ──────────
// SlateBlue, SlateBlueDark, SlateBlueLight und Petrol stehen in
// DesignTokens.kt (erzeugt, siehe oben).
val PetrolLight      = Color(0xFFCFE3E8)
val BrickSand        = Color(0xFFE9DED0)  // "Gebraucht"-Akzent (Container)
val BrickSandText    = Color(0xFF5C4A2E)
val BrickSage        = Color(0xFFE1EBE2)  // "Neu"-Akzent (Container, Salbeigrün)
val BrickSageText    = Color(0xFF4A6B52)
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
    onSurfaceVariant    = Color(0xFF6B7785),
    outline             = Color(0xFFCDD7E2),
    error               = Color(0xFFC0564E),
)

// ── Diagrammfarben je Zustand ────────────────────────────────────────────────
/**
 * Farben der Verlaufslinien — aus dem Design, nicht im Zeichencode verdrahtet.
 *
 * Entspricht --chart-new / --chart-used der Webapp (styles.css bzw.
 * themes/brick.css). Im Stein-Design sind das Salbeigrün und Sand, dieselben
 * Farben, die die Zustands-Plaketten tragen: Wer sie im Diagramm wiedererkennt,
 * muss die Legende nicht lesen.
 *
 * Die Werte hier sind die VOLLTON-Varianten der Plakettenfarben. Die Container
 * BrickSage/BrickSand oben sind für Flächen hinter Text gedacht und als Linie
 * auf weissem Grund kaum zu sehen.
 */
/**
 * Farben des Verlaufsdiagramms.
 *
 * [linie], [raster] und [gedaempft] kamen in Nachtrag 120 dazu — sie standen
 * fest in PortfolioChart.kt und zogen beim Designwechsel nicht mit, obwohl
 * `new`/`used` daneben es längst taten. Vorgabewerte, weil die klassischen
 * Werte zahlengleich mit dem sind, was vorher dort stand.
 */
data class ChartColors(
    val new: Color,
    val used: Color,
    val linie: Color = Color(0xFF2563EB),
    val raster: Color = Color(0xFFE2E8F0),
    val gedaempft: Color = Color(0xFF94A3B8),
)

// Die vier Chart*-Farben stehen in DesignTokens.kt (erzeugt, siehe oben) —
// samt der Begruendung, warum die Gebraucht-Linie im Stein-Design Sand ist.

val LocalChartColors = staticCompositionLocalOf {
    ChartColors(new = ChartNewClassic, used = ChartUsedClassic)
}

@Composable
fun BrickInventoryManagerTheme(theme: String = "classic", content: @Composable () -> Unit) {
    val isBrick = theme == "brick"
    val colors = if (isBrick) BrickBlueColors else LightColors
    val chartColors = if (isBrick)
        ChartColors(ChartNewBrick, ChartUsedBrick,
            linie = ChartNewBrick, raster = Color(0xFFE0DACE), gedaempft = Color(0xFF8C8577))
    else
        ChartColors(ChartNewClassic, ChartUsedClassic)
    // Statusfarben je Design (Nachtrag 120). Im Stein-Design gedeckter, damit
    // sie neben Salbeigrün und Sand nicht herausstechen — vorher standen zwölf
    // feste Farben im Quelltext verteilt und zogen beim Designwechsel nicht mit.
    val statusFarben = if (isBrick)
        StatusFarben(erfolg = Color(0xFF5F8468), warnung = Color(0xFFB08A3E), fehler = Color(0xFFA34B3C))
    else
        StatusFarben(erfolg = Color(0xFF16A34A), warnung = Color(0xFFE3B341), fehler = Color(0xFFDC2626))
    CompositionLocalProvider(
        LocalIsBrickTheme provides isBrick,
        LocalChartColors  provides chartColors,
        LocalStatusFarben provides statusFarben,
    ) {
        MaterialTheme(
            colorScheme = colors,
            typography  = Typography(),
            content     = content
        )
    }
}
