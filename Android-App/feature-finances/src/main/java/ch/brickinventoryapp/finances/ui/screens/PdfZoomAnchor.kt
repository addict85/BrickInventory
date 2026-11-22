package ch.brickinventoryapp.finances.ui.screens

import kotlin.math.roundToInt

// The calculation by which a zoom step holds fixed the point between the fingers.
// Without Compose, so that it can be checked without a device;
// PdfPages feeds it the layout from the last measurement.

/** A visible page: top edge in the viewport and height, in pixels. */
internal data class PagesSituation(val index: Int, val top: Int, val height: Int)

/**
 * Where the list scrolls to after a zoom by factor [f], so that the point stays at
 * height [anchorY] of the viewport. The pages grow with the
 * factor, margin and spacing do not.
 * @return first page and offset for scrollToItem; null without a visible page
 */
internal fun zoomTargetY(
    pages: List<PagesSituation>, anchorY: Float, f: Float, edgeTop: Int, spacing: Int,
): Pair<Int, Int>? {
    val below = pages.lastOrNull { it.top <= anchorY } ?: pages.firstOrNull() ?: return null
    val d = anchorY - below.top
    val dNew = when {
        d < 0f -> d
        d <= below.height -> d * f
        else -> below.height * f + (d - below.height)
    }
    // If the page lies below the top edge after the step, the
    // list starts with an earlier one; the measurement usually already knows its height.
    val heights = pages.associate { it.index to it.height }
    var index = below.index
    var offset = edgeTop - anchorY + dNew
    while (offset < 0f && index > 0) {
        index--
        offset += (heights[index] ?: below.height) * f + spacing
    }
    return index to offset.roundToInt().coerceAtLeast(0)
}

/**
 * The horizontal scroll position at which the point [anchorX] of the viewport
 * stays put. [edge] is the fixed margin to the left of the pages.
 */
internal fun zoomTargetX(scroll: Int, anchorX: Float, edge: Float, f: Float): Int =
    (edge + (scroll + anchorX - edge) * f - anchorX).roundToInt().coerceAtLeast(0)
