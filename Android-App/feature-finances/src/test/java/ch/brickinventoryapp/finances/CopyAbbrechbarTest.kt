package ch.brickinventoryapp.finances

import ch.brickinventoryapp.finances.ui.pdf.copyAbbrechbar
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream

/**
 * The copying for printing (PdfPrintAdapter) runs off the main thread and
 * ends as soon as the job is cancelled, instead of writing the whole instruction manual.
 *
 * Counter-check: in copyAbbrechbar() the
 * check `ensureActive()` removed → red “a cancel ends the copying …”
 * (gegenproben/druck-kopiert-weiter.patch).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class CopyAbbrechbarTest {

    @Test
    fun `everything arrives, in pieces`() = runTest(StandardTestDispatcher()) {
        val inhalt = ByteArray(200_000) { (it % 251).toByte() }
        val ziel = ByteArrayOutputStream()
        assertEquals(inhalt.size.toLong(), copyAbbrechbar(ByteArrayInputStream(inhalt), ziel, stueck = 4096))
        assertArrayEquals(inhalt, ziel.toByteArray())
    }

    @Test
    fun `an abort ends the copying after the running piece`() = runTest(StandardTestDispatcher()) {
        val ziel = ByteArrayOutputStream()
        lateinit var job: Job
        // 100 copies; after the third one the print dialog is cancelled.
        val quelle = object : InputStream() {
            var pieces = 0
            override fun read(): Int = 0
            override fun read(b: ByteArray, off: Int, len: Int): Int {
                if (++pieces == 3) job.cancel()
                return if (pieces > 100) -1 else len
            }
        }
        var abgebrochen = false
        job = launch {
            try {
                copyAbbrechbar(quelle, ziel, stueck = 10)
            } catch (e: CancellationException) {
                abgebrochen = true
                throw e
            }
        }
        job.join()
        assertTrue("Der Abbruch kam nicht an", abgebrochen)
        assertEquals("Drei Stücke, dann Schluss", 30, ziel.size())
    }
}
