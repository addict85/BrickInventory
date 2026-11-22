package ch.brickinventoryapp.finances

import ch.brickinventoryapp.data.util.PDF_CONFIDENTIAL_FOLDER
import ch.brickinventoryapp.data.util.cleanUpConfidentialPdfs
import ch.brickinventoryapp.data.util.pdfStore
import ch.brickinventoryapp.finances.ui.viewmodel.pdfMaySavedBecome
import ch.brickinventoryapp.finances.ui.viewmodel.showsVouchers
import ch.brickinventoryapp.finances.ui.viewmodel.voucherExportAddress
import ch.brickinventoryapp.finances.ui.viewmodel.voucherPdfAddress
import ch.brickinventoryapp.testing.Sources
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * A voucher PDF (number and PIN) never lands on disk: the
 * viewer gets no file for it, loads into memory and renders from a
 * memfd. What older versions placed in their own folder disappears on signing out and
 * on startup. Instruction manuals stay in the cache.
 *
 * Run: storage and deletion against a real directory; the loading into
 * memory is checked by PdfInStorageTest (core-data). That the viewer takes this path
 * needs a device; the structure check below records that.
 *
 * Counter-checks (30.10.2026, measured with kt-b2/bau.sh):
 *   A  in pdfStore() `confidential` ignored (always cacheDir) → red “a
 *      voucher PDF gets no file …”
 *   D  pdfMaySavedBecome() always true → red “a
 *      voucher PDF cannot be downloaded …”
 *   E  in PdfViewerScreen the `if (savable)` around the button removed
 *      → red “viewer, sign-out and start clean up” (button unprotected)
 *   F  in pdfStore() back to `pdfUrl.hashCode()` as the name → red
 *      “the file name depends on the whole address …”
 *   G  showsVouchers() back to `"/api/v1/vouchers/" in pdfUrl` →
 *      red “vouchers are recognized by the path …”
 * Counter-checks:
 *   H  pdfStore() also returns a cache file for confidential PDFs
 *      → red “a voucher PDF gets no file …”;
 *      counter-checks/gutschein-pdf-auf-platte.patch
 *   I  in the loader (then PdfViewerScreen) `if (store == null)` replaced with `if (false)` → red
 *      “viewer, sign-out and start clean up” (memory path not taken)
 * Counter-checks:
 *   J  in PdfViewerScreen the print button pulled ahead of `if (savable)` → red
 *      “viewer, sign-out and start clean up” (printing unprotected);
 *      counter-checks/gutschein-drucken.patch
 *   K  in logout() the line `cleanUpInstructions(` removed → red “viewer,
 *      sign-out and start clean up” (instruction manuals survive signing out)
 */
class VoucherPdfStoreTest {

    private val cache = File(System.getProperty("java.io.tmpdir"), "bim-pdf-${System.nanoTime()}").apply { mkdirs() }
    private val voucher = voucherPdfAddress("https://brick.example", 7)
    private val instruction = "https://brick.example/api/v1/instructions/42/file"

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
        val x = "https://brick.example/api/v1/vouchers/Aa/pdf"
        val y = "https://brick.example/api/v1/vouchers/BB/pdf"
        assertEquals("Die Probe braucht zwei Adressen mit gleichem hashCode()", x.hashCode(), y.hashCode())
        assertTrue(pdfStore(cache, x, false) != pdfStore(cache, y, false))
        assertEquals("anleitung_e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855.bin", pdfStore(cache, "", false)?.name)
    }

    @Test
    fun `the path recognizes vouchers, also in a different spelling`() {
        assertTrue(showsVouchers("https://brick.example/API/v1/Vouchers/7/pdf"))
        assertTrue(showsVouchers("https://brick.example/api/v1/%76ouchers/7/pdf"))
        assertTrue(showsVouchers("https://brick.example/brick/api//v1/vouchers/export/pdf"))
        assertTrue("Was sich nicht lesen lässt, gilt als vertraulich", showsVouchers("https://brick example/x y"))
        assertFalse(showsVouchers(instruction))
        assertFalse("Die Abfrage ist kein Pfad", showsVouchers("$instruction?von=/api/v1/vouchers/7"))
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

    @Test
    fun `viewer, sign-out and start clean up`() {
        val viewer = Sources.withoutComments(Sources.read("finances/ui/screens/PdfViewerScreen.kt"))
        // Loading and holding have lived in the loader and the ViewModel since M1.
        val loader = Sources.withoutComments(Sources.read("finances/ui/pdf/InstructionLoader.kt") + Sources.read("finances/ui/pdf/PdfSource.kt") +
            Sources.read("data/InstructionRepository.kt"))
        val vm = Sources.withoutComments(Sources.read("finances/ui/viewmodel/PdfViewerViewModel.kt"))
        assertTrue("Der Betrachter legt nicht über pdfStore() ab", loader.contains("pdfStore(ctx.cacheDir, pdfUrl, confidential)"))
        assertTrue("Ohne Datei nimmt der Betrachter nicht den Weg über den Speicher",
            Regex("""if \(store == null\) \{\s*loadIntoMemoryAndCount\(""").containsMatchIn(loader))
        assertTrue("Der Speicherweg lädt nicht über loadPdfIntoMemory()", loader.contains("loadPdfIntoMemory(loadClient(httpClient), url"))
        assertTrue("Das Gutschein-PDF liegt nicht in einem memfd", loader.contains("Os.memfd_create("))
        assertTrue("Der Speicherbereich bleibt nach dem Verlassen offen",
            Regex("""override fun onCleared\(\)\s*\{\s*open\.close\(\)""").containsMatchIn(vm))
        assertTrue("Herunterladen steht ohne Prüfung da",
            Regex("""if \(savable\) \{\s*((?:ch\.brickinventoryapp\.ui\.components\.)?WithTooltip\([^\n]*\{\s*)?IconButton\(onClick = \{ (report\()?savePdfToDownloads\(""").containsMatchIn(viewer))
        // The print dialog offers „Als PDF speichern“: printing only where saving is also allowed.
        val guarded = viewer.substringAfter("if (savable) {").substringBefore("\n                    }\n")
        assertTrue("Drucken steht ohne Prüfung da", viewer.split("printPdf(ctx,").size == 2 && "printPdf(ctx," in guarded)
        val logout = Sources.function(Sources.withoutComments(Sources.read("data/SessionCleanup.kt")), "suspend fun cleanUp(")
        assertTrue("Abmelden lässt Gutschein-PDFs liegen", logout.contains("cleanUpConfidentialPdfs("))
        assertTrue("Abmelden lässt Anleitungen liegen", logout.contains("cleanUpInstructions(ctx.cacheDir)"))
        assertTrue("Abmelden lässt Teileliste und Update in filesDir liegen",
            logout.contains("cleanUpAccountFiles(ctx.filesDir, ctx.getExternalFilesDir(null))"))
        val start = Sources.read("app/BrickInventoryApp.kt")
        assertTrue("Der Start räumt Reste nicht weg", start.contains("cleanUpConfidentialPdfs(cacheDir)"))
        assertTrue("Der Start lässt Klartext-Anleitungen liegen", start.contains("cleanUpPlaintextInstructions(cacheDir)"))
    }
}
