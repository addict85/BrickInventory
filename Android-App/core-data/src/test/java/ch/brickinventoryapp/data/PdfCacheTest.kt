package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.util.PdfStep
import ch.brickinventoryapp.data.util.pdfStep
import org.junit.Test

/**
 * A fully loaded instruction is not „resumed": after a complete
 * download `Range: bytes=<size>-` pointed behind the last byte, and the server
 * rightly answers with 416 (via the instruction route as 404). The decision
 * „finished or from which byte" is therefore a pure function and executed here;
 * the server half is checked by Web-App/test/instruction-area.test.js.
 *
 * Counter-check: in pdfStep() the first branch removed, so that a finished file
 * again counts as a resume point → the first step below turns red.
 */
class PdfCacheTest {

    @Test
    fun `a finished instruction is not requested again`() {
        // THE case from the report: 12 MB lie there finished.
        val s = pdfStep(finishedSize = 12_000_000L, partSize = 0L)
        assert(s is PdfStep.Done) {
            "Eine vollstaendige Anleitung ergab $s. Damit schickt der Viewer " +
                "wieder einen Bereich hinter dem Dateiende — genau Marcos 404."
        }
    }

    @Test
    fun `a partial file is resumed at its end`() {
        // The case resuming exists for at all: the connection
        // broke off at 3 MB. If this step fails, every aborted
        // 300 MB instruction loads from the start again.
        val s = pdfStep(finishedSize = 0L, partSize = 3_000_000L)
        assert(s == PdfStep.Fetch(3_000_000L)) { "Teildatei ergab $s statt Fetch(3000000)" }
    }

    @Test
    fun `without anything it loads from the start`() {
        val s = pdfStep(finishedSize = 0L, partSize = 0L)
        assert(s == PdfStep.Fetch(0L)) { "Leerer Cache ergab $s statt Fetch(0)" }
    }

    @Test
    fun `a partial file next to the finished one changes nothing`() {
        // Can happen if a second download was started while
        // the first was already finished. The finished file wins; the partial file
        // is cleaned away by prunePdfCache.
        val s = pdfStep(finishedSize = 12_000_000L, partSize = 3_000_000L)
        assert(s is PdfStep.Done) { "Fertig + Teildatei ergab $s" }
    }
}
