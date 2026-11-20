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
data class LockedColors(
    /** Fläche eines vollen oder tonalen Knopfs. */
    val flaeche: Color,
    /** Schrift und Symbol auf [flaeche]. */
    val aufFlaeche: Color,
    /** Schrift eines Knopfs ohne Fläche (Text- und umrandeter Knopf). */
    val schrift: Color,
    /** Rand eines umrandeten Knopfs. */
    val edge: Color,
)

fun lockedColors(s: ColorScheme): LockedColors {
    val reasons = listOf(s.surface, s.background)
    val flaeche = elevated(lerp(s.surface, s.onSurface, LOCKED_SURFACE), reasons, GRAPHIC_CONTRAST_LOCKED)
    val aufFlaeche = hin(flaeche, s.onSurface, flaeche, TEXT_CONTRAST_LOCKED)
    val schrift = elevated(lerp(s.surface, s.onSurface, LOCKED_FONT), reasons, TEXT_CONTRAST_LOCKED)
    val edge = elevated(lerp(s.surface, s.onSurface, LOCKED_SURFACE), reasons, GRAPHIC_CONTRAST_LOCKED)
    return LockedColors(flaeche, aufFlaeche, schrift, edge)
}

/** Fläche eines Dialogs: im Hellen surface, damit er sich vom abgedunkelten Grund klar abhebt. */
fun fensterFlaeche(s: ColorScheme): Color = if (s.surface.luminance() > 0.5f) s.surface else s.surfaceContainerHigh

@Composable
fun fensterFlaeche(): Color = fensterFlaeche(MaterialTheme.colorScheme)

/** Der volle Hauptknopf mit lesbarer Sperre. */
@Composable
fun mainButtonColors(): ButtonColors {
    val g = lockedColors(MaterialTheme.colorScheme)
    return ButtonDefaults.buttonColors(disabledContainerColor = g.flaeche, disabledContentColor = g.aufFlaeche)
}

/** Der tonale Knopf mit lesbarer Sperre. */
@Composable
fun toneButtonColors(): ButtonColors {
    val g = lockedColors(MaterialTheme.colorScheme)
    return ButtonDefaults.filledTonalButtonColors(disabledContainerColor = g.flaeche, disabledContentColor = g.aufFlaeche)
}

/**
 * Mischt von [von] schrittweise zu [zu] und, reicht das nicht, weiter zu Schwarz bzw.
 * Weiss, bis [gegen] [ziel]:1 erreicht ist.
 */
private fun hin(von: Color, zu: Color, gegen: Color, ziel: Float): Color {
    val ende = if (zu.luminance() < gegen.luminance()) Color.Black else Color.White
    var share = LOCKED_FONT
    var c = lerp(von, zu, share)
    while (contrast(c, gegen) < ziel && share < 2f) {
        share += 0.05f
        c = if (share <= 1f) lerp(von, zu, share) else lerp(zu, ende, (share - 1f).coerceAtMost(1f))
    }
    return c
}

/** Mischt [farbe] von den [reasons]n weg, bis sie gegen jeden [ziel]:1 hält. */
private fun elevated(farbe: Color, reasons: List<Color>, ziel: Float): Color =
    reasons.fold(farbe) { c, grund -> withContrast(c, grund, ziel) }

/** Anteil von onSurface in der gesperrten Fläche und im Rand, vor dem Anheben auf 3:1. */
private const val LOCKED_SURFACE = 0.12f

/** Anteil von onSurface in gesperrter Schrift, vor dem Anheben auf 4,5:1. */
private const val LOCKED_FONT = 0.5f

private const val TEXT_CONTRAST_LOCKED = 4.5f
private const val GRAPHIC_CONTRAST_LOCKED = 3f
