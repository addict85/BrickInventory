package ch.brickinventoryapp.finanzen

import android.graphics.Color
import androidx.core.graphics.createBitmap
import ch.brickinventoryapp.finanzen.ui.pdf.PagesDimensions
import ch.brickinventoryapp.finanzen.ui.pdf.bitmapFromBuffer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.GraphicsMode
import java.nio.ByteBuffer

/**
 * Die Seite entsteht im Hauptprozess aus dem geteilten Speicher: genau in den Massen,
 * die er festlegte, und nur, wenn der Speicher genau so gross ist.
 *
 * Gegenprobe (Robolectric, misst die CI):
 *   pdf-puffer-ungeprueft  bitmapFromBuffer() ohne Grössenprüfung → rot „ein Speicher anderer
 *                          Grösse ergibt keine Seite“
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class PdfPagesBufferTest {

    private val dimensions = PagesDimensions(3, 2)

    @Test
    fun `die Pixel des Renderers kommen unveraendert in die Seite`() {
        val template = createBitmap(3, 2).apply { eraseColor(Color.WHITE); setPixel(1, 1, Color.RED) }
        val puffer = ByteBuffer.allocate(dimensions.bytes).also { template.copyPixelsToBuffer(it); it.rewind() }
        val seite = bitmapFromBuffer(puffer, dimensions)!!
        assertEquals(3 to 2, seite.width to seite.height)
        assertEquals(Color.RED, seite.getPixel(1, 1))
        assertEquals(Color.WHITE, seite.getPixel(0, 0))
    }

    @Test
    fun `ein Speicher anderer Groesse ergibt keine Seite`() {
        assertNull(bitmapFromBuffer(ByteBuffer.allocate(dimensions.bytes + 4), dimensions))
        assertNull(bitmapFromBuffer(ByteBuffer.allocate(dimensions.bytes - 4), dimensions))
    }
}
