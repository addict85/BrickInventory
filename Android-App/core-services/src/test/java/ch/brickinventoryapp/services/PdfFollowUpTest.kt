package ch.brickinventoryapp.services

import androidx.work.ListenableWorker
import ch.brickinventoryapp.dataapi.parts.PdfFailure
import ch.brickinventoryapp.model.domain.PdfProgress
import ch.brickinventoryapp.model.domain.PdfStep
import ch.brickinventoryapp.services.service.PdfExportState
import ch.brickinventoryapp.services.service.PdfFollowUp
import ch.brickinventoryapp.services.service.PdfNotifier
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

/**
 * One run of the PDF worker without Android: the bar while the server builds the PDF, then
 * exactly one final notification; an export replaced by a newer one reports nothing.
 *
 * Counter-checks (patches under counter-checks/):
 *   pdf-worker-done-silent  Done no longer calls ready() → red „a finished export posts …“
 *   pdf-worker-bar-stays    clearProgress() taken out of finally → red „a cancelled run …“
 */
class PdfFollowUpTest {

    private class Recorder : PdfNotifier {
        val seen = mutableListOf<String>()
        override fun progress(progress: PdfProgress) { seen += "progress ${progress.step}" }
        override fun ready() { seen += "ready" }
        override fun failed(reason: PdfFailure) { seen += "failed $reason" }
        override fun clearProgress() { seen += "clear" }
    }

    private val state = MutableStateFlow<PdfExportState>(PdfExportState.Running(PdfProgress(PdfStep.IMAGES_LOAD)))

    private fun ending(end: PdfExportState): suspend (String) -> PdfExportState = { delay(1_000); end }

    @Test
    fun `a finished export posts the tap notification once and removes the bar`() = runTest {
        val n = Recorder()
        var asked: String? = null
        val result = PdfFollowUp({ id -> asked = id; ending(PdfExportState.Done(File("parts.pdf")))(id) }, state, n)
            .run("job-7")
        assertEquals("job-7", asked)
        assertEquals(listOf("progress IMAGES_LOAD", "ready", "clear"), n.seen)
        assertEquals(ListenableWorker.Result.success(), result)
    }

    @Test
    fun `a failed export says why`() = runTest {
        val n = Recorder()
        PdfFollowUp(ending(PdfExportState.Error(PdfFailure.Job("image missing"))), state, n).run("job-7")
        assertEquals(listOf("progress IMAGES_LOAD", "failed ${PdfFailure.Job("image missing")}", "clear"), n.seen)
    }

    @Test
    fun `a replaced export reports nothing, its successor does`() = runTest {
        val n = Recorder()
        PdfFollowUp(ending(PdfExportState.Idle), state, n).run("job-7")
        assertEquals(listOf("progress IMAGES_LOAD", "clear"), n.seen)
    }

    @Test
    fun `without a job id the run fails and posts nothing`() = runTest {
        val n = Recorder()
        val result = PdfFollowUp(ending(PdfExportState.Idle), state, n).run(null)
        assertEquals(ListenableWorker.Result.failure(), result)
        assertEquals(emptyList<String>(), n.seen)
    }

    @Test
    fun `a cancelled run removes its bar and posts no result`() = runTest {
        val n = Recorder()
        val run = launch { PdfFollowUp({ awaitCancellation() }, state, n).run("job-7") }
        advanceTimeBy(5_000)
        run.cancel()
        run.join()
        assertEquals("a replaced or stopped worker left the ongoing bar", listOf("progress IMAGES_LOAD", "clear"), n.seen)
    }
}
