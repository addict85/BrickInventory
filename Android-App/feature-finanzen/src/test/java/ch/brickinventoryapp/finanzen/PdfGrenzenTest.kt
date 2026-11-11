package ch.brickinventoryapp.finanzen

import ch.brickinventoryapp.finanzen.ui.pdf.PDF_BITMAP_MAX_PX
import ch.brickinventoryapp.finanzen.ui.pdf.PDF_KANTE_MAX_PX
import ch.brickinventoryapp.finanzen.ui.pdf.PDF_MAX_SEITEN
import ch.brickinventoryapp.finanzen.ui.pdf.PDF_SEITE_MAX_PT
import ch.brickinventoryapp.finanzen.ui.pdf.bitmapMasse
import ch.brickinventoryapp.finanzen.ui.pdf.pruefeSeitenzahl
import ch.brickinventoryapp.finanzen.ui.pdf.seitenMasse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Was der isolierte PDF-Renderer meldet, gilt als fremd: Seitenzahl und Seitenkanten
 * prüft der Hauptprozess, die Grösse des geteilten Speichers legt er selbst fest.
 * (Dass kein Bitmap-Parcel ausgepackt wird, prüft ModulgrenzenTest.)
 *
 * Gegenproben (lokal mit kotlinc gemessen):
 *   pdf-seitenzahl-ungeprueft  pruefeSeitenzahl() lässt jede Zahl durch → rot „eine Seitenzahl
 *                              ausserhalb …“
 *   pdf-masse-ungeprueft       seitenMasse() ohne Prüfung der Seitenkanten → rot „Seitenkanten
 *                              ausserhalb des Formats …“
 */
class PdfGrenzenTest {

    @Test
    fun `eine Seitenzahl ausserhalb von 1 bis zur Obergrenze gilt als unlesbar`() {
        for (n in listOf(0, -1, Int.MIN_VALUE, PDF_MAX_SEITEN + 1, Int.MAX_VALUE)) assertNull("$n Seiten", pruefeSeitenzahl(n))
        assertEquals(1, pruefeSeitenzahl(1))
        assertEquals(PDF_MAX_SEITEN, pruefeSeitenzahl(PDF_MAX_SEITEN))
    }

    @Test
    fun `Seitenkanten ausserhalb des Formats ergeben keine Masse`() {
        for ((w, h) in listOf(0 to 842, 595 to 0, -1 to 842, 595 to PDF_SEITE_MAX_PT + 1, Int.MAX_VALUE to 1))
            assertNull("$w x $h pt", seitenMasse(1080, w, h))
    }

    @Test
    fun `die Masse folgen der Breite und bleiben unter der Flaechengrenze`() {
        val a4 = seitenMasse(1080, 595, 842)!!
        assertEquals(bitmapMasse(1080, 842f / 595), a4.breite to a4.hoehe)
        assertEquals(a4.breite * a4.hoehe * 4, a4.bytes)
        for (breite in listOf(1, 400, 1080, 4000, 20_000, Int.MAX_VALUE))
            for ((w, h) in listOf(1 to PDF_SEITE_MAX_PT, PDF_SEITE_MAX_PT to 1, 595 to 842, PDF_SEITE_MAX_PT to PDF_SEITE_MAX_PT)) {
                val m = seitenMasse(breite, w, h)!!
                assertTrue("$breite px, $w x $h pt: ${m.breite} x ${m.hoehe}",
                    m.breite in 1..PDF_KANTE_MAX_PX && m.hoehe in 1..PDF_KANTE_MAX_PX && m.breite.toLong() * m.hoehe <= PDF_BITMAP_MAX_PX)
            }
    }
}
