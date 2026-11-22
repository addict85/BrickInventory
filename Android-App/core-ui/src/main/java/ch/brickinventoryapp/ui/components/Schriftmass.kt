package ch.brickinventoryapp.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * From this text size onward, label and value stack instead of
 * sitting side by side: at 200%, „CHF 700.00“ next to „Kaufpreis“ wrapped digit by
 * digit. 1.3 is the first step Android offers beyond „Large“.
 */
const val LARGE_FONT_AB = 1.3f

/** Is the text size large enough that rows switch layout ([LARGE_FONT_AB])? */
@Composable
fun largeFont(): Boolean = LocalDensity.current.fontScale > LARGE_FONT_AB

/**
 * An icon next to text grows with it, at most to double size: a 14 dp pencil
 * next to 32 sp tall text was barely visible at 200%.
 */
@Composable
fun withFont(basis: Dp): Dp = basis * LocalDensity.current.fontScale.coerceIn(1f, 2f)

/** From this grid width onward, a window counts as wide (tablet, landscape). */
private val WIDE_RASTER = 840.dp

/**
 * Grid columns with [mindestens] as a tile's minimum width, grown with the
 * text size (at most doubled) and, on wide windows, by half: at 200% a
 * 110 dp tile truncated every name, and on the tablet small tiles sat in a corner.
 */
data class ReadableColumns(val mindestens: Dp) : GridCells {
    override fun Density.calculateCrossAxisCellSizes(availableSize: Int, spacing: Int): List<Int> {
        val breit = availableSize.toDp() >= WIDE_RASTER
        val breite = mindestens * fontScale.coerceIn(1f, 2f) * (if (breit) 1.5f else 1f)
        return with(GridCells.Adaptive(breite)) { calculateCrossAxisCellSizes(availableSize, spacing) }
    }

    /** How many columns the grid sets for [verfuegbar]; the same calculation as during layout. */
    fun Density.anzahl(verfuegbar: Dp, abstand: Dp): Int =
        calculateCrossAxisCellSizes(verfuegbar.roundToPx(), abstand.roundToPx()).size
}
