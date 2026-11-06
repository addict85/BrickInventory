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
import ch.brickinventoryapp.ressourcen.R

// Ermöglicht Composables zu erkennen, ob das "Stein (Blau)"-Design aktiv ist,
// um strukturelle Stein-Elemente (Noppen-Deckel, Salbei-Badges …) nur dort zu zeigen.
val LocalIsBrickTheme = staticCompositionLocalOf { false }

// Dasselbe fuer den Farbfaecher: Nur dort tragen die Kacheln einen
// Themenstreifen. Ein eigener Merker statt eines Vergleichs auf den
// Design-Namen quer durch die Bildschirme — sonst muesste jede Stelle den
// Namen kennen.
val LocalIsFarbfaecherTheme = staticCompositionLocalOf { false }

/**
 * Traegt die Kachel im Design "noppe" einen Steindeckel?
 *
 * Wie [LocalIsFarbfaecherTheme]: Die Kachel selbst soll in allen Designs
 * dieselbe Auszeichnung behalten, und nur dieses Local entscheidet, ob der
 * Deckel dazukommt.
 */
val LocalIsNoppeTheme = staticCompositionLocalOf { false }

/**
 * Trägt die Oberfläche den Lack des Designs "hochglanz"? Getrennt von
 * [LocalIsNoppeTheme]: "hochglanz" ist "noppe" in anderem Material; die Kachel
 * fragt beides, ein Local mit drei Zuständen erzwänge überall eine Fallunterscheidung.
 */
val LocalIstGlanz = staticCompositionLocalOf { false }

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
    // BrandBlue50 trug primary nur mit 4,24:1; der hellere Ton hält 4,5:1.
    primaryContainer    = BrandBlueLight,
    onPrimaryContainer  = BrandBlueDark,
    secondary           = BrandBlueDark,
    onSecondary         = Color.White,
    secondaryContainer  = BrandBlueLight,
    onSecondaryContainer = BrandBlueDark,
    // BrandRed selbst trägt weisse Schrift nur mit 4,3:1.
    tertiary            = BrandRedDark,
    onTertiary          = Color.White,
    tertiaryContainer   = Color(0xFFFFDAD6),
    onTertiaryContainer = BrandRedDark,
    // --s100 der Webapp: Compose führt drei Ebenen (background, surface,
    // surfaceVariant), das Web zwei. Mit --s50 wären background und surfaceVariant
    // gleich, und Etiketten und Platzhalter darauf verschwänden.
    background          = Color(0xFFF1F5F9),  // --s100
    surface             = Color.White,
    surfaceVariant      = Color(0xFFF8FAFC),
    onSurface           = Color(0xFF1E293B),
    // --s600 statt --s500: Sekundärtext liegt auch auf den Containerstufen.
    onSurfaceVariant    = Color(0xFF475569),
    // outline umrandet Bedienelemente (Textfelder) und braucht 3:1 gegen jede
    // Fläche; der helle Ton taugt nur für Trennlinien.
    outline             = Color(0xFF748399),
    outlineVariant      = Color(0xFFE2E8F0),
    error               = Color(0xFFB91C1C),
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
    onSurfaceVariant    = Color(0xFF56616E),
    outline             = Color(0xFF768391),
    outlineVariant      = Color(0xFFCDD7E2),
    // Derselbe Ton wie die Statusfarbe „fehler“; #C0564E trug weisse Schrift nur mit 4,48:1.
    error               = Color(0xFFA34B3C),
)

// ── Diagrammfarben je Zustand ────────────────────────────────────────────────
/**
 * Farben der Verlaufslinien aus dem Design, wie --chart-new/--chart-used im Web. Im
 * Stein-Design Salbeigrün und Sand, dieselben Farben wie die Zustands-Plaketten,
 * als Vollton, weil die Container auf weissem Grund kaum zu sehen wären. Die
 * Vorgaben von [linie] und [raster] sind die klassischen Werte; [gedaempft] ist
 * Schrift (Achsen, Hinweise) und kommt deshalb aus [diagrammFarben].
 */
data class ChartColors(
    val new: Color,
    val used: Color,
    val linie: Color = Color(0xFF2563EB),
    val raster: Color = Color(0xFFE2E8F0),
    val gedaempft: Color = Color(0xFF56616E),
)

// Die vier Chart*-Farben stehen in DesignTokens.kt (erzeugt, siehe oben) —
// samt der Begruendung, warum die Gebraucht-Linie im Stein-Design Sand ist.

// Werkbank (dunkel): darkColorScheme, weil einige Bausteine (Textfeld-Rahmen,
// Rippel) ihre Helligkeit daran ablesen. Werte wie themes/werkbank.css; dieselbe
// Zuordnung nutzen die dunklen Fassungen der übrigen Designs (DunkelTokens.kt).
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
    outline              = Color(0xFF788292),
    outlineVariant       = Color(0xFF262D36),
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

// Noppe: weisse Flächen, Tintenkante; Werte aus DesignTokens.kt.
// `outline` ist die TINTE, weil in diesem Design der Rahmen trägt, nicht der Schatten.
// Rot steht in keiner Rolle, nur auf den Steindeckeln: In Wertkarte, „Neu“-Plakette
// und Knöpfen las es sich als Verlust oder Fehler. Blau führt, Gelb ist der Akzent.
private val NoppeBlau = Color(0xFF1A5FB8)
private val NoppeBlauHell = Color(0xFFE3EDFA)
private val NoppeGelbHell = Color(0xFFFFF3C4)
private val NoppeOcker = Color(0xFF7A5200)

private val NoppeColors = lightColorScheme(
    primary              = NoppeBlau,
    onPrimary            = Color.White,
    primaryContainer     = NoppeBlauHell,
    onPrimaryContainer   = NoppeTinte,
    secondary            = NoppeTinte,
    onSecondary          = Color.White,
    secondaryContainer   = Color(0xFFEEF1F6),
    onSecondaryContainer = NoppeTinte,
    tertiary             = NoppeOcker,
    onTertiary           = Color.White,
    tertiaryContainer    = NoppeGelbHell,
    onTertiaryContainer  = NoppeTinte,
    background           = Color(0xFFEEF1F6),
    surface              = Color.White,
    surfaceVariant       = Color(0xFFF7F9FC),
    onSurface            = NoppeTinte,
    onSurfaceVariant     = Color(0xFF5A6270),
    outline              = NoppeTinte,
    // Derselbe Wert, den ergaenzeRollen() vorher aus surface und onSurface mischte.
    outlineVariant       = Color(0xFFD7D8DA),
    error                = Color(0xFFB91C1C),
)

/**
 * Nunito, die Schrift des Designs "noppe": Die Systemschrift bleibt auch bei 900
 * kantig. Drei statische Schnitte statt des variablen, der FontVariation und damit
 * eine API-Stufe bräuchte; dieselben Formen wie public/vendor/fonts/ im Web.
 */
private val NunitoFamilie = FontFamily(
    Font(R.font.nunito_regular, FontWeight.Normal),
    Font(R.font.nunito_bold, FontWeight.Bold),
    Font(R.font.nunito_black, FontWeight.Black),
)

/**
 * Plus Jakarta Sans — die Schrift der Webapp (styles.css --font) für alle
 * Designs ausser "noppe". Statische Schnitte aus dem Variablen Schnitt der
 * Webapp, aus demselben Grund wie bei Nunito oben.
 */
private val JakartaFamilie = FontFamily(
    Font(R.font.plus_jakarta_sans_regular, FontWeight.Normal),
    Font(R.font.plus_jakarta_sans_medium, FontWeight.Medium),
    Font(R.font.plus_jakarta_sans_semibold, FontWeight.SemiBold),
    Font(R.font.plus_jakarta_sans_bold, FontWeight.Bold),
    Font(R.font.plus_jakarta_sans_extrabold, FontWeight.ExtraBold),
)

/**
 * Die Material-Skala mit einer anderen Familie. Nur die Familie wird
 * getauscht, keine Grösse und kein Gewicht — sonst verschöbe ein Designwechsel
 * die ganze Oberfläche, und AbstandsskalaTest hätte recht damit, das zu melden.
 */
private fun mitFamilie(f: FontFamily): Typography = Typography().let { t ->
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

/** Die Typografie des Designs "noppe": dieselbe Skala, andere Schrift. */
private val NoppeTypografie: Typography = mitFamilie(NunitoFamilie)
private val MarkenTypografie: Typography = mitFamilie(JakartaFamilie)

/**
 * Die Deckelfarbe einer Kachel im Design "noppe".
 *
 * Position modulo sechs, genau wie `.sc:nth-child(6n+…)` in themes/noppe.css.
 * Sie bedeutet NICHTS und gibt nur Takt — der ausdrueckliche Unterschied zu
 * [faecherTon] darunter, wo die Farbe das Thema IST.
 */
fun steinTon(position: Int): Color =
    SteinFarben[((position % SteinFarben.size) + SteinFarben.size) % SteinFarben.size]

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

/** Farben der Stein-Dekoration (Noppen, Schieferkachel) — hell oder dunkel, siehe dunkleSteinDekor(). */
data class SteinDekor(val noppen: Color, val schiefer: Color, val aufSchiefer: Color)

val LocalSteinDekor = staticCompositionLocalOf { SteinDekor(SlateBlueNoppe, SlateBlue, Color.White) }

/**
 * Die dunkle Fassung eines Designs aus den Tokens (DunkelTokens.kt). Dieselbe
 * Zuordnung wie WerkbankColors, nur mit den Markenfarben des Designs.
 */
private fun dunklesSchema(theme: String): ColorScheme = dunkleRollen(theme).let { r ->
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
 * Das vollständige Farbschema eines Designs, hell oder in seiner dunklen Fassung.
 * `when` statt geschachtelter Bedingungen: Ein weiteres Design kostet eine Zeile.
 */
internal fun farbschema(theme: String, dunkel: Boolean = false): ColorScheme =
    if (dunkel && hatDunkleFassung(theme)) ergaenzeRollen(dunklesSchema(theme).let {
        // Wie hell: Das Noppe-Rot ist im Dunkeln kaum von der Fehlerfarbe zu unterscheiden.
        // Hauptfarbe wird das Blau der Diagrammlinie, die Container nehmen die blauen Stufen
        // von classic, und der Akzent bleibt das Bernstein der Basis.
        if (theme == "noppe" || theme == "hochglanz") it.copy(primary = Color(0xFF6AA8FF),
            primaryContainer = Color(argb(dunkelToken("classic", "b50") ?: "#13233d")),
            onPrimaryContainer = Color(argb(dunkelToken("classic", "b700") ?: "#a9caff")))
        else it
    }, dunkel = true)
    else when (theme) {
        "brick" -> BrickBlueColors
        "werkbank" -> WerkbankColors
        "farbfaecher" -> FarbfaecherColors
        // "hochglanz" ist "noppe" in anderem Material, nicht in anderen Farben (`erbt`).
        "noppe", "hochglanz" -> NoppeColors
        else -> LightColors
    }.let { ergaenzeRollen(it, dunkel = theme == "werkbank") }

/**
 * Flächen mit eigener Farbe, die nicht aus einer Material-Rolle allein folgen:
 * App-Leiste, Leiste der Detailseiten und die Wert-Kacheln Marktwert und Kaufpreis.
 * Im Dunkeln stets Container-Rollen (Material 3): Die hellen Markentöne als Fläche
 * leuchteten auf Schwarz, und die Kaufpreis-Kachel stach den Marktwert aus.
 */
data class Akzentflaechen(
    val leiste: Color, val aufLeiste: Color,
    val detailLeiste: Color, val aufDetailLeiste: Color,
    val markt: Color, val aufMarkt: Color,
    val kauf: Color, val aufKauf: Color,
)

/**
 * Ein Akzent je Design: Nur „brick“ hell trägt farbige Leisten und die Petrol-Kachel
 * des Webs; sonst Leisten auf surface, der Marktwert in der Hauptfarbe und der
 * Kaufpreis neutral, damit der wichtigste Wert der Seite auch am stärksten wirkt
 * (primaryContainer lag in Fächer und Noppe so blass wie die neutrale Kachel).
 */
internal fun akzentflaechen(theme: String, dunkel: Boolean, s: ColorScheme): Akzentflaechen {
    val stein = theme == "brick" && !dunkel
    // Im Dunkeln liegt primaryContainer (--b50) kaum über surface; ein Viertel der
    // Hauptfarbe in surface gemischt ergibt einen mitteldunklen Ton wie Material 3s Stufe 30.
    val nacht = s.surface.luminance() < 0.2f
    val markt = when {
        stein -> Petrol
        nacht -> lerp(s.surface, s.primary, 0.28f)
        else -> s.primary
    }
    return Akzentflaechen(
        leiste = if (stein) s.primary else s.surface, aufLeiste = if (stein) s.onPrimary else s.onSurface,
        detailLeiste = if (stein) s.secondary else s.surface, aufDetailLeiste = if (stein) s.onSecondary else s.onSurface,
        markt = markt, aufMarkt = if (stein) Color.White else if (nacht) s.onSurface else s.onPrimary,
        // Kaufpreis wie G&V auf surface mit Rand: zwei Stufen (Marktwert hervorgehoben,
        // der Rest ruhig) statt dreier Kartenstile nebeneinander.
        kauf = s.surface, aufKauf = s.onSurface,
    )
}

val LocalAkzentflaechen = staticCompositionLocalOf { akzentflaechen("classic", false, LightColors) }

/**
 * Statusfarben je Design. `erfolg` färbt auch Gewinnzahlen und braucht als
 * Text 4,5:1 auf der Fläche.
 * Im Stein-Design gedeckter, damit es neben Salbeigrün und Sand nicht heraussticht.
 */
internal fun statusFarbenFuer(theme: String, dunkel: Boolean = false): StatusFarben = if (dunkel && hatDunkleFassung(theme)) {
    dunkleRollen(theme).let { StatusFarben(erfolg = Color(it.erfolg), warnung = Color(it.warnung), fehler = Color(it.error)) }
} else when (theme) {
    // Warnung zeichnet Balken und Symbole: 3:1 auf jeder hellen Fläche (WCAG 1.4.11).
    "brick" -> StatusFarben(erfolg = Color(0xFF4E7058), warnung = Color(0xFF8C6A28), fehler = Color(0xFFA34B3C))
    "werkbank" -> StatusFarben(erfolg = Color(0xFF6FBF7F), warnung = Color(0xFFD9A84E), fehler = Color(0xFFE07A72))
    else -> StatusFarben(erfolg = Color(0xFF166534), warnung = Color(0xFF9A6B00), fehler = Color(0xFFB91C1C))
}

/** Farben der Navigationsleiste und der Seitenleiste (MainScaffold). */
data class ReiterFarben(
    val leiste: Color, val anzeige: Color, val aufAnzeige: Color,
    val gewaehlt: Color, val ungewaehlt: Color,
)

/**
 * Die Anzeige des gewählten Ziels in voller Hauptfarbe: Material färbt sie mit
 * secondaryContainer, das sich von der Leiste kaum abhob (1,03:1). So trägt die
 * Fläche den Unterschied, nicht der Farbton des Symbols allein (WCAG 1.4.11).
 */
fun reiterFarben(s: ColorScheme) = ReiterFarben(
    leiste = s.surfaceContainer, anzeige = s.primary, aufAnzeige = s.onPrimary,
    gewaehlt = s.primary, ungewaehlt = s.onSurfaceVariant,
)

/**
 * Grundton der Ladekacheln (Skelett.kt), gemessen am Hintergrund statt an surface:
 * surfaceVariant und selbst surfaceContainerHighest lagen in den hellen Designs nur
 * 1,03–1,18:1 über background, die Kacheln waren kaum zu sehen.
 */
fun skelettTon(s: ColorScheme, anteil: Float = 0.12f): Color = lerp(s.background, s.onSurface, anteil)

/**
 * Belegt die Rollen, die die Paletten oben nicht nennen, aus deren eigenen Farben.
 *
 * Material3 füllt fehlende Rollen mit seiner lila Grundpalette. Dialoge, Menüs,
 * Snackbar, Schalter und Textfelder lesen genau diese Rollen und waren deshalb
 * in jedem Design violett getönt. Die Stufen liegen zwischen surface und
 * onSurface: im Hellen dunkler, im Dunklen heller — wie Material sie meint.
 */
internal fun ergaenzeRollen(s: ColorScheme, dunkel: Boolean): ColorScheme {
    fun stufe(anteil: Float) = lerp(s.surface, s.onSurface, anteil)
    // Dialoge und Menüs liegen auf den Containerstufen und tragen Text in primary,
    // error und onSurfaceVariant; die Stufen werden gestaucht, bis alle 4,5:1 halten.
    val schrift = listOf(s.primary, s.error, s.onSurfaceVariant)
    var mass = 1f
    while (mass > 0.3f && schrift.any { kontrast(it, stufe(STUFE_HOECHSTE * mass)) < TEXT_KONTRAST }) mass -= 0.05f
    fun container(anteil: Float) = stufe(anteil * mass)
    return s.copy(
        onBackground = s.onSurface,
        surfaceTint = s.primary,
        surfaceContainerLowest = if (dunkel) s.background else s.surface,
        surfaceContainerLow = container(0.025f),
        surfaceContainer = container(0.05f),
        surfaceContainerHigh = container(0.075f),
        surfaceContainerHighest = container(STUFE_HOECHSTE),
        surfaceDim = if (dunkel) s.background else stufe(0.08f),
        surfaceBright = if (dunkel) stufe(0.12f) else s.surface,
        inverseSurface = s.onSurface,
        inverseOnSurface = s.surface,
        // Die Snackbar-Aktion: so weit aufgehellt bzw. abgedunkelt, bis sie 4,5:1 erreicht.
        inversePrimary = mitKontrast(lerp(s.primary, if (dunkel) Color.Black else Color.White, 0.45f), s.onSurface),
        // Material setzt im Dunkeln #690005, auf den hellen Fehlertönen nur 4,48:1.
        onError = if (dunkel) s.background else Color.White,
        errorContainer = lerp(s.error, s.surface, 0.85f),
        onErrorContainer = lerp(s.error, s.onSurface, 0.5f),
    )
}

private const val STUFE_HOECHSTE = 0.10f
private const val TEXT_KONTRAST = 4.5f
private const val GRAFIK_KONTRAST = 3f

/** Kontrastverhältnis nach WCAG 2 (1 bis 21). */
fun kontrast(a: Color, b: Color): Float {
    val la = a.luminance(); val lb = b.luminance()
    return (maxOf(la, lb) + 0.05f) / (minOf(la, lb) + 0.05f)
}

/** [farbe], schrittweise von [gegen] weg gemischt, bis sie [ziel]:1 erreicht. */
fun mitKontrast(farbe: Color, gegen: Color, ziel: Float = TEXT_KONTRAST): Color {
    val weg = if (gegen.luminance() > 0.5f) Color.Black else Color.White
    var anteil = 0f
    var c = farbe
    while (kontrast(c, gegen) < ziel && anteil < 1f) { anteil += 0.05f; c = lerp(farbe, weg, anteil) }
    return c
}

/**
 * Diagrammfarben eines Designs zu seinem Farbschema [s]. Die Achsenschrift
 * ([ChartColors.gedaempft]) ist onSurfaceVariant: Das frühere Schiefergrau #94A3B8
 * erreichte auf Weiss nur 2,1:1, und Schrift muss 4,5:1 schaffen wie jede andere.
 */
internal fun diagrammFarben(theme: String, dunkel: Boolean, s: ColorScheme): ChartColors {
    val gedaempft = s.onSurfaceVariant
    return if (dunkel && hatDunkleFassung(theme)) dunkleRollen(theme).let {
        ChartColors(Color(it.chartNeu), Color(it.chartGebraucht), linie = Color(it.chartNeu),
            raster = Color(it.chartRaster), gedaempft = gedaempft)
    } else when (theme) {
        "brick" -> ChartColors(ChartNewBrick, ChartUsedBrick,
            linie = ChartNewBrick, raster = Color(0xFFE0DACE), gedaempft = gedaempft)
        // Auf dunklem Grund muss das Raster HELLER als der Grund sein, nicht
        // dunkler — sonst verschwindet es.
        "werkbank" -> ChartColors(ChartNewWerkbank, ChartUsedWerkbank,
            linie = ChartNewWerkbank, raster = Color(0xFF262D36), gedaempft = gedaempft)
        // Fächer und Noppe färben Themen bzw. Kacheln, NICHT Zustände: Neu bleibt
        // blau, Gebraucht bernstein/orange, damit sich die Farbsysteme nicht verwechseln.
        "farbfaecher" -> ChartColors(ChartNewFarbfaecher, ChartUsedFarbfaecher, gedaempft = gedaempft)
        // Das Orange des Webs (ChartUsedNoppe) erreicht auf Weiss nur 2,6:1; als Linie braucht es 3:1.
        "noppe", "hochglanz" -> ChartColors(ChartNewNoppe, ChartUsedNoppe.let { mitKontrast(it, s.surface, GRAFIK_KONTRAST) },
            raster = Color(0xFFE4E8EF), gedaempft = gedaempft)
        else -> ChartColors(ChartNewClassic, ChartUsedClassic, gedaempft = gedaempft)
    }
}

/**
 * [systemfarben]: Material You — Farben vom System, Formen und Schrift vom
 * Design. Die Diagramme nehmen dann die Rollen des Schemas, damit ihre Farben
 * zur Fläche passen; die Statusfarben bleiben, weil Gewinn grün bleiben muss.
 */
@Composable
fun BrickInventoryManagerTheme(
    theme: String = "classic", dunkel: Boolean = false, systemfarben: Boolean = false,
    content: @Composable () -> Unit,
) {
    val isBrick = theme == "brick"
    val kontext = androidx.compose.ui.platform.LocalContext.current
    val dynamisch = systemfarben && android.os.Build.VERSION.SDK_INT >= SYSTEMFARBEN_AB_SDK
    val colors = remember(theme, dunkel, dynamisch) {
        if (dynamisch) systemSchema(kontext, dunkel) else farbschema(theme, dunkel)
    }
    val chartColors = if (dynamisch) ChartColors(colors.primary, colors.tertiary, linie = colors.primary,
        raster = colors.outlineVariant, gedaempft = colors.onSurfaceVariant)
    else diagrammFarben(theme, dunkel, colors)
    // Dunkle Systemfarben unter einem Design ohne dunkle Fassung: die dunklen
    // Statusfarben von classic, sonst stünde Dunkelgrün auf dunklem Grund.
    val statusFarben = if (dynamisch && dunkel && !hatDunkleFassung(theme)) statusFarbenFuer("classic", true)
                       else statusFarbenFuer(theme, dunkel)
    val steinDekor = if (dunkel && isBrick) dunkleSteinDekor().let { SteinDekor(Color(it.noppen), Color(it.schiefer), Color(it.aufSchiefer)) }
                     else SteinDekor(SlateBlueNoppe, SlateBlue, Color.White)
    CompositionLocalProvider(
        LocalIsBrickTheme provides isBrick,
        LocalIsFarbfaecherTheme provides (theme == "farbfaecher"),
        LocalIsNoppeTheme provides (theme == "noppe" || theme == "hochglanz"),
        LocalIstGlanz provides (theme == "hochglanz"),
        LocalChartColors  provides chartColors,
        LocalStatusFarben provides statusFarben,
        LocalSteinDekor provides steinDekor,
        LocalAkzentflaechen provides akzentflaechen(theme, dunkel, colors),
    ) {
        MaterialTheme(
            colorScheme = colors,
            typography  = if (theme == "noppe" || theme == "hochglanz") NoppeTypografie else MarkenTypografie,
            content     = content
        )
    }
}

/** Nur ab Android 12 aufrufen ([SYSTEMFARBEN_AB_SDK]); das prüft der Aufrufer. */
@android.annotation.SuppressLint("NewApi")
private fun systemSchema(kontext: android.content.Context, dunkel: Boolean): ColorScheme =
    if (dunkel) dynamicDarkColorScheme(kontext) else dynamicLightColorScheme(kontext)
