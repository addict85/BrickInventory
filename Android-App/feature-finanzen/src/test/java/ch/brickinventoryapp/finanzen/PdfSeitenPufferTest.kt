package ch.brickinventoryapp.finanzen

import android.graphics.Color
import androidx.core.graphics.createBitmap
import ch.brickinventoryapp.finanzen.ui.pdf.SeitenMasse
import ch.brickinventoryapp.finanzen.ui.pdf.bitmapAusPuffer
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
 *   pdf-puffer-ungeprueft  bitmapAusPuffer() ohne Grössenprüfung → rot „ein Speicher anderer
 *                          Grösse ergibt keine Seite“
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class PdfSeitenPufferTest {

    private val masse = SeitenMasse(3, 2)

    @Test
    fun `die Pixel des Renderers kommen unveraendert in die Seite`() {
        val vorlage = createBitmap(3, 2).apply { eraseColor(Color.WHITE); setPixel(1, 1, Color.RED) }
        val puffer = ByteBuffer.allocate(masse.bytes).also { vorlage.copyPixelsToBuffer(it); it.rewind() }
        val seite = bitmapAusPuffer(puffer, masse)!!
        assertEquals(3 to 2, seite.width to seite.height)
        assertEquals(Color.RED, seite.getPixel(1, 1))
        assertEquals(Color.WHITE, seite.getPixel(0, 0))
    }

    @Test
    fun `ein Speicher anderer Groesse ergibt keine Seite`() {
        assertNull(bitmapAusPuffer(ByteBuffer.allocate(masse.bytes + 4), masse))
        assertNull(bitmapAusPuffer(ByteBuffer.allocate(masse.bytes - 4), masse))
    }
}
