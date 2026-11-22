package ch.brickinventoryapp.finances

import ch.brickinventoryapp.data.util.PDF_CONFIDENTIAL_FOLDER
import ch.brickinventoryapp.data.util.cleanUpConfidentialPdfs
import ch.brickinventoryapp.data.util.pdfStore
import ch.brickinventoryapp.finances.ui.viewmodel.pdfMaySavedBecome
import ch.brickinventoryapp.finances.ui.viewmodel.showsVouchers
import ch.brickinventoryapp.finances.ui.viewmodel.voucherExportAddress
import ch.brickinventoryapp.finances.ui.viewmodel.voucherPdfAddress
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * A voucher PDF (number and PIN) never lands on disk: no file for it, and what older
 * versions placed in their own folder disappears. Instruction manuals stay in the cache.
 * Run against a real directory. The loader is InstructionLoaderTest, the buttons PdfDownloadTest,
 * releasing the memory PdfViewerViewModelTest, sign-out LogoutCleansEverythingTest (core-data),
 * the start StartCleanupTest (app).
 *
 * Counter-checks:
 *   A  in pdfStore() `confidential` ignored (always cacheDir) → red “a voucher PDF gets no file …”;
 *      counter-checks/voucher-pdf-on-disk.patch
 *   D  pdfMaySavedBecome() always true → red “a voucher PDF cannot be downloaded …”
 *   F  in pdfStore() back to `pdfUrl.hashCode()` as the name → red “the file name depends …”
 *   G  showsVouchers() back to `"/api/v2/vouchers/" in pdfUrl` → red “the path recognizes vouchers …”
 */
class VoucherPdfStoreTest {

    private val cache = File(System.getProperty("java.io.tmpdir"), "bim-pdf-${System.nanoTime()}").apply { mkdirs() }
    private val voucher = voucherPdfAddress("https://brick.example", 7)
    private val instruction = "https://brick.example/api/v2/instructions/42/file"

    @After
    fun tearDown() { cache.deleteRecursively() }

    private fun create(f: File) = f.apply { parentFile!!.mkdirs(); writeText("PIN 1234") }

    @Test
    fun `a voucher PDF gets no file, an instruction lies in the cache`() {
        assertNull(pdfStore(cache, voucher, showsVouchers(voucher)))
        assertNull(pdfStore(cache, voucherExportAddress("https://brick.example/"), true))
        assertEquals(cache, pdfStore(cache, instruction, showsVouchers(instruction))?.parentFile)
    }

    /** Two addresses with the same hashCode() would otherwise have shared one file. */
    @Test
    fun `the file name depends on the whole address, not on 32 bits`() {
        val x = "https://brick.example/api/v2/vouchers/Aa/pdf"
        val y = "https://brick.example/api/v2/vouchers/BB/pdf"
        assertEquals("the probe needs two addresses with the same hashCode()", x.hashCode(), y.hashCode())
        assertTrue(pdfStore(cache, x, false) != pdfStore(cache, y, false))
        assertEquals("anleitung_e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855.bin", pdfStore(cache, "", false)?.name)
    }

    @Test
    fun `the path recognizes vouchers, also in a different spelling`() {
        assertTrue(showsVouchers("https://brick.example/API/v1/Vouchers/7/pdf"))
        assertTrue(showsVouchers("https://brick.example/api/v2/%76ouchers/7/pdf"))
        assertTrue(showsVouchers("https://brick.example/brick/api//v1/vouchers/export/pdf"))
        assertTrue("what cannot be read counts as confidential", showsVouchers("https://brick example/x y"))
        assertFalse(showsVouchers(instruction))
        assertFalse("the query is not a path", showsVouchers("$instruction?von=/api/v2/vouchers/7"))
    }

    /** Voucher PDFs that older versions placed in their own folder. */
    @Test
    fun `sign-out and start empty the folder, instructions stay`() {
        val g = create(File(File(cache, PDF_CONFIDENTIAL_FOLDER), "pdfview_alt.pdf"))
        val a = create(pdfStore(cache, instruction, false)!!)
        cleanUpConfidentialPdfs(cache)
        assertFalse(g.exists())
        assertFalse(File(cache, PDF_CONFIDENTIAL_FOLDER).exists())
        assertTrue(a.exists())
    }

    @Test
    fun `a voucher PDF cannot be downloaded, an instruction can`() {
        assertFalse(pdfMaySavedBecome(voucher))
        assertFalse(pdfMaySavedBecome(voucherExportAddress("https://brick.example/")))
        assertTrue(pdfMaySavedBecome(instruction))
    }
}
