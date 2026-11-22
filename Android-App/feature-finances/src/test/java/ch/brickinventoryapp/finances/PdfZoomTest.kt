package ch.brickinventoryapp.finances

import ch.brickinventoryapp.finances.ui.pdf.PDF_BITMAP_MAX_PX
import ch.brickinventoryapp.finances.ui.pdf.bitmapDimensions
import ch.brickinventoryapp.finances.ui.screens.renderLevel
import ch.brickinventoryapp.testing.Sources
import org.junit.Test

/**
 * The PDF viewer can zoom — and stays sharp while doing so, without blowing
 * up memory.
 *
 * ── What is checked here, and what is NOT ───────────────────────────────────
 *
 * COMPUTED is the calculation: [renderLevel] and [bitmapDimensions] were pulled out of
 * PdfViewerScreen for exactly this reason, so that they run without a device. The
 * area limit with the square root is the spot where a sign or
 * root error would not stand out: the display looks correct, only the memory
 * fills up or the image stays coarse.
 *
 * READ is the rest, because no Compose runs here: that the
 * modifier order is correct, that `canPan = { false }` is present, and that the
 * old bitmap stays up on a step change. These are statements about the
 * component, not about behavior — but they are the three decisions
 * that a later change can accidentally reverse without it standing out.
 *
 * NOT checked, and visible only on the device: whether the two-finger gesture
 * wins against the LazyColumn's scrolling. From the source of foundation
 * (gestures/Transformable.kt, DragGestureDetector.kt) it follows that they do
 * not get in each other's way and that, in doubt, the list scrolls instead of
 * doing both; which of the two is first past the threshold on an almost vertical
 * gesture is decided by the hardware. That is why there is also the double tap and the
 * two buttons in the header.
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

    // ── The three decisions that can accidentally be reversed ─────────

    private val source: String by lazy {
        Sources.withoutComments(Sources.read("finances/ui/screens/PdfPages.kt"))
    }

    @Test
    fun `the gesture claims no one-finger drags`() {
        assert(Regex("""transformable\(\s*state\s*=\s*\w+\s*,\s*canPan\s*=\s*\{\s*false\s*\}""")
            .containsMatchIn(source)) {
            "The transformable call no longer stands with `canPan = { false }`. " +
                "Without it the gesture also claims one-finger drags, and the list " +
                "no longer scrolls — read up in foundation/gestures/Transformable.kt, " +
                "detectZoom(): the threshold is then exceeded via " +
                "`panMotion > touchSlop && canPan(...)`.\nGefunden:\n" +
                (Regex("""\.transformable\([^)]*\)""").find(source)?.value ?: "no transformable call")
        }
    }

    @Test
    fun `transformable stands behind horizontalScroll`() {
        val h = source.indexOf(".horizontalScroll(")
        val t = source.indexOf(".transformable(")
        assert(h >= 0) { "no horizontalScroll any more — what does the horizontal moving then?" }
        assert(t >= 0) { "no transformable any more — what does the zooming then?" }
        assert(h < t) {
            "transformable stands BEFORE horizontalScroll. Then horizontal " +
                "scrolling is the deeper link and sees the movement first; a " +
                "two-finger gesture whose fingers move apart can claim it for itself, " +
                "and the zoom never gets its turn."
        }
    }

    @Test
    fun `on a level change the old page stays`() {
        // remember WITHOUT the render width, LaunchedEffect WITH it: only this way is it
        // re-rendered without the display first going blank. The
        // keys compared are PdfPage's parameters, not fixed names.
        // Counter-check: counter-checks/pdf-bitmap-an-renderbreite.patch → red here.
        val header = Regex("""fun PdfPage\((\w+): PdfSource, (\w+): Int, (\w+): Int[,)]""").find(source)
        assert(header != null) { "PdfPage(source: PdfSource, index: Int, renderBreite: Int) not found." }
        val (pdf, page, width) = header!!.destructured
        fun key(pattern: String) =
            Regex(pattern).find(source)?.groupValues?.get(1)?.split(",")?.map { it.trim() }
        val wanted = key("""var bitmap by remember\(([^)]*)\)""")
        assert(wanted == listOf(pdf, page)) {
            "The bitmap state hangs on $wanted instead of only on ($pdf, $page). If it " +
                "also hangs on the render width, it is reset on a level change: " +
                "the loading spinner flashes on all visible pages, and because empty " +
                "pages have a different height than rendered ones, one loses the spot " +
                "when zooming."
        }
        val newRendered = key("""LaunchedEffect\(([^)]*\b$width\b[^)]*)\)""")
        assert(newRendered?.toSet() == setOf(pdf, page, width)) {
            "The LaunchedEffect does not hang on ($pdf, $page, $width) but on $newRendered — " +
                "without $width there is never a re-render in higher resolution when zooming " +
                "and the image stays coarse."
        }
        assert(Regex("""if \(newValue != null\) bitmap = newValue""").containsMatchIn(source)) {
            "The new bitmap is no longer taken over only on success. If " +
                "a render fails, the page would then be empty instead of shown in the old resolution."
        }
    }

    @Test
    fun `the double tap reads the current zoom, not the one from back then`() {
        // pointerInput(Unit) is deliberately not set up anew — otherwise
        // every recalculation would break off a running gesture. For this, the block holds fixed the
        // closure of the FIRST composition. If the double tap reads `zoom`
        // directly, it sees 1 forever and only ever zooms in.
        //
        // That is the kind of bug that does not stand out when trying it: zooming in
        // works, and that zooming back out does not work gets blamed on the
        // operation.
        assert(source.contains("val zoomNow by rememberUpdatedState(zoom)")) {
            "There is no rememberUpdatedState for the zoom any more — then the " +
                "double tap reads the frozen value from the first composition."
        }
        val tip = Regex("detectTapGestures\\(onDoubleTap = \\{(.*?)\\}\\)", RegexOption.DOT_MATCHES_ALL)
            .find(source)?.groupValues?.get(1)
        assert(tip != null) { "No detectTapGestures(onDoubleTap = ...) found any more." }
        assert(tip!!.contains("zoomNow") && tip.contains("setZoomNow")) {
            "The double tap does not access the tracked values:\n$tip"
        }
        assert(!Regex("[^A-Za-z]zoom[^A-Za-z]").containsMatchIn(tip)) {
            "The double tap reads `zoom` directly — that is the frozen " +
                "value from the first composition:\n$tip"
        }
    }

    @Test
    fun `during a two-finger gesture the list does not scroll`() {
        // The one weakness that was already named while building it: the LazyColumn
        // is the DEEPER member and sees the movement before the transformable.
        // If a gesture diverges even a little vertically, it
        // claims the list — and no zooming happens.
        assert(source.contains("userScrollEnabled = !twoFinger")) {
            "The list keeps scrolling during a two-finger gesture. Then it wins " +
                "the fight over the movement and the zoom does not get its turn."
        }
        assert(source.contains("awaitPointerEvent(PointerEventPass.Initial)")) {
            "The fingers are no longer counted in the Initial pass. Only there " +
                "does the counter see them BEFORE the list; in the Main pass it would come too late."
        }
        // The counter must claim NOTHING — otherwise it is the same conflict
        // with the roles swapped.
        val block = Regex(
            "awaitPointerEventScope \\{(.*?)\\n {8}\\}", RegexOption.DOT_MATCHES_ALL
        ).find(source)?.groupValues?.get(1)
        assert(block != null) { "No awaitPointerEventScope block found any more." }
        assert(!block!!.contains("consume()")) {
            "The finger counter consumes events:\n$block"
        }
    }

    @Test
    fun `the zoom computes with the finger point when measuring`() {
        // The calculation itself is checked by PdfZoomAnchorTest. Here only that it is
        // called where the old layout and the new zoom are both available at once.
        val measure = Regex("""layout \{ measurable, limits ->(.*?)\n {4}\}""", RegexOption.DOT_MATCHES_ALL)
            .find(source)?.groupValues?.get(1)
        assert(measure != null) { "No layout { measurable, limits -> ... } before scrolling anymore." }
        for (part in listOf("zoomTargetY(", "requestScrollToItem(", "zoomTargetX(", "dispatchRawDelta(")) {
            assert(measure!!.contains(part)) { "Measuring lacks $part:\n$measure" }
        }
        assert(source.indexOf(".zoomAnchored(") in 0 until source.indexOf(".horizontalScroll(")) {
            "the measurement does not stand before horizontalScroll — then it caps the target at the old width."
        }
    }

    @Test
    fun `the zoom does not run via a graphicsLayer`() {
        assert(!source.contains("graphicsLayer")) {
            "There is a graphicsLayer in the PDF viewer. It stretches the rendered " +
                "bitmap instead of re-rendering it — at 4x a part number is " +
                "unreadable —, also scales the viewport of the LazyColumn " +
                "(a drag then scrolls factor times as far) and needs a " +
                "pan offset that would have to be limited against the content size. " +
                "The reasoning stands in the header comment of PdfPages."
        }
    }
}
