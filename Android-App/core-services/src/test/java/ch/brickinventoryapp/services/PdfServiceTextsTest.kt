package ch.brickinventoryapp.services

import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.service.PdfFailure
import ch.brickinventoryapp.services.service.errorText
import ch.brickinventoryapp.services.service.progressText
import ch.brickinventoryapp.model.domain.PdfProgress
import ch.brickinventoryapp.model.domain.PdfStep
import ch.brickinventoryapp.resources.R
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The PDF service's notification builds its strings from field values: no
 * error is left without a string, even when the server sent none.
 *
 * Counter-check (gegenproben/pdf-dienst-fehler-leer.patch, measured with kotlinc):
 *   errorText() always uses `fehler.message` for a fetch error → red „jeder Fehler
 *   hat einen Satz …“ with „Netz(technisch=null) ohne Satz“
 */
class PdfServiceTextsTest {

    private val satz: (Int, List<Any>) -> String = { id, args -> "t$id" + args.joinToString("") { ":$it" } }

    @Test
    fun `every error has a sentence, without the server's sentence from code or kind`() {
        val withoutSet = listOf(
            Ergebnis.Fehler.Netz(), Ergebnis.Fehler.Zeitueberschreitung, Ergebnis.Fehler.Abgebrochen,
            Ergebnis.Fehler.LeereAntwort(), Ergebnis.Fehler.Abgewiesen(), Ergebnis.Fehler.Server(503),
            Ergebnis.Fehler.Klartext, Ergebnis.Fehler.Unbekannt("socket closed"),
        )
        for (f in withoutSet) assertTrue("$f ohne Satz", errorText(PdfFailure.Abruf(f), satz).isNotBlank())
        assertEquals("t${R.string.err_network}", errorText(PdfFailure.Abruf(Ergebnis.Fehler.Netz()), satz))
        assertEquals("t${R.string.pdfexp_http_error}:503", errorText(PdfFailure.Abruf(Ergebnis.Fehler.Server(503)), satz))
        assertEquals("zu viele", errorText(PdfFailure.Abruf(Ergebnis.Fehler.Server(429, "zu viele")), satz))
        assertEquals("t${R.string.pdfexp_server_error}", errorText(PdfFailure.Auftrag(null), satz))
        assertEquals("Bild fehlt", errorText(PdfFailure.Auftrag("Bild fehlt"), satz))
    }

    @Test
    fun `the remaining time is shown only while it lasts`() {
        assertEquals("t${R.string.pdfexp_creating_eta}:12", progressText(PdfProgress(PdfStep.CREATED, 12), satz))
        assertEquals("t${R.string.pdfexp_almost_done}", progressText(PdfProgress(PdfStep.CREATED, 0), satz))
        assertEquals("t${R.string.pdfexp_downloading}", progressText(PdfProgress(PdfStep.DOWNLOAD), satz))
    }
}
