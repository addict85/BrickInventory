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
const val LARGE_FONT_SCALE_MIN = 1.3f

/** Is the text size large enough that rows switch layout ([LARGE_FONT_SCALE_MIN])? */
@Composable
fun largeFont(): Boolean = LocalDensity.current.fontScale > LARGE_FONT_SCALE_MIN

/**
 * An icon next to text grows with it, at most to double size: a 14 dp pencil
 * next to 32 sp tall text was barely visible at 200%.
 */
@Composable
fun withFont(basis: Dp): Dp = basis * LocalDensity.current.fontScale.coerceIn(1f, 2f)

/** From this grid width onward, a window counts as wide (tablet, landscape). */
private val WIDE_RASTER = 840.dp

/**
 * Grid columns with [atLeast] as a tile's minimum width, grown with the
 * text size (at most doubled) and, on wide windows, by half: at 200% a
 * 110 dp tile truncated every name, and on the tablet small tiles sat in a corner.
 */
data class ReadableColumns(val atLeast: Dp) : GridCells {
    override fun Density.calculateCrossAxisCellSizes(availableSize: Int, spacing: Int): List<Int> {
        val wide = availableSize.toDp() >= WIDE_RASTER
        val width = atLeast * fontScale.coerceIn(1f, 2f) * (if (wide) 1.5f else 1f)
        return with(GridCells.Adaptive(width)) { calculateCrossAxisCellSizes(availableSize, spacing) }
    }

    /** How many columns the grid sets for [available]; the same calculation as during layout. */
    fun Density.count(available: Dp, spacing: Dp): Int =
        calculateCrossAxisCellSizes(available.roundToPx(), spacing.roundToPx()).size
}
