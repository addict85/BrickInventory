package ch.brickinventoryapp

import ch.brickinventoryapp.ui.viewmodel.gutscheinExportAdresse
import ch.brickinventoryapp.ui.viewmodel.gutscheinPdfAdresse
import ch.brickinventoryapp.ui.viewmodel.pdfDarfGespeichertWerden
import ch.brickinventoryapp.ui.viewmodel.zeigtGutscheine
import ch.brickinventoryapp.util.PDF_VERTRAULICH_ORDNER
import ch.brickinventoryapp.util.pdfAblage
import ch.brickinventoryapp.util.raeumeVertraulichePdfsAuf
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Ein Gutschein-PDF (Nummer und PIN) kommt nie auf die Platte (sec11 N1): Der
 * Betrachter bekommt dafür keine Datei, lädt in den Speicher und rendert aus einem
 * memfd. Was ältere Fassungen in ihren Ordner legten, verschwindet beim Abmelden und
 * Start. Anleitungen bleiben im Zwischenspeicher.
 *
 * Ausgeführt: Ablage und Löschen gegen ein echtes Verzeichnis; das Laden in den
 * Speicher prüft PdfImSpeicherTest (core-data). Dass der Betrachter diesen Weg nimmt,
 * braucht ein Gerät; das hält die Struktur-Prüfung unten fest.
 *
 * Gegenproben (30.10.2026, gemessen mit kt-b2/bau.sh; B und C galten der Datei, die
 * es seit sec11 nicht mehr gibt):
 *   A  in pdfAblage() `vertraulich` übergangen (immer cacheDir) → rot „ein
 *      Gutschein-PDF bekommt keine Datei …“
 *   D  (01.11.2026) pdfDarfGespeichertWerden() immer true → rot „ein
 *      Gutschein-PDF laesst sich nicht herunterladen …“
 *   E  (01.11.2026) im PdfViewerScreen `if (speicherbar)` um den Knopf entfernt
 *      → rot „Betrachter, Abmelden und Start räumen auf“ (Knopf ungeschützt)
 *   F  (02.11.2026) in pdfAblage() wieder `pdfUrl.hashCode()` als Name → rot
 *      „der Dateiname haengt an der ganzen Adresse …“
 *   G  (02.11.2026) zeigtGutscheine() wieder `"/api/v1/vouchers/" in pdfUrl` →
 *      rot „Gutscheine erkennt der Pfad …“
 * Gegenproben (04.11.2026, gemessen mit kotlinc lokal; sec11 N1):
 *   H  pdfAblage() gibt auch für vertrauliche PDFs eine Datei im Zwischenspeicher
 *      → rot „ein Gutschein-PDF bekommt keine Datei …“;
 *      gegenproben/gutschein-pdf-auf-platte.patch
 *   I  im PdfViewerScreen `if (ablage == null)` durch `if (false)` ersetzt → rot
 *      „Betrachter, Abmelden und Start raeumen auf“ (Speicherweg nicht gewählt)
 */
class GutscheinPdfAblageTest {

    private val cache = File(System.getProperty("java.io.tmpdir"), "bim-pdf-${System.nanoTime()}").apply { mkdirs() }
    private val gutschein = gutscheinPdfAdresse("https://brick.example", 7)
    private val anleitung = "https://brick.example/api/v1/instructions/42/file"

    @After
    fun zu() { cache.deleteRecursively() }

    private fun anlegen(f: File) = f.apply { parentFile.mkdirs(); writeText("PIN 1234") }

    @Test
    fun `ein Gutschein-PDF bekommt keine Datei, eine Anleitung liegt im Zwischenspeicher`() {
        assertNull(pdfAblage(cache, gutschein, zeigtGutscheine(gutschein)))
        assertNull(pdfAblage(cache, gutscheinExportAdresse("https://brick.example/"), true))
        assertEquals(cache, pdfAblage(cache, anleitung, zeigtGutscheine(anleitung))?.parentFile)
    }

    /** Zwei Adressen mit gleichem hashCode() teilten sich sonst eine Datei. */
    @Test
    fun `der Dateiname haengt an der ganzen Adresse, nicht an 32 Bit`() {
        val x = "https://brick.example/api/v1/vouchers/Aa/pdf"
        val y = "https://brick.example/api/v1/vouchers/BB/pdf"
        assertEquals("Die Probe braucht zwei Adressen mit gleichem hashCode()", x.hashCode(), y.hashCode())
        assertTrue(pdfAblage(cache, x, false) != pdfAblage(cache, y, false))
        assertEquals("pdfview_e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855.pdf", pdfAblage(cache, "", false)?.name)
    }

    @Test
    fun `Gutscheine erkennt der Pfad, auch in anderer Schreibweise`() {
        assertTrue(zeigtGutscheine("https://brick.example/API/v1/Vouchers/7/pdf"))
        assertTrue(zeigtGutscheine("https://brick.example/api/v1/%76ouchers/7/pdf"))
        assertTrue(zeigtGutscheine("https://brick.example/brick/api//v1/vouchers/export/pdf"))
        assertTrue("Was sich nicht lesen lässt, gilt als vertraulich", zeigtGutscheine("https://brick example/x y"))
        assertFalse(zeigtGutscheine(anleitung))
        assertFalse("Die Abfrage ist kein Pfad", zeigtGutscheine("$anleitung?von=/api/v1/vouchers/7"))
    }

    /** Gutschein-PDFs, die ältere Fassungen im eigenen Ordner ablegten. */
    @Test
    fun `Abmelden und Start leeren den Ordner, Anleitungen bleiben`() {
        val g = anlegen(File(File(cache, PDF_VERTRAULICH_ORDNER), "pdfview_alt.pdf"))
        val a = anlegen(pdfAblage(cache, anleitung, false)!!)
        raeumeVertraulichePdfsAuf(cache)
        assertFalse(g.exists())
        assertFalse(File(cache, PDF_VERTRAULICH_ORDNER).exists())
        assertTrue(a.exists())
    }

    @Test
    fun `ein Gutschein-PDF laesst sich nicht herunterladen, eine Anleitung schon`() {
        assertFalse(pdfDarfGespeichertWerden(gutschein))
        assertFalse(pdfDarfGespeichertWerden(gutscheinExportAdresse("https://brick.example/")))
        assertTrue(pdfDarfGespeichertWerden(anleitung))
    }

    @Test
    fun `Betrachter, Abmelden und Start raeumen auf`() {
        val betrachter = Quellen.ohneKommentare(Quellen.lies("ui/screens/PdfViewerScreen.kt"))
        assertTrue("Der Betrachter legt nicht über pdfAblage() ab", betrachter.contains("pdfAblage(ctx.cacheDir, pdfUrl, vertraulich)"))
        assertTrue("Ohne Datei nimmt der Betrachter nicht den Weg über den Speicher",
            Regex("""if \(ablage == null\) \{\s*ladeInDenSpeicherUndZaehle\(""").containsMatchIn(betrachter))
        assertTrue("Der Speicherweg lädt nicht über ladePdfInDenSpeicher()", betrachter.contains("ladePdfInDenSpeicher(ladeClient(httpClient), url)"))
        assertTrue("Das Gutschein-PDF liegt nicht in einem memfd", betrachter.contains("Os.memfd_create("))
        assertTrue("Der Speicherbereich bleibt nach dem Verlassen offen",
            Regex("""onDispose\s*\{\s*offen\.close\(\)""").containsMatchIn(betrachter))
        assertTrue("Herunterladen steht ohne Prüfung da",
            Regex("""if \(speicherbar\) \{\s*IconButton\(onClick = \{ savePdfToDownloads\(""").containsMatchIn(betrachter))
        val abmelden = Quellen.funktion(Quellen.ohneKommentare(Quellen.lies("ui/AppViewModel.kt")), "fun logout(")
        assertTrue("Abmelden lässt Gutschein-PDFs liegen", abmelden.contains("raeumeVertraulichePdfsAuf("))
        assertTrue("Abmelden lässt Teileliste und Update in filesDir liegen",
            abmelden.contains("raeumeKontoDateienAuf(ctx.filesDir, ctx.getExternalFilesDir(null))"))
        assertTrue("Der Start räumt Reste nicht weg",
            Quellen.lies("BrickInventoryApp.kt").contains("raeumeVertraulichePdfsAuf(cacheDir)"))
    }
}
