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
 * Jeder reine Symbolknopf zeigt beim langen Drücken seinen Namen: TalkBack liest die
 * Beschreibung vor, wer sieht, hatte nur das Symbol — Filter und Sortieren sind
 * beide Linien. [text] ist dieselbe Beschreibung wie am Symbol. Der äussere Rahmen
 * nimmt [modifier] (etwa `align`), weil TooltipBox ihn nicht an ihre Eltern weitergibt.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MitTooltip(text: String, modifier: Modifier = Modifier, knopf: @Composable () -> Unit) {
    val abstand = with(LocalDensity.current) { TOOLTIP_ABSTAND.roundToPx() }
    val lage = remember(abstand) { UeberDemKnopf(abstand) }
    Box(modifier) {
        TooltipBox(
            positionProvider = lage,
            tooltip = { PlainTooltip { Text(text) } },
            state = rememberTooltipState(),
            content = knopf,
        )
    }
}

/** Abstand zwischen Knopf und Tooltip, wie Material ihn vorsieht. */
private val TOOLTIP_ABSTAND = 4.dp

/**
 * Mittig über dem Knopf, unter ihm, wenn oben kein Platz ist, und nie über den Fensterrand.
 * Eigene Fassung statt TooltipDefaults: Deren Lage-Funktionen wechseln zwischen den
 * Material-Fassungen ihren Namen, und eine Veraltet-Warnung bräche die Warnungsgrenze.
 */
private class UeberDemKnopf(private val abstand: Int) : PopupPositionProvider {
    override fun calculatePosition(
        anchorBounds: IntRect,
        windowSize: IntSize,
        layoutDirection: LayoutDirection,
        popupContentSize: IntSize,
    ): IntOffset {
        val x = (anchorBounds.left + (anchorBounds.width - popupContentSize.width) / 2)
            .coerceIn(0, maxOf(0, windowSize.width - popupContentSize.width))
        val oben = anchorBounds.top - popupContentSize.height - abstand
        val y = if (oben >= 0) oben else anchorBounds.bottom + abstand
        return IntOffset(x, y)
    }
}
