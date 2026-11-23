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
 * 2.3:1 for the text and 1.3:1 for the surface in the „`noppe`“ theme; here the text holds
 * 4.5:1 on its surface, and the surface resp. border 3:1 against surface and background.
 */
data class LockedColors(
    /** Surface of a filled or tonal button. */
    val surface: Color,
    /** Text and icon on [surface]. */
    val onSurface: Color,
    /** Text of a button without a surface (text and outlined buttons). */
    val font: Color,
    /** Rand eines umrandeten Knopfs. */
    val edge: Color,
)

fun lockedColors(s: ColorScheme): LockedColors {
    val reasons = listOf(s.surface, s.background)
    val surface = elevated(lerp(s.surface, s.onSurface, LOCKED_SURFACE), reasons, GRAPHIC_CONTRAST_LOCKED)
    val onSurface = there(surface, s.onSurface, surface, TEXT_CONTRAST_LOCKED)
    val font = elevated(lerp(s.surface, s.onSurface, LOCKED_FONT), reasons, TEXT_CONTRAST_LOCKED)
    val edge = elevated(lerp(s.surface, s.onSurface, LOCKED_SURFACE), reasons, GRAPHIC_CONTRAST_LOCKED)
    return LockedColors(surface, onSurface, font, edge)
}

/** Surface of a dialog: in light mode surface, so it clearly stands out from the darkened background. */
fun windowSurface(s: ColorScheme): Color = if (s.surface.luminance() > 0.5f) s.surface else s.surfaceContainerHigh

@Composable
fun windowSurface(): Color = windowSurface(MaterialTheme.colorScheme)

/** The filled main button with a readable lock state. */
@Composable
fun mainButtonColors(): ButtonColors {
    val g = lockedColors(MaterialTheme.colorScheme)
    return ButtonDefaults.buttonColors(disabledContainerColor = g.surface, disabledContentColor = g.onSurface)
}

/** The tonal button with a readable lock state. */
@Composable
fun toneButtonColors(): ButtonColors {
    val g = lockedColors(MaterialTheme.colorScheme)
    return ButtonDefaults.filledTonalButtonColors(disabledContainerColor = g.surface, disabledContentColor = g.onSurface)
}

/**
 * Blends step by step from [of] to [too] and, if that's not enough, further toward black resp.
 * white, until [against] reaches [target]:1.
 */
private fun there(of: Color, too: Color, against: Color, target: Float): Color {
    val end = if (too.luminance() < against.luminance()) Color.Black else Color.White
    var share = LOCKED_FONT
    var c = lerp(of, too, share)
    while (contrast(c, against) < target && share < 2f) {
        share += 0.05f
        c = if (share <= 1f) lerp(of, too, share) else lerp(too, end, (share - 1f).coerceAtMost(1f))
    }
    return c
}

/** Blends [color] away from the [reasons], until it holds [target]:1 against each. */
private fun elevated(color: Color, reasons: List<Color>, target: Float): Color =
    reasons.fold(color) { c, reason -> withContrast(c, reason, target) }

/** Share of onSurface in the locked surface and in the border, before raising it to 3:1. */
private const val LOCKED_SURFACE = 0.12f

/** Share of onSurface in locked text, before raising it to 4.5:1. */
private const val LOCKED_FONT = 0.5f

private const val TEXT_CONTRAST_LOCKED = 4.5f
private const val GRAPHIC_CONTRAST_LOCKED = 3f
