package ch.brickinventoryapp.services

import androidx.work.ListenableWorker
import ch.brickinventoryapp.data.CsvImportSseClient
import ch.brickinventoryapp.model.domain.CsvImportStatusView
import ch.brickinventoryapp.model.domain.RunStatus
import ch.brickinventoryapp.model.outcome.Outcome
import ch.brickinventoryapp.services.service.CsvImportWatch
import ch.brickinventoryapp.services.service.CsvNotifier
import ch.brickinventoryapp.services.service.toWorkResult
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The CSV worker's watch, executed with virtual time: it ends a run before WorkManager's
 * ten-minute stop and asks for a retry, falls back to polling, and only a finished import
 * leaves a notification behind; an ongoing bar never outlives the run.
 *
 * Counter-checks (patches under counter-checks/):
 *   csv-worker-no-retry    OUT_OF_TIME maps to success() → red „an import that outlasts the budget …“
 *   csv-worker-leaves-bar  run() no longer clears on cancellation → red „a cancelled watch …“
 */
@OptIn(ExperimentalCoroutinesApi::class)
class CsvImportWatchTest {

    private class Recorder : CsvNotifier {
        val seen = mutableListOf<String>()
        override fun started() { seen += "started" }
        override fun progress(status: CsvImportStatusView) { seen += "progress ${status.done}" }
        override fun finished() { seen += "finished" }
        override fun clear() { seen += "clear" }
    }

    private fun status(s: RunStatus, done: Int = 0) = CsvImportStatusView(status = s, total = 3, done = done)
    private fun event(s: RunStatus, done: Int = 0) = CsvImportSseClient.Event.Status(status(s, done))

    private fun TestScope.watch(
        stream: () -> Flow<CsvImportSseClient.Event>,
        notifier: Recorder,
        poll: suspend () -> Outcome<CsvImportStatusView> = { Outcome.Failure.Network() },
    ) = CsvImportWatch(stream, poll, notifier) { testScheduler.currentTime }

    @Test
    fun `a finished import posts the final notification and ends the work`() = runTest {
        val n = Recorder()
        val end = watch({ flowOf(event(RunStatus.RUNNING, 1), event(RunStatus.RUNNING, 2), event(RunStatus.IDLE)) }, n)
            .run(BUDGET)
        assertEquals(CsvImportWatch.End.FINISHED, end)
        assertEquals(listOf("started", "progress 1", "progress 2", "finished"), n.seen)
        assertEquals(ListenableWorker.Result.success(), end.toWorkResult())
    }

    @Test
    fun `an import that outlasts the budget hands over to a retry without an ongoing bar`() = runTest {
        val n = Recorder()
        val forever = flow { while (true) { emit(event(RunStatus.RUNNING, 1)); delay(1_000) } }
        val end = watch({ forever }, n).run(BUDGET)
        assertEquals(CsvImportWatch.End.OUT_OF_TIME, end)
        assertEquals("the run ends at the budget, not at the system's stop", BUDGET, testScheduler.currentTime)
        assertEquals("the next run must follow the same import", ListenableWorker.Result.retry(), end.toWorkResult())
        assertEquals("clear", n.seen.last())
    }

    @Test
    fun `without SSE the poll fallback finds the end`() = runTest {
        val n = Recorder()
        val answers = ArrayDeque(listOf(status(RunStatus.RUNNING, 2), status(RunStatus.DONE, 3)))
        val end = watch({ flowOf(CsvImportSseClient.Event.Failed("gone")) }, n) { Outcome.Success(answers.removeFirst()) }
            .run(BUDGET)
        assertEquals(CsvImportWatch.End.FINISHED, end)
        assertEquals(listOf("started", "progress 2", "finished"), n.seen)
    }

    @Test
    fun `an unreachable server ends quietly instead of retrying forever`() = runTest {
        val n = Recorder()
        val end = watch({ flowOf(CsvImportSseClient.Event.Failed("gone")) }, n).run(BUDGET)
        assertEquals(CsvImportWatch.End.UNREACHABLE, end)
        assertEquals(ListenableWorker.Result.success(), end.toWorkResult())
        assertEquals(listOf("started", "clear"), n.seen)
    }

    @Test
    fun `a cancelled watch removes its bar`() = runTest {
        val n = Recorder()
        val run = launch { watch({ flow { emit(event(RunStatus.RUNNING, 1)); awaitCancellation() } }, n).run(BUDGET) }
        advanceTimeBy(5_000)
        runCurrent()
        run.cancel()
        run.join()
        assertEquals("a stopped or signed-out watch left the ongoing bar", listOf("started", "progress 1", "clear"), n.seen)
    }

    private companion object {
        const val BUDGET = 60_000L
    }
}
