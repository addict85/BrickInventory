package ch.brickinventoryapp.finances

import ch.brickinventoryapp.finances.ui.pdf.PDF_BITMAP_MAX_PX
import ch.brickinventoryapp.finances.ui.pdf.bitmapDimensions
import ch.brickinventoryapp.finances.ui.screens.renderLevel
import org.junit.Test

/**
 * The PDF viewer's render arithmetic: [renderLevel] and [bitmapDimensions] run without a device.
 * The area limit with the square root is where a sign or root error would not stand out — the
 * page looks right, only memory fills up or the image stays coarse. The gestures and the
 * re-render on a zoom step are run in PdfGestureTest.
 */
class PdfZoomTest {

    private val A4 = 1.4142f      // height / width of an A4 page

    @Test
    fun `without zoom it renders at single width, with zoom higher`() {
        // Level 1 applies ONLY at exactly 1x. That is intentional: as long as there is no
        // zoom, the viewer should use as much memory as before; once
        // zoomed, sharpness matters more.
        assert(renderLevel(1f) == 1) { "1x must be level 1, was ${renderLevel(1f)}" }
        assert(renderLevel(1.25f) == 2) { "1.25x must be level 2, was ${renderLevel(1.25f)}" }
        assert(renderLevel(2f) == 2) { "2x must be level 2, was ${renderLevel(2f)}" }
        assert(renderLevel(2.5f) == 3) { "2.5x must be level 3, was ${renderLevel(2.5f)}" }
        assert(renderLevel(5f) == 3) { "5x must be level 3, was ${renderLevel(5f)}" }
    }

    @Test
    fun `the level stays at three no matter how far it is zoomed`() {
        // The upper limit of the zoom is 5x; raising it later must not drag the
        // render resolution along with it. Hence checked up to 100.
        var z = 1f
        while (z <= 100f) {
            val level = renderLevel(z)
            assert(level in 1..3) { "level $level at zoom $z lies outside 1..3" }
            z += 0.37f
        }
        // And the opposite direction: a nonsensical value must not fall below 1,
        // otherwise the bitmap would be 0 pixels wide.
        assert(renderLevel(0f) == 1) { "zoom 0 must give level 1" }
        assert(renderLevel(-3f) == 1) { "a negative zoom must give level 1" }
    }

    @Test
    fun `below the limit the desired width stays untouched`() {
        val (w, h) = bitmapDimensions(1080, A4)
        assert(w == 1080) { "1080 px lie far below the limit, $w was delivered" }
        assert(h == (1080 * A4).toInt()) { "height $h does not match 1080 x $A4" }
        // Counter-check for the limit itself: this case must not touch it,
        // otherwise it says nothing about the unbounded path.
        assert(w.toLong() * h < PDF_BITMAP_MAX_PX) {
            "The case already lies at the limit (${w.toLong() * h}) — then it does not check " +
                "the unlimited way."
        }
    }

    @Test
    fun `above the limit it is capped, in both directions`() {
        // 3240 px is level 3 of a 1080-px device — the case that
        // actually occurs in practice.
        val desired = 3240
        val (w, h) = bitmapDimensions(desired, A4)

        assert(w < desired) {
            "$desired px at A4 are ${desired.toLong() * (desired * A4).toInt()} " +
                "pixels and so lie above the limit of $PDF_BITMAP_MAX_PX — it should have " +
                "been capped, but the full $w was delivered."
        }
        assert(w.toLong() * h <= PDF_BITMAP_MAX_PX) {
            "After capping there are still ${w.toLong() * h} pixels, allowed are " +
                "$PDF_BITMAP_MAX_PX. Then the bolt does not hold."
        }
        // The aspect ratio must be preserved. Capping only the width would be the
        // obvious mistake — the page would then be squashed, and by so
        // little that one might take it for the instruction manual itself.
        val ratio = h.toFloat() / w.toFloat()
        assert(kotlin.math.abs(ratio - A4) < 0.01f) {
            "aspect ratio after capping $ratio instead of $A4 — the page would be distorted."
        }
    }

    @Test
    fun `the bolt holds for portrait and landscape and for nonsensical input`() {
        for (ratio in listOf(0.5f, 0.707f, 1f, 1.4142f, 2f, 3f)) {
            for (width in listOf(1, 320, 1080, 2160, 3240, 8000, 40000)) {
                val (w, h) = bitmapDimensions(width, ratio)
                assert(w >= 1 && h >= 1) { "dimensions $w x $h at ($width, $ratio) — 0 is no bitmap" }
                assert(w.toLong() * h <= PDF_BITMAP_MAX_PX) {
                    "($width, $ratio) gives ${w.toLong() * h} pixels, allowed are $PDF_BITMAP_MAX_PX"
                }
                assert(w <= width.coerceAtLeast(1)) {
                    "($width, $ratio) gives $w — it never renders wider than wanted"
                }
            }
        }
        // A width of 0 or less must not yield an empty bitmap.
        for (b in listOf(0, -1, -5000)) {
            val (w, h) = bitmapDimensions(b, A4)
            assert(w >= 1 && h >= 1) { "width $b gave $w x $h" }
        }
    }
}
