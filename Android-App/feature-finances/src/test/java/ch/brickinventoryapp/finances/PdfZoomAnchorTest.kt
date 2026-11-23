package ch.brickinventoryapp.finances

import ch.brickinventoryapp.finances.ui.screens.PagesSituation
import ch.brickinventoryapp.finances.ui.screens.zoomTargetX
import ch.brickinventoryapp.finances.ui.screens.zoomTargetY
import org.junit.Test
import kotlin.math.abs
import kotlin.math.floor

/**
 * While zooming, the point between the fingers stays fixed.
 *
 * Computed on a model of the page list: pages of equal height, a fixed
 * margin and spacing, exactly as PdfPages lays them out. Before and after the step,
 * it is determined which spot of which page lies under the anchor.
 *
 * Counter-checks (measured 27.10. with kotlinc):
 *   A  zoomTargetY gets anchorY = 0 instead of the finger point (the old behavior:
 *      the top edge stays fixed) → red: "stays fixed", "gesture of small
 *      steps", "zooming out"
 *   B  zoomTargetX computes without the margin (rand = 0) → red: "horizontal"
 *   C  the backward search in zoomTargetY removed → red: "stays fixed",
 *      "gesture of small steps", "zooming out"
 */
class PdfZoomAnchorTest {

    private val edge = 16
    private val spacing = 16
    private val baseHeight = 1400f      // page height at 1x

    /** The list at zoom [z], first page [first] scrolled up by [offset]. */
    private inner class ListKind(val z: Float, val first: Int, val offset: Int) {
        val h get() = baseHeight * z
        val step get() = h + spacing

        fun visible(): List<PagesSituation> = (first until first + 6).map { i ->
            PagesSituation(i, (edge - offset + (i - first) * step).toInt(), h.toInt())
        }

        /** Page and fraction (0..1) under viewport height [y]. */
        fun place(y: Float): Pair<Int, Float> {
            val content = y + first * step + offset - edge
            val page = floor(content / step).toInt()
            return page to (content - page * step) / h
        }

        fun zoom(f: Float, y: Float): ListKind {
            val (i, v) = zoomTargetY(visible(), y, f, edge, spacing)!!
            return ListKind(z * f, i, v)
        }
    }

    private fun samePlace(before: Pair<Int, Float>, after: Pair<Int, Float>, h: Float, tolerancePx: Float) {
        assert(before.first == after.first && abs(before.second - after.second) * h <= tolerancePx) {
            "Under the fingers lay page ${before.first} at ${"%.3f".format(before.second)}, " +
                "afterwards page ${after.first} at ${"%.3f".format(after.second)}"
        }
    }

    @Test
    fun `the point between the fingers stays put`() {
        val before = ListKind(1f, 3, 200)
        for (y in listOf(300f, 1000f, 1700f)) {
            val after = before.zoom(1.25f, y)
            samePlace(before.place(y), after.place(y), after.h, 1.5f)
        }
    }

    @Test
    fun `a gesture of many small steps does not drift`() {
        // This is how a two-finger gesture arrives: one factor per frame. Every
        // rounding error would stay fixed and accumulate.
        val y = 1400f
        var list = ListKind(1f, 7, 500)
        val start = list.place(y)
        repeat(28) { list = list.zoom(1.05f, y) }
        assert(list.z > 3.8f) { "precondition: zoomed beyond 3.8x, was ${list.z}" }
        samePlace(start, list.place(y), list.h, 15f)
    }

    @Test
    fun `when zooming out the list starts with an earlier page`() {
        // Anchor just below the top edge: the page beneath moves down,
        // and the previous page has to come into view at the top.
        val before = ListKind(3f, 5, 100)
        val y = 400f
        val after = before.zoom(0.5f, y)
        assert(after.first < 5) { "the list still starts with page ${after.first}" }
        assert(after.offset >= 0) { "negative offset ${after.offset}" }
        samePlace(before.place(y), after.place(y), after.h, 1.5f)
    }

    @Test
    fun `at the start of the document the list stays at the top`() {
        val (i, v) = zoomTargetY(ListKind(2f, 0, 0).visible(), 1000f, 0.5f, edge, spacing)!!
        assert(i == 0 && v == 0) { "expected page 0 without offset, was $i/$v" }
        assert(zoomTargetY(emptyList(), 500f, 2f, edge, spacing) == null) { "without pages there is no destination" }
    }

    @Test
    fun `horizontally the point stays put, even from 1x`() {
        val width = 1048f                  // page width at 1x, without the margin
        var z = 1f
        var scroll = 0
        val x = 900f                        // right in view
        val share = { (scroll + x - edge) / (width * z) }
        val start = share()
        repeat(20) { scroll = zoomTargetX(scroll, x, edge.toFloat(), 1.08f); z *= 1.08f }
        assert(abs(share() - start) * width * z <= 12f) {
            "under the finger lay ${"%.3f".format(start)} of the page width, afterwards ${"%.3f".format(share())}"
        }
        assert(zoomTargetX(0, 500f, edge.toFloat(), 0.5f) == 0) { "zooming out scrolled left past the beginning" }
    }
}
