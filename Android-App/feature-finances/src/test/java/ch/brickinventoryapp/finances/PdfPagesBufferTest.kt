package ch.brickinventoryapp.finances

import android.graphics.Color
import androidx.core.graphics.createBitmap
import ch.brickinventoryapp.finances.ui.pdf.PagesDimensions
import ch.brickinventoryapp.finances.ui.pdf.bitmapFromBuffer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.GraphicsMode
import java.nio.ByteBuffer

/**
 * The page is built in the main process from the shared memory: exactly at the dimensions
 * it set, and only if the memory is exactly that size.
 *
 * Counter-check (Robolectric, measured by CI):
 *   pdf-puffer-ungeprueft  bitmapFromBuffer() without a size check → red “memory of a different
 *                          size yields no page”
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class PdfPagesBufferTest {

    private val dimensions = PagesDimensions(3, 2)

    @Test
    fun `the renderer's pixels come into the page unchanged`() {
        val template = createBitmap(3, 2).apply { eraseColor(Color.WHITE); setPixel(1, 1, Color.RED) }
        val puffer = ByteBuffer.allocate(dimensions.bytes).also { template.copyPixelsToBuffer(it); it.rewind() }
        val seite = bitmapFromBuffer(puffer, dimensions)!!
        assertEquals(3 to 2, seite.width to seite.height)
        assertEquals(Color.RED, seite.getPixel(1, 1))
        assertEquals(Color.WHITE, seite.getPixel(0, 0))
    }

    @Test
    fun `a buffer of a different size gives no page`() {
        assertNull(bitmapFromBuffer(ByteBuffer.allocate(dimensions.bytes + 4), dimensions))
        assertNull(bitmapFromBuffer(ByteBuffer.allocate(dimensions.bytes - 4), dimensions))
    }
}
