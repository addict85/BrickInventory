package ch.brickinventoryapp.finances

import ch.brickinventoryapp.finances.ui.viewmodel.voucherExportAddress
import ch.brickinventoryapp.finances.ui.viewmodel.voucherPdfAddress
import ch.brickinventoryapp.finances.ui.viewmodel.pdfMaySavedBecome
import ch.brickinventoryapp.finances.ui.viewmodel.showsVouchers
import ch.brickinventoryapp.data.util.PDF_CONFIDENTIAL_FOLDER
import ch.brickinventoryapp.data.util.pdfAblage
import ch.brickinventoryapp.data.util.raeumeVertraulichePdfsAuf
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.Quellen

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
 *   A  in pdfAblage() `vertraulich` ignored (always cacheDir) → red “a
 *      voucher PDF gets no file …”
 *   D  pdfMaySavedBecome() always true → red “a
 *      voucher PDF cannot be downloaded …”
 *   E  in PdfViewerScreen the `if (speicherbar)` around the button removed
 *      → red “viewer, sign-out and start clean up” (button unprotected)
 *   F  in pdfAblage() back to `pdfUrl.hashCode()` as the name → red
 *      “the file name depends on the whole address …”
 *   G  showsVouchers() back to `"/api/v1/vouchers/" in pdfUrl` →
 *      red “vouchers are recognized by the path …”
 * Counter-checks:
 *   H  pdfAblage() also returns a cache file for confidential PDFs
 *      → red “a voucher PDF gets no file …”;
 *      gegenproben/gutschein-pdf-auf-platte.patch
 *   I  in the loader (then PdfViewerScreen) `if (ablage == null)` replaced with `if (false)` → red
 *      “viewer, sign-out and start clean up” (memory path not taken)
 * Counter-checks:
 *   J  in PdfViewerScreen the print button pulled ahead of `if (speicherbar)` → red
 *      “viewer, sign-out and start clean up” (printing unprotected);
 *      gegenproben/gutschein-drucken.patch
 *   K  in logout() the line `raeumeAnleitungenAuf(` removed → red “viewer,
 *      sign-out and start clean up” (instruction manuals survive signing out)
 */
class VoucherPdfStoreTest {

    private val cache = File(System.getProperty("java.io.tmpdir"), "bim-pdf-${System.nanoTime()}").apply { mkdirs() }
    private val gutschein = voucherPdfAddress("https://brick.example", 7)
    private val anleitung = "https://brick.example/api/v1/instructions/42/file"

    @After
    fun zu() { cache.deleteRecursively() }

    private fun anlegen(f: File) = f.apply { parentFile!!.mkdirs(); writeText("PIN 1234") }

    @Test
    fun `a voucher PDF gets no file, an instruction lies in the cache`() {
        assertNull(pdfAblage(cache, gutschein, showsVouchers(gutschein)))
        assertNull(pdfAblage(cache, voucherExportAddress("https://brick.example/"), true))
        assertEquals(cache, pdfAblage(cache, anleitung, showsVouchers(anleitung))?.parentFile)
    }

    /** Two addresses with the same hashCode() would otherwise have shared one file. */
    @Test
    fun `the file name depends on the whole address, not on 32 bits`() {
        val x = "https://brick.example/api/v1/vouchers/Aa/pdf"
        val y = "https://brick.example/api/v1/vouchers/BB/pdf"
        assertEquals("Die Probe braucht zwei Adressen mit gleichem hashCode()", x.hashCode(), y.hashCode())
        assertTrue(pdfAblage(cache, x, false) != pdfAblage(cache, y, false))
        assertEquals("anleitung_e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855.bin", pdfAblage(cache, "", false)?.name)
    }

    @Test
    fun `the path recognizes vouchers, also in a different spelling`() {
        assertTrue(showsVouchers("https://brick.example/API/v1/Vouchers/7/pdf"))
        assertTrue(showsVouchers("https://brick.example/api/v1/%76ouchers/7/pdf"))
        assertTrue(showsVouchers("https://brick.example/brick/api//v1/vouchers/export/pdf"))
        assertTrue("Was sich nicht lesen lässt, gilt als vertraulich", showsVouchers("https://brick example/x y"))
        assertFalse(showsVouchers(anleitung))
        assertFalse("Die Abfrage ist kein Pfad", showsVouchers("$anleitung?von=/api/v1/vouchers/7"))
    }

    /** Voucher PDFs that older versions placed in their own folder. */
    @Test
    fun `sign-out and start empty the folder, instructions stay`() {
        val g = anlegen(File(File(cache, PDF_CONFIDENTIAL_FOLDER), "pdfview_alt.pdf"))
        val a = anlegen(pdfAblage(cache, anleitung, false)!!)
        raeumeVertraulichePdfsAuf(cache)
        assertFalse(g.exists())
        assertFalse(File(cache, PDF_CONFIDENTIAL_FOLDER).exists())
        assertTrue(a.exists())
    }

    @Test
    fun `a voucher PDF cannot be downloaded, an instruction can`() {
        assertFalse(pdfMaySavedBecome(gutschein))
        assertFalse(pdfMaySavedBecome(voucherExportAddress("https://brick.example/")))
        assertTrue(pdfMaySavedBecome(anleitung))
    }

    @Test
    fun `viewer, sign-out and start clean up`() {
        val viewer = Quellen.withoutComments(Quellen.lies("finances/ui/screens/PdfViewerScreen.kt"))
        // Loading and holding have lived in the loader and the ViewModel since M1.
        val lader = Quellen.withoutComments(Quellen.lies("finances/ui/pdf/AnleitungsLader.kt") + Quellen.lies("finances/ui/pdf/PdfQuelle.kt") +
            Quellen.lies("data/AnleitungsRepository.kt"))
        val vm = Quellen.withoutComments(Quellen.lies("finances/ui/viewmodel/PdfBetrachterViewModel.kt"))
        assertTrue("Der Betrachter legt nicht über pdfAblage() ab", lader.contains("pdfAblage(ctx.cacheDir, pdfUrl, vertraulich)"))
        assertTrue("Ohne Datei nimmt der Betrachter nicht den Weg über den Speicher",
            Regex("""if \(ablage == null\) \{\s*ladeInDenSpeicherUndZaehle\(""").containsMatchIn(lader))
        assertTrue("Der Speicherweg lädt nicht über ladePdfInDenSpeicher()", lader.contains("ladePdfInDenSpeicher(ladeClient(httpClient), url"))
        assertTrue("Das Gutschein-PDF liegt nicht in einem memfd", lader.contains("Os.memfd_create("))
        assertTrue("Der Speicherbereich bleibt nach dem Verlassen offen",
            Regex("""override fun onCleared\(\)\s*\{\s*offen\.close\(\)""").containsMatchIn(vm))
        assertTrue("Herunterladen steht ohne Prüfung da",
            Regex("""if \(speicherbar\) \{\s*((?:ch\.brickinventoryapp\.ui\.components\.)?MitTooltip\([^\n]*\{\s*)?IconButton\(onClick = \{ (melde\()?savePdfToDownloads\(""").containsMatchIn(viewer))
        // The print dialog offers „Als PDF speichern“: printing only where saving is also allowed.
        val geschuetzt = viewer.substringAfter("if (speicherbar) {").substringBefore("\n                    }\n")
        assertTrue("Drucken steht ohne Prüfung da", viewer.split("printPdf(ctx,").size == 2 && "printPdf(ctx," in geschuetzt)
        val abmelden = Quellen.function(Quellen.withoutComments(Quellen.lies("data/SitzungsBereinigung.kt")), "suspend fun raeumeAuf(")
        assertTrue("Abmelden lässt Gutschein-PDFs liegen", abmelden.contains("raeumeVertraulichePdfsAuf("))
        assertTrue("Abmelden lässt Anleitungen liegen", abmelden.contains("raeumeAnleitungenAuf(ctx.cacheDir)"))
        assertTrue("Abmelden lässt Teileliste und Update in filesDir liegen",
            abmelden.contains("raeumeKontoDateienAuf(ctx.filesDir, ctx.getExternalFilesDir(null))"))
        val start = Quellen.lies("app/BrickInventoryApp.kt")
        assertTrue("Der Start räumt Reste nicht weg", start.contains("raeumeVertraulichePdfsAuf(cacheDir)"))
        assertTrue("Der Start lässt Klartext-Anleitungen liegen", start.contains("raeumeKlartextAnleitungenAuf(cacheDir)"))
    }
}
