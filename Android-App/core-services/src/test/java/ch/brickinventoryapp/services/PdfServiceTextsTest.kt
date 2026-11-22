package ch.brickinventoryapp.services

import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.data.service.PdfFailure
import ch.brickinventoryapp.model.domain.PdfProgress
import ch.brickinventoryapp.model.domain.PdfStep
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.services.service.errorText
import ch.brickinventoryapp.services.service.progressText
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The PDF service's notification builds its strings from field values: no
 * error is left without a string, even when the server sent none.
 *
 * Counter-check (counter-checks/pdf-dienst-fehler-leer.patch, measured with kotlinc):
 *   errorText() always uses `error.message` for a fetch error → red „jeder Fehler hat einen Satz …“ with „Netz(technisch=null) ohne Satz“
 */
class PdfServiceTextsTest {

    private val sentence: (Int, List<Any>) -> String = { id, args -> "t$id" + args.joinToString("") { ":$it" } }

    @Test
    fun `every error has a sentence, without the server's sentence from code or kind`() {
        val withoutSet = listOf(
            Outcome.Failure.Network(), Outcome.Failure.Timeout, Outcome.Failure.Cancelled,
            Outcome.Failure.EmptyResponse(), Outcome.Failure.Rejected(), Outcome.Failure.Server(503),
            Outcome.Failure.Plaintext, Outcome.Failure.Unknown("socket closed"),
        )
        for (f in withoutSet) assertTrue("$f ohne Satz", errorText(PdfFailure.Fetch(f), sentence).isNotBlank())
        assertEquals("t${R.string.err_network}", errorText(PdfFailure.Fetch(Outcome.Failure.Network()), sentence))
        assertEquals("t${R.string.pdfexp_http_error}:503", errorText(PdfFailure.Fetch(Outcome.Failure.Server(503)), sentence))
        assertEquals("zu viele", errorText(PdfFailure.Fetch(Outcome.Failure.Server(429, "zu viele")), sentence))
        assertEquals("t${R.string.pdfexp_server_error}", errorText(PdfFailure.Job(null), sentence))
        assertEquals("Bild fehlt", errorText(PdfFailure.Job("Bild fehlt"), sentence))
    }

    @Test
    fun `the remaining time is shown only while it lasts`() {
        assertEquals("t${R.string.pdfexp_creating_eta}:12", progressText(PdfProgress(PdfStep.CREATED, 12), sentence))
        assertEquals("t${R.string.pdfexp_almost_done}", progressText(PdfProgress(PdfStep.CREATED, 0), sentence))
        assertEquals("t${R.string.pdfexp_downloading}", progressText(PdfProgress(PdfStep.DOWNLOAD), sentence))
    }
}
