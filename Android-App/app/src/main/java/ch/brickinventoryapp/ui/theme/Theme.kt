package ch.brickinventoryapp.ui.theme

import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

// Ermöglicht Composables zu erkennen, ob das "Stein (Blau)"-Design aktiv ist,
// um strukturelle Stein-Elemente (Noppen-Deckel, Salbei-Badges …) nur dort zu zeigen.
val LocalIsBrickTheme = staticCompositionLocalOf { false }

// Dasselbe fuer den Farbfaecher: Nur dort tragen die Kacheln einen
// Themenstreifen. Ein eigener Merker statt eines Vergleichs auf den
// Design-Namen quer durch die Bildschirme — sonst muesste jede Stelle den
// Namen kennen.
val LocalIsFarbfaecherTheme = staticCompositionLocalOf { false }

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

// ── Werkbank (dunkel) ───────────────────────────────────────────────────────
//
// Das erste DUNKLE Design der App. Material3 unterscheidet dafuer
// darkColorScheme() von lightColorScheme(): Beide belegen dieselben Rollen,
// aber die Vorgaben fuer alles, was hier nicht gesetzt ist, unterscheiden sich
// — und ausserdem melden manche Compose-Bausteine (Textfeld-Rahmen, Rippel)
// ihre Helligkeit daran. Mit lightColorScheme und dunklen Werten saehe das
// meiste richtig aus und ein paar Stellen falsch.
//
// Die Werte spiegeln themes/werkbank.css; die Markenfarben kommen aus
// DesignTokens.kt (erzeugt aus shared/design-tokens.json).
private val WerkbankColors = darkColorScheme(
    primary              = WerkbankAzur,
    onPrimary            = Color(0xFF0E1620),
    primaryContainer     = WerkbankAzurDunkel,
    onPrimaryContainer   = WerkbankAzurHell,
    secondary            = WerkbankAzurHell,
    onSecondary          = Color(0xFF0E1620),
    secondaryContainer   = Color(0xFF2A2418),
    onSecondaryContainer = Color(0xFFD9A84E),
    tertiary             = Color(0xFFD9A84E),
    onTertiary           = Color(0xFF241C0C),
    tertiaryContainer    = Color(0xFF2A2418),
    onTertiaryContainer  = Color(0xFFD9A84E),
    background           = Color(0xFF14181D),
    surface              = Color(0xFF191E25),
    // Muss sich von surface unterscheiden — dieselbe Ueberlegung wie im
    // Grunddesign: Flaechen, die mit surfaceVariant AUF surface liegen,
    // verschwaenden sonst.
    surfaceVariant       = Color(0xFF232A33),
    onSurface            = Color(0xFFE6E9ED),
    onSurfaceVariant     = Color(0xFF8D96A3),
    outline              = Color(0xFF262D36),
    error                = Color(0xFFE07A72),
)

// ── Farbfaecher ─────────────────────────────────────────────────────────────
//
// Graue Bedienung: Die Markenfarbe ist hier fast schwarz, damit die
// Themenfarben (FaecherFarben in DesignTokens.kt) die einzigen bunten
// Flaechen sind und deshalb etwas bedeuten.
private val FarbfaecherColors = lightColorScheme(
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
    background           = Color(0xFFFAFAFA),
    surface              = Color.White,
    surfaceVariant       = Color(0xFFF4F4F4),
    onSurface            = Color(0xFF2B2B2B),
    onSurfaceVariant     = Color(0xFF8A8A8A),
    outline              = Color(0xFFE6E6E6),
    error                = Color(0xFFDC2626),
)

/**
 * Der Ton eines LEGO-Themas im Design "farbfaecher".
 *
 * Thema-Nummer modulo zwoelf, genau wie `--faecher-ton` in der Webapp. Ohne
 * Nummer gibt es keinen Ton — dann bleibt der Streifen weg, statt einen
 * falschen zu zeigen (dieselbe Regel wie applyTheme(): keine Information
 * aendert nichts).
 */
fun faecherTon(themaNummer: Int?): Color? =
    themaNummer?.let { FaecherFarben[((it % FaecherFarben.size) + FaecherFarben.size) % FaecherFarben.size] }

val LocalChartColors = staticCompositionLocalOf {
    ChartColors(new = ChartNewClassic, used = ChartUsedClassic)
}

@Composable
fun BrickInventoryManagerTheme(theme: String = "classic", content: @Composable () -> Unit) {
    val isBrick = theme == "brick"
    // Vier Designs, eine Stelle. `when` statt geschachtelter Bedingungen: Ein
    // fuenftes Design soll hier eine Zeile kosten, keine Umstrukturierung.
    val colors = when (theme) {
        "brick" -> BrickBlueColors
        "werkbank" -> WerkbankColors
        "farbfaecher" -> FarbfaecherColors
        else -> LightColors
    }
    val chartColors = when (theme) {
        "brick" -> ChartColors(ChartNewBrick, ChartUsedBrick,
            linie = ChartNewBrick, raster = Color(0xFFE0DACE), gedaempft = Color(0xFF8C8577))
        // Auf dunklem Grund muss das Raster HELLER als der Grund sein, nicht
        // dunkler — sonst verschwindet es.
        "werkbank" -> ChartColors(ChartNewWerkbank, ChartUsedWerkbank,
            linie = ChartNewWerkbank, raster = Color(0xFF262D36), gedaempft = Color(0xFF6F7986))
        // Der Faecher faerbt Themen, NICHT Zustaende: Neu bleibt blau,
        // Gebraucht bernstein. Zwei Farbsysteme nebeneinander duerfen sich
        // nicht verwechseln lassen.
        "farbfaecher" -> ChartColors(ChartNewFarbfaecher, ChartUsedFarbfaecher)
        else -> ChartColors(ChartNewClassic, ChartUsedClassic)
    }
    // Statusfarben je Design (Nachtrag 120). Im Stein-Design gedeckter, damit
    // sie neben Salbeigrün und Sand nicht herausstechen — vorher standen zwölf
    // feste Farben im Quelltext verteilt und zogen beim Designwechsel nicht mit.
    val statusFarben = when (theme) {
        "brick" -> StatusFarben(erfolg = Color(0xFF5F8468), warnung = Color(0xFFB08A3E), fehler = Color(0xFFA34B3C))
        "werkbank" -> StatusFarben(erfolg = Color(0xFF6FBF7F), warnung = Color(0xFFD9A84E), fehler = Color(0xFFE07A72))
        else -> StatusFarben(erfolg = Color(0xFF16A34A), warnung = Color(0xFFE3B341), fehler = Color(0xFFDC2626))
    }
    CompositionLocalProvider(
        LocalIsBrickTheme provides isBrick,
        LocalIsFarbfaecherTheme provides (theme == "farbfaecher"),
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
