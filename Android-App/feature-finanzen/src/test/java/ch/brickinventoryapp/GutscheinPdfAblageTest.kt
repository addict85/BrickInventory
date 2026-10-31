package ch.brickinventoryapp

import ch.brickinventoryapp.ui.viewmodel.gutscheinPdfAdresse
import ch.brickinventoryapp.ui.viewmodel.zeigtGutscheine
import ch.brickinventoryapp.util.PDF_VERTRAULICH_ORDNER
import ch.brickinventoryapp.util.pdfAblage
import ch.brickinventoryapp.util.raeumeVertraulichePdfsAuf
import ch.brickinventoryapp.util.vergissPdf
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Ein Gutschein-PDF (Nummer und PIN) bleibt nicht im Zwischenspeicher liegen:
 * Es kommt in einen eigenen Ordner, verschwindet beim Verlassen des Betrachters
 * samt Teildatei und beim Abmelden und Start ganz. Anleitungen bleiben.
 *
 * Ausgeführt: Ablage und Löschen gegen ein echtes Verzeichnis. Dass der
 * Betrachter, das Abmelden und der Start sie rufen, braucht ein Gerät; das
 * hält die Struktur-Prüfung unten fest.
 *
 * Gegenproben (30.10.2026, gemessen mit kt-b2/bau.sh):
 *   A  in pdfAblage() `vertraulich` übergangen (immer cacheDir) → rot „ein
 *      Gutschein-PDF liegt abseits der Anleitungen“ und „Abmelden und Start
 *      leeren den Ordner …“
 *   B  in vergissPdf() die Teildatei nicht gelöscht → rot „Verlassen löscht
 *      das PDF samt Teildatei …“
 *   C  im PdfViewerScreen das `onDispose { … vergissPdf(ablage) }` entfernt →
 *      rot „Betrachter, Abmelden und Start räumen auf“
 */
class GutscheinPdfAblageTest {

    private val cache = File(System.getProperty("java.io.tmpdir"), "bim-pdf-${System.nanoTime()}").apply { mkdirs() }
    private val gutschein = gutscheinPdfAdresse("https://brick.example", 7)
    private val anleitung = "https://brick.example/api/v1/instructions/42/file"

    @After
    fun zu() { cache.deleteRecursively() }

    private fun anlegen(f: File) = f.apply { parentFile.mkdirs(); writeText("PIN 1234") }

    @Test
    fun `ein Gutschein-PDF liegt abseits der Anleitungen`() {
        val g = pdfAblage(cache, gutschein, zeigtGutscheine(gutschein))
        val a = pdfAblage(cache, anleitung, zeigtGutscheine(anleitung))
        assertEquals(File(cache, PDF_VERTRAULICH_ORDNER), g.parentFile)
        // Die Anleitung behält ihren Namen: Ein schon geladener Zwischenspeicher bleibt gültig.
        assertEquals(File(cache, "pdfview_${anleitung.hashCode()}.pdf"), a)
    }

    @Test
    fun `Verlassen loescht das PDF samt Teildatei, ein anderes bleibt`() {
        val g = anlegen(pdfAblage(cache, gutschein, true))
        val teil = anlegen(File(g.path + ".part"))
        val anderer = anlegen(pdfAblage(cache, gutscheinPdfAdresse("https://brick.example", 8), true))
        vergissPdf(g)
        assertFalse(g.exists())
        assertFalse(teil.exists())
        assertTrue("Das PDF eines anderen, noch offenen Betrachters bleibt", anderer.exists())
    }

    @Test
    fun `Abmelden und Start leeren den Ordner, Anleitungen bleiben`() {
        val g = anlegen(pdfAblage(cache, gutschein, true))
        val a = anlegen(pdfAblage(cache, anleitung, false))
        raeumeVertraulichePdfsAuf(cache)
        assertFalse(g.exists())
        assertFalse(File(cache, PDF_VERTRAULICH_ORDNER).exists())
        assertTrue(a.exists())
    }

    @Test
    fun `Betrachter, Abmelden und Start raeumen auf`() {
        val betrachter = Quellen.ohneKommentare(Quellen.lies("ui/screens/PdfViewerScreen.kt"))
        assertTrue("Der Betrachter löscht ein Gutschein-PDF beim Verlassen nicht",
            Regex("""onDispose\s*\{\s*if \(vertraulich\) vergissPdf\(ablage\)""").containsMatchIn(betrachter))
        assertTrue("Der Betrachter legt nicht über pdfAblage() ab", betrachter.contains("pdfAblage(ctx.cacheDir, pdfUrl, vertraulich)"))
        val abmelden = Quellen.funktion(Quellen.ohneKommentare(Quellen.lies("ui/AppViewModel.kt")), "fun logout(")
        assertTrue("Abmelden lässt Gutschein-PDFs liegen", abmelden.contains("raeumeVertraulichePdfsAuf("))
        assertTrue("Der Start räumt Reste nicht weg",
            Quellen.lies("BrickInventoryApp.kt").contains("raeumeVertraulichePdfsAuf(cacheDir)"))
    }
}
