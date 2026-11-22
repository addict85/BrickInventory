package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.layout.Box
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.PlainTooltip
import androidx.compose.material3.Text
import androidx.compose.material3.TooltipBox
import androidx.compose.material3.rememberTooltipState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.PopupPositionProvider

/**
 * Every plain icon button shows its name on a long press: TalkBack reads out the
 * description, whoever can see only had the icon — filter and sort are
 * both lines. [text] is the same description as on the icon. The outer frame
 * takes [modifier] (e.g. `align`), because TooltipBox doesn't pass it on to its parent.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WithTooltip(text: String, modifier: Modifier = Modifier, button: @Composable () -> Unit) {
    val spacing = with(LocalDensity.current) { TOOLTIP_GAP.roundToPx() }
    val situation = remember(spacing) { ViaTheButton(spacing) }
    Box(modifier) {
        TooltipBox(
            positionProvider = situation,
            tooltip = { PlainTooltip { Text(text) } },
            state = rememberTooltipState(),
            content = button,
        )
    }
}

/** Gap between button and tooltip, as Material intends it. */
private val TOOLTIP_GAP = 4.dp

/**
 * Centered above the button, below it if there's no room above, and never past the window edge.
 * A custom implementation instead of TooltipDefaults: its positioning functions change
 * their names between Material versions, and a deprecation warning would break the warning threshold.
 */
private class ViaTheButton(private val spacing: Int) : PopupPositionProvider {
    override fun calculatePosition(
        anchorBounds: IntRect,
        windowSize: IntSize,
        layoutDirection: LayoutDirection,
        popupContentSize: IntSize,
    ): IntOffset {
        val x = (anchorBounds.left + (anchorBounds.width - popupContentSize.width) / 2)
            .coerceIn(0, maxOf(0, windowSize.width - popupContentSize.width))
        val top = anchorBounds.top - popupContentSize.height - spacing
        val y = if (top >= 0) top else anchorBounds.bottom + spacing
        return IntOffset(x, y)
    }
}
