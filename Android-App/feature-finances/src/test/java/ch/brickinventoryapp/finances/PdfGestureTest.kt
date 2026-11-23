package ch.brickinventoryapp.finances

import android.content.Context
import android.graphics.Bitmap
import android.os.ParcelFileDescriptor
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.doubleClick
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import androidx.compose.ui.test.swipeUp
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.finances.ui.pdf.PdfSource
import ch.brickinventoryapp.finances.ui.screens.PdfPages
import ch.brickinventoryapp.finances.ui.screens.ZoomAnchor
import ch.brickinventoryapp.finances.ui.screens.zoomTargetX
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.ui.theme.Spacing
import kotlinx.coroutines.CompletableDeferred
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.InputStream

/**
 * The PDF viewer's gestures, run with injected touches: one finger scrolls, two fingers zoom,
 * the double tap toggles, and a zoom step re-renders sharper without the page going blank.
 *
 * Counter-checks (run here, each red as named):
 *   `canPan = { true }` → “one finger scrolls …” (the page no longer moves sideways);
 *   transformable before horizontalScroll → “two fingers zoom …”;
 *   `remember(source, index, renderWidthPx)` → “a zoom step keeps …” and “a failed render …”;
 *   LaunchedEffect without renderWidthPx → “a zoom step keeps …” and “… lays out the page wider …”;
 *   `bitmap = newValue` without the null check → “a failed render …”;
 *   `zoom` instead of `zoomNow` in the double tap → “the double tap …”;
 *   `userScrollEnabled = true` → “two resting fingers …”;
 *   `.zoomAnchored(…)` removed → “a zoom step holds the center …”;
 *   pagesWidth without `* zoom` (the image would only be stretched) → “… lays out the page wider …”;
 *   the finger counter consumes its events → “one finger scrolls …”, “two fingers zoom …”, “the double tap …”.
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w400dp-h700dp-mdpi")
class PdfGestureTest {

    @get:Rule
    val compose = createComposeRule()

    private val ctx: Context = ApplicationProvider.getApplicationContext()

    private object Source : PdfSource {
        override fun open(): ParcelFileDescriptor = error("rendered by the test")
        override fun inbox(): InputStream = error("rendered by the test")
        override fun close() = Unit
    }

    /** Hosts the pages like PdfViewerScreen does; [gate] holds a render back until completed. */
    private inner class Viewer(start: Float = 1f) {
        var zoom by mutableFloatStateOf(start)
        val anchor = ZoomAnchor()
        val zoomCalls = mutableListOf<Float>()
        val renderWidths = mutableListOf<Int>()
        var gate: CompletableDeferred<Bitmap?>? = null

        fun show() = compose.setContent {
            BrickInventoryManagerTheme {
                PdfPages(Source, 8, zoom, anchor, { z, p ->
                    zoomCalls += z
                    anchor.point = p
                    zoom = z.coerceIn(1f, 5f)
                }) { _, _, width ->
                    renderWidths += width
                    val held = gate
                    if (held != null) held.await() else Bitmap.createBitmap(width, (width * 1.4142f).toInt(), Bitmap.Config.ARGB_8888)
                }
            }
        }.also { compose.waitForIdle() }

        fun zoomTo(z: Float) {
            compose.runOnIdle { anchor.point = null; zoom = z }
            compose.waitForIdle()
        }
    }

    private val pane = SemanticsMatcher.keyIsDefined(SemanticsProperties.HorizontalScrollAxisRange)
    private val list = SemanticsMatcher.keyIsDefined(SemanticsProperties.VerticalScrollAxisRange)
    private fun horizontal() = compose.onNode(pane).fetchSemanticsNode().config[SemanticsProperties.HorizontalScrollAxisRange].value()
    private fun vertical() = compose.onNode(list).fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange].value()
    private fun firstPage() = compose.onNodeWithContentDescription(ctx.getString(R.string.pdfview_page, 1))
    private fun spinners() = compose.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsProperties.ProgressBarRangeInfo))
        .fetchSemanticsNodes().count { it.config[SemanticsProperties.ProgressBarRangeInfo] == ProgressBarRangeInfo.Indeterminate }

    @Test
    fun `one finger scrolls the list and moves the page, without zooming`() {
        val v = Viewer(start = 2f).apply { show() }
        compose.onNode(pane).performTouchInput { swipeUp() }
        compose.waitForIdle()
        assertTrue("a vertical drag does not scroll the list", vertical() > 0f)
        compose.onNode(pane).performTouchInput { swipeLeft() }
        compose.waitForIdle()
        assertTrue("one finger moves the page sideways", horizontal() > 0f)
        assertEquals("one finger zoomed", emptyList<Float>(), v.zoomCalls)
    }

    @Test
    fun `two fingers zoom, even at a zoom where the page scrolls sideways`() {
        val v = Viewer(start = 2f).apply { show() }
        compose.onNode(pane).performTouchInput {
            // Fingers close together, one moves away in big steps: on the same event both the
            // zoom and a sideways drag are past their threshold, and whoever sees it first wins.
            down(0, center)
            down(1, center - Offset(40f, 0f))
            repeat(4) { moveBy(0, Offset(40f, 0f)) }
            up(0)
            up(1)
        }
        compose.waitForIdle()
        assertTrue("two fingers zoom: ${v.zoomCalls}", v.zoom > 2f)
    }

    @Test
    fun `two resting fingers do not scroll the list`() {
        Viewer().apply { show() }
        compose.onNode(pane).performTouchInput {
            down(0, center - Offset(60f, 0f))
            down(1, center + Offset(60f, 0f))
        }
        // A frame passes while the fingers rest, as on a device; then they move together.
        compose.waitForIdle()
        compose.onNode(pane).performTouchInput {
            repeat(10) { updatePointerBy(0, Offset(0f, -30f)); updatePointerBy(1, Offset(0f, -30f)); move() }
            up(0)
            up(1)
        }
        compose.waitForIdle()
        assertEquals("two fingers scrolled the list", 0f, vertical(), 0f)
    }

    @Test
    fun `the double tap zooms in and on the second time back out`() {
        val v = Viewer().apply { show() }
        compose.onNode(pane).performTouchInput { doubleClick() }
        compose.waitForIdle()
        assertEquals(2.5f, v.zoom, 0.001f)
        compose.onNode(pane).performTouchInput { doubleClick() }
        compose.waitForIdle()
        assertEquals("the double tap reads the zoom of its first composition", 1f, v.zoom, 0.001f)
    }

    @Test
    fun `a zoom step keeps the old page until the sharper one is rendered`() {
        val v = Viewer().apply { show() }
        val before = v.renderWidths.first()
        firstPage().assertExists()
        v.gate = CompletableDeferred()
        v.zoomTo(1.25f)
        assertTrue("no re-render at the higher level: ${v.renderWidths}", v.renderWidths.any { it > before })
        firstPage().assertExists()
        assertEquals("a page went blank while re-rendering", 0, spinners())
    }

    @Test
    fun `a failed render keeps the page shown before`() {
        val v = Viewer().apply { show() }
        v.gate = CompletableDeferred<Bitmap?>().apply { complete(null) }
        v.zoomTo(2.5f)
        assertTrue("no re-render at the higher level", v.renderWidths.size > 1)
        firstPage().assertExists()
        assertEquals(0, spinners())
    }

    @Test
    fun `a zoom step holds the center of the viewport in place`() {
        val v = Viewer().apply { show() }
        val width = compose.onNode(pane).fetchSemanticsNode().size.width
        val edge = with(compose.density) { Spacing.small.toPx() }
        v.zoomTo(2f)
        assertEquals("sideways", zoomTargetX(0, width / 2f, edge, 2f).toFloat(), horizontal(), 1f)
        assertTrue("the list stays at the top instead of following the center", vertical() > 0f)
    }

    @Test
    fun `a zoom step lays out the page wider instead of stretching the image`() {
        val v = Viewer().apply { show() }
        val narrow = firstPage().fetchSemanticsNode().size.width
        v.zoomTo(2f)
        val wide = firstPage().fetchSemanticsNode().size.width
        assertTrue("page $narrow px at 1x, $wide px at 2x", wide >= narrow * 2 - 2)
        assertTrue("rendered no wider: ${v.renderWidths}", v.renderWidths.max() >= narrow * 2 - 2)
    }
}
