package ch.brickinventoryapp

import ch.brickinventoryapp.ui.pdf.kopiereAbbrechbar
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
 * Das Kopieren für den Druck (PdfDruckAdapter) läuft abseits des Hauptfadens und
 * endet, sobald der Auftrag abgebrochen ist, statt die ganze Anleitung zu schreiben.
 *
 * Gegenprobe: in kopiereAbbrechbar() die
 * Prüfung `ensureActive()` gestrichen → rot „ein Abbruch beendet das Kopieren …“
 * (gegenproben/druck-kopiert-weiter.patch).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class KopiereAbbrechbarTest {

    @Test
    fun `alles kommt an, in Stuecken`() = runTest(StandardTestDispatcher()) {
        val inhalt = ByteArray(200_000) { (it % 251).toByte() }
        val ziel = ByteArrayOutputStream()
        assertEquals(inhalt.size.toLong(), kopiereAbbrechbar(ByteArrayInputStream(inhalt), ziel, stueck = 4096))
        assertArrayEquals(inhalt, ziel.toByteArray())
    }

    @Test
    fun `ein Abbruch beendet das Kopieren nach dem laufenden Stueck`() = runTest(StandardTestDispatcher()) {
        val ziel = ByteArrayOutputStream()
        lateinit var auftrag: Job
        // 100 Stücke; nach dem dritten bricht der Druckdialog ab.
        val quelle = object : InputStream() {
            var stuecke = 0
            override fun read(): Int = 0
            override fun read(b: ByteArray, off: Int, len: Int): Int {
                if (++stuecke == 3) auftrag.cancel()
                return if (stuecke > 100) -1 else len
            }
        }
        var abgebrochen = false
        auftrag = launch {
            try {
                kopiereAbbrechbar(quelle, ziel, stueck = 10)
            } catch (e: CancellationException) {
                abgebrochen = true
                throw e
            }
        }
        auftrag.join()
        assertTrue("Der Abbruch kam nicht an", abgebrochen)
        assertEquals("Drei Stücke, dann Schluss", 30, ziel.size())
    }
}
