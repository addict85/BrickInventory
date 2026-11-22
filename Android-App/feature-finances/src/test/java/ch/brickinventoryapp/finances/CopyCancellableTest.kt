package ch.brickinventoryapp.finances

import ch.brickinventoryapp.finances.ui.pdf.copyCancellable
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
 * Counter-check: in copyCancellable() the
 * check `ensureActive()` removed → red “a cancel ends the copying …”
 * (counter-checks/druck-kopiert-weiter.patch).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class CopyCancellableTest {

    @Test
    fun `everything arrives, in pieces`() = runTest(StandardTestDispatcher()) {
        val content = ByteArray(200_000) { (it % 251).toByte() }
        val target = ByteArrayOutputStream()
        assertEquals(content.size.toLong(), copyCancellable(ByteArrayInputStream(content), target, piece = 4096))
        assertArrayEquals(content, target.toByteArray())
    }

    @Test
    fun `an abort ends the copying after the running piece`() = runTest(StandardTestDispatcher()) {
        val target = ByteArrayOutputStream()
        lateinit var job: Job
        // 100 copies; after the third one the print dialog is cancelled.
        val source = object : InputStream() {
            var pieces = 0
            override fun read(): Int = 0
            override fun read(b: ByteArray, off: Int, len: Int): Int {
                if (++pieces == 3) job.cancel()
                return if (pieces > 100) -1 else len
            }
        }
        var cancelled = false
        job = launch {
            try {
                copyCancellable(source, target, piece = 10)
            } catch (e: CancellationException) {
                cancelled = true
                throw e
            }
        }
        job.join()
        assertTrue("the cancellation did not arrive", cancelled)
        assertEquals("three pieces, then stop", 30, target.size())
    }
}
