package ch.brickinventoryapp.ui.theme

import androidx.compose.material3.ButtonColors
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.luminance

/**
 * Farben gesperrter Knöpfe. Materials feste Deckkraft (12 % Fläche, 38 % Schrift) ergab
 * im Design „noppe“ 2,3:1 für die Schrift und 1,3:1 für die Fläche; hier hält die Schrift
 * 4,5:1 auf ihrer Fläche und die Fläche bzw. der Rand 3:1 auf surface und background.
 */
data class GesperrtFarben(
    /** Fläche eines vollen oder tonalen Knopfs. */
    val flaeche: Color,
    /** Schrift und Symbol auf [flaeche]. */
    val aufFlaeche: Color,
    /** Schrift eines Knopfs ohne Fläche (Text- und umrandeter Knopf). */
    val schrift: Color,
    /** Rand eines umrandeten Knopfs. */
    val rand: Color,
)

fun gesperrtFarben(s: ColorScheme): GesperrtFarben {
    val gruende = listOf(s.surface, s.background)
    val flaeche = abgehoben(lerp(s.surface, s.onSurface, GESPERRT_FLAECHE), gruende, GRAFIK_KONTRAST_GESPERRT)
    val aufFlaeche = hin(flaeche, s.onSurface, flaeche, TEXT_KONTRAST_GESPERRT)
    val schrift = abgehoben(lerp(s.surface, s.onSurface, GESPERRT_SCHRIFT), gruende, TEXT_KONTRAST_GESPERRT)
    val rand = abgehoben(lerp(s.surface, s.onSurface, GESPERRT_FLAECHE), gruende, GRAFIK_KONTRAST_GESPERRT)
    return GesperrtFarben(flaeche, aufFlaeche, schrift, rand)
}

/** Fläche eines Dialogs: im Hellen surface, damit er sich vom abgedunkelten Grund klar abhebt. */
fun fensterFlaeche(s: ColorScheme): Color = if (s.surface.luminance() > 0.5f) s.surface else s.surfaceContainerHigh

@Composable
fun fensterFlaeche(): Color = fensterFlaeche(MaterialTheme.colorScheme)

/** Der volle Hauptknopf mit lesbarer Sperre. */
@Composable
fun hauptKnopfFarben(): ButtonColors {
    val g = gesperrtFarben(MaterialTheme.colorScheme)
    return ButtonDefaults.buttonColors(disabledContainerColor = g.flaeche, disabledContentColor = g.aufFlaeche)
}

/** Der tonale Knopf mit lesbarer Sperre. */
@Composable
fun tonKnopfFarben(): ButtonColors {
    val g = gesperrtFarben(MaterialTheme.colorScheme)
    return ButtonDefaults.filledTonalButtonColors(disabledContainerColor = g.flaeche, disabledContentColor = g.aufFlaeche)
}

/**
 * Mischt von [von] schrittweise zu [zu] und, reicht das nicht, weiter zu Schwarz bzw.
 * Weiss, bis [gegen] [ziel]:1 erreicht ist.
 */
private fun hin(von: Color, zu: Color, gegen: Color, ziel: Float): Color {
    val ende = if (zu.luminance() < gegen.luminance()) Color.Black else Color.White
    var anteil = GESPERRT_SCHRIFT
    var c = lerp(von, zu, anteil)
    while (kontrast(c, gegen) < ziel && anteil < 2f) {
        anteil += 0.05f
        c = if (anteil <= 1f) lerp(von, zu, anteil) else lerp(zu, ende, (anteil - 1f).coerceAtMost(1f))
    }
    return c
}

/** Mischt [farbe] von den [gruende]n weg, bis sie gegen jeden [ziel]:1 hält. */
private fun abgehoben(farbe: Color, gruende: List<Color>, ziel: Float): Color =
    gruende.fold(farbe) { c, grund -> mitKontrast(c, grund, ziel) }

/** Anteil von onSurface in der gesperrten Fläche und im Rand, vor dem Anheben auf 3:1. */
private const val GESPERRT_FLAECHE = 0.12f

/** Anteil von onSurface in gesperrter Schrift, vor dem Anheben auf 4,5:1. */
private const val GESPERRT_SCHRIFT = 0.5f

private const val TEXT_KONTRAST_GESPERRT = 4.5f
private const val GRAFIK_KONTRAST_GESPERRT = 3f
