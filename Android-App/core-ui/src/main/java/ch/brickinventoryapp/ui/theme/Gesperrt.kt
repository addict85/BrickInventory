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
 * Colors of locked buttons. Material's fixed opacity (12% surface, 38% text) produced
 * 2.3:1 for the text and 1.3:1 for the surface in the „noppe“ theme; here the text holds
 * 4.5:1 on its surface, and the surface resp. border 3:1 against surface and background.
 */
data class LockedColors(
    /** Surface of a filled or tonal button. */
    val flaeche: Color,
    /** Text and icon on [flaeche]. */
    val aufFlaeche: Color,
    /** Text of a button without a surface (text and outlined buttons). */
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

/** Surface of a dialog: in light mode surface, so it clearly stands out from the darkened background. */
fun fensterFlaeche(s: ColorScheme): Color = if (s.surface.luminance() > 0.5f) s.surface else s.surfaceContainerHigh

@Composable
fun fensterFlaeche(): Color = fensterFlaeche(MaterialTheme.colorScheme)

/** The filled main button with a readable lock state. */
@Composable
fun mainButtonColors(): ButtonColors {
    val g = lockedColors(MaterialTheme.colorScheme)
    return ButtonDefaults.buttonColors(disabledContainerColor = g.flaeche, disabledContentColor = g.aufFlaeche)
}

/** The tonal button with a readable lock state. */
@Composable
fun toneButtonColors(): ButtonColors {
    val g = lockedColors(MaterialTheme.colorScheme)
    return ButtonDefaults.filledTonalButtonColors(disabledContainerColor = g.flaeche, disabledContentColor = g.aufFlaeche)
}

/**
 * Blends step by step from [von] to [zu] and, if that's not enough, further toward black resp.
 * white, until [gegen] reaches [ziel]:1.
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

/** Blends [farbe] away from the [reasons], until it holds [ziel]:1 against each. */
private fun elevated(farbe: Color, reasons: List<Color>, ziel: Float): Color =
    reasons.fold(farbe) { c, grund -> withContrast(c, grund, ziel) }

/** Share of onSurface in the locked surface and in the border, before raising it to 3:1. */
private const val LOCKED_SURFACE = 0.12f

/** Share of onSurface in locked text, before raising it to 4.5:1. */
private const val LOCKED_FONT = 0.5f

private const val TEXT_CONTRAST_LOCKED = 4.5f
private const val GRAPHIC_CONTRAST_LOCKED = 3f
