package ch.brickinventoryapp.finances.ui.pdf

import android.graphics.Bitmap
import ch.brickinventoryapp.model.coroutines.BrickDispatchers
import ch.brickinventoryapp.model.coroutines.Dispatcher
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import javax.inject.Inject
import kotlin.math.sqrt

/**
 * Upper bound of a page bitmap in pixels of area: 8 million ARGB pixels are
 * roughly 32 MB. The area is limited because it determines memory use; when it is
 * reached, the page only gets softer, not wrong.
 */
internal const val PDF_BITMAP_MAX_PX = 8_000_000

/**
 * Dimensions of the page bitmap: the desired width, capped at [PDF_BITMAP_MAX_PX].
 *
 * @param widthPx desired width in pixels
 * @param ratio height divided by width of the PDF page
 * @return (width, height) in pixels, both at least 1
 *
 * Capped with the square root, so that both sides shrink equally and the
 * ratio is preserved. A function of its own, so the calculation can be checked without a device.
 */
internal fun bitmapDimensions(widthPx: Int, ratio: Float): Pair<Int, Int> {
    var w = widthPx.coerceAtLeast(1)
    val surface = w.toFloat() * (w * ratio)
    if (surface > PDF_BITMAP_MAX_PX) w = (w * sqrt(PDF_BITMAP_MAX_PX / surface)).toInt()
    w = w.coerceAtLeast(1)
    return w to (w * ratio).toInt().coerceAtLeast(1)
}

/** The viewer accepts no more pages than this; the number comes from the renderer and counts as untrusted. */
internal const val PDF_MAX_PAGES = 10_000

/** The largest page edge the PDF format allows (200 inches in points). */
internal const val PDF_PAGE_MAX_PT = 14_400

/** Longest edge of a page bitmap; more cannot be drawn as a texture. */
internal const val PDF_EDGE_MAX_PX = 16_384

/** Dimensions of a page bitmap, determined in the main process; [bytes] is the size of the shared memory. */
internal class PagesDimensions(val width: Int, val height: Int) {
    val bytes: Int get() = width * height * 4
}

/** The renderer's page count, or null if it cannot be right. */
internal fun checkPageCount(n: Int): Int? = n.takeIf { it in 1..PDF_MAX_PAGES }

/**
 * Dimensions from the renderer's page edges ([widthPt], [heightPt]); null if these
 * are outside the format. [bitmapDimensions] limits the area, here once more for safety.
 */
internal fun pagesDimensions(widthPx: Int, widthPt: Int, heightPt: Int): PagesDimensions? {
    if (widthPt !in 1..PDF_PAGE_MAX_PT || heightPt !in 1..PDF_PAGE_MAX_PT) return null
    val ratio = heightPt.toFloat() / widthPt
    var (w, h) = bitmapDimensions(widthPx.coerceIn(1, PDF_EDGE_MAX_PX), ratio)
    // A very tall page is rendered narrower, until the height fits too.
    if (h > PDF_EDGE_MAX_PX) bitmapDimensions((w.toLong() * PDF_EDGE_MAX_PX / h).toInt().coerceAtLeast(1), ratio).let { (b, n) -> w = b; h = n }
    return PagesDimensions(w, h).takeIf { h <= PDF_EDGE_MAX_PX && w.toLong() * h <= PDF_BITMAP_MAX_PX }
}

/** Renders a page (source, index, width in pixels); the screen gets it from the ViewModel. */
internal typealias PagesRenderer = suspend (PdfSource, Int, Int) -> Bitmap?

/** A page as an image; the ViewModel only passes the source through and knows no Bitmap. */
fun interface PdfPagesSource {
    suspend fun page(source: PdfSource, index: Int, widthPx: Int): Bitmap?
}

/** Rendered in the isolated process; the call there blocks, so not on Main. */
internal class PdfRendererPages @Inject constructor(
    private val renderer: PdfRenderConnection,
    @param:Dispatcher(BrickDispatchers.IO) private val io: CoroutineDispatcher,
) : PdfPagesSource {
    override suspend fun page(source: PdfSource, index: Int, widthPx: Int): Bitmap? =
        withContext(io) { renderer.page(source, index, widthPx) }
}
