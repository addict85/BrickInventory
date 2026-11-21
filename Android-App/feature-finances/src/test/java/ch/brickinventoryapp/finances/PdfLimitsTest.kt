package ch.brickinventoryapp.finances

import ch.brickinventoryapp.finances.ui.pdf.PDF_BITMAP_MAX_PX
import ch.brickinventoryapp.finances.ui.pdf.PDF_EDGE_MAX_PX
import ch.brickinventoryapp.finances.ui.pdf.PDF_MAX_PAGES
import ch.brickinventoryapp.finances.ui.pdf.PDF_PAGE_MAX_PT
import ch.brickinventoryapp.finances.ui.pdf.bitmapDimensions
import ch.brickinventoryapp.finances.ui.pdf.checkPageCount
import ch.brickinventoryapp.finances.ui.pdf.pagesDimensions
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What the isolated PDF renderer reports counts as untrusted: the main process checks
 * page count and page edges, and sets the shared memory's size itself.
 * (That no Bitmap parcel is ever unpacked is checked by ModulgrenzenTest.)
 *
 * Counter-checks (measured locally with kotlinc):
 *   pdf-seitenzahl-ungeprueft  checkPageCount() lets every number through → red “a page count
 *                              outside …”
 *   pdf-masse-ungeprueft       pagesDimensions() without checking the page edges → red “page edges
 *                              outside the format …”
 */
class PdfLimitsTest {

    @Test
    fun `a page count outside 1 to the upper limit counts as unreadable`() {
        for (n in listOf(0, -1, Int.MIN_VALUE, PDF_MAX_PAGES + 1, Int.MAX_VALUE)) assertNull("$n Seiten", checkPageCount(n))
        assertEquals(1, checkPageCount(1))
        assertEquals(PDF_MAX_PAGES, checkPageCount(PDF_MAX_PAGES))
    }

    @Test
    fun `page edges outside the format give no dimensions`() {
        for ((w, h) in listOf(0 to 842, 595 to 0, -1 to 842, 595 to PDF_PAGE_MAX_PT + 1, Int.MAX_VALUE to 1))
            assertNull("$w x $h pt", pagesDimensions(1080, w, h))
    }

    @Test
    fun `the dimensions follow the width and stay below the area limit`() {
        val a4 = pagesDimensions(1080, 595, 842)!!
        assertEquals(bitmapDimensions(1080, 842f / 595), a4.breite to a4.hoehe)
        assertEquals(a4.breite * a4.hoehe * 4, a4.bytes)
        for (breite in listOf(1, 400, 1080, 4000, 20_000, Int.MAX_VALUE))
            for ((w, h) in listOf(1 to PDF_PAGE_MAX_PT, PDF_PAGE_MAX_PT to 1, 595 to 842, PDF_PAGE_MAX_PT to PDF_PAGE_MAX_PT)) {
                val m = pagesDimensions(breite, w, h)!!
                assertTrue("$breite px, $w x $h pt: ${m.breite} x ${m.hoehe}",
                    m.breite in 1..PDF_EDGE_MAX_PX && m.hoehe in 1..PDF_EDGE_MAX_PX && m.breite.toLong() * m.hoehe <= PDF_BITMAP_MAX_PX)
            }
    }
}
