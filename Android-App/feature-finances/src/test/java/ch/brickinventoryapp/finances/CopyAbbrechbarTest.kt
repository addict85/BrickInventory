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
 * Das Kopieren für den Druck (PdfPrintAdapter) läuft abseits des Hauptfadens und
 * endet, sobald der Auftrag abgebrochen ist, statt die ganze Anleitung zu schreiben.
 *
 * Gegenprobe: in copyAbbrechbar() die
 * Prüfung `ensureActive()` gestrichen → rot „ein Abbruch beendet das Kopieren …“
 * (gegenproben/druck-kopiert-weiter.patch).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class CopyAbbrechbarTest {

    @Test
    fun `alles kommt an, in Stuecken`() = runTest(StandardTestDispatcher()) {
        val inhalt = ByteArray(200_000) { (it % 251).toByte() }
        val ziel = ByteArrayOutputStream()
        assertEquals(inhalt.size.toLong(), copyAbbrechbar(ByteArrayInputStream(inhalt), ziel, stueck = 4096))
        assertArrayEquals(inhalt, ziel.toByteArray())
    }

    @Test
    fun `ein Abbruch beendet das Kopieren nach dem laufenden Stueck`() = runTest(StandardTestDispatcher()) {
        val ziel = ByteArrayOutputStream()
        lateinit var job: Job
        // 100 Stücke; nach dem dritten bricht der Druckdialog ab.
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
