package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.service.PdfFehlschlag
import ch.brickinventoryapp.data.service.fehlerText
import ch.brickinventoryapp.data.service.fortschrittText
import ch.brickinventoryapp.model.fach.PdfFortschritt
import ch.brickinventoryapp.model.fach.PdfSchritt
import ch.brickinventoryapp.ressourcen.R
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Die Benachrichtigung des PDF-Dienstes bildet ihre Sätze aus Fachwerten: Kein
 * Fehler bleibt ohne Satz, auch wenn der Server keinen schickte.
 *
 * Gegenprobe (gegenproben/pdf-dienst-fehler-leer.patch, nur in der CI messbar):
 *   fehlerText() gibt für einen Abruf nur `fehler.message` zurück → rot „jeder Fehler
 *   hat einen Satz …“ (Netz, Zeitüberschreitung, Server ohne Satz sind leer)
 */
class PdfDienstTexteTest {

    private val satz: (Int, List<Any>) -> String = { id, args -> "t$id" + args.joinToString("") { ":$it" } }

    @Test
    fun `jeder Fehler hat einen Satz, ohne Satz des Servers aus Code oder Art`() {
        val ohneSatz = listOf(
            Ergebnis.Error.Netz(), Ergebnis.Error.Zeitueberschreitung, Ergebnis.Error.Abgebrochen,
            Ergebnis.Error.LeereAntwort(), Ergebnis.Error.Abgewiesen(), Ergebnis.Error.Server(503),
            Ergebnis.Error.Klartext, Ergebnis.Error.Unbekannt("socket closed"),
        )
        for (f in ohneSatz) assertTrue("$f ohne Satz", fehlerText(PdfFehlschlag.Abruf(f), satz).isNotBlank())
        assertEquals("t${R.string.err_network}", fehlerText(PdfFehlschlag.Abruf(Ergebnis.Error.Netz()), satz))
        assertEquals("t${R.string.pdfexp_http_error}:503", fehlerText(PdfFehlschlag.Abruf(Ergebnis.Error.Server(503)), satz))
        assertEquals("zu viele", fehlerText(PdfFehlschlag.Abruf(Ergebnis.Error.Server(429, "zu viele")), satz))
        assertEquals("t${R.string.pdfexp_server_error}", fehlerText(PdfFehlschlag.Auftrag(null), satz))
        assertEquals("Bild fehlt", fehlerText(PdfFehlschlag.Auftrag("Bild fehlt"), satz))
    }

    @Test
    fun `die Restzeit steht nur da, solange sie bleibt`() {
        assertEquals("t${R.string.pdfexp_creating_eta}:12", fortschrittText(PdfFortschritt(PdfSchritt.ERSTELLT, 12), satz))
        assertEquals("t${R.string.pdfexp_almost_done}", fortschrittText(PdfFortschritt(PdfSchritt.ERSTELLT, 0), satz))
        assertEquals("t${R.string.pdfexp_downloading}", fortschrittText(PdfFortschritt(PdfSchritt.HERUNTERLADEN), satz))
    }
}
