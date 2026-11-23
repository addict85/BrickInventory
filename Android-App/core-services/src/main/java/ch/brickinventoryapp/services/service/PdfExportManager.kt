package ch.brickinventoryapp.services.service

import android.content.Context
import ch.brickinventoryapp.data.collection.SetFilesRepository
import ch.brickinventoryapp.data.di.Scopes
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.data.service.PdfFailure
import ch.brickinventoryapp.data.service.PdfJobStream
import ch.brickinventoryapp.data.util.PartListVault
import ch.brickinventoryapp.model.domain.PartListJob
import ch.brickinventoryapp.model.domain.PdfJobStatus
import ch.brickinventoryapp.model.domain.PdfProgress
import ch.brickinventoryapp.model.domain.PdfStep
import ch.brickinventoryapp.model.domain.RunStatus
import ch.brickinventoryapp.model.util.catchUnlessCancelled
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Job
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.takeWhile
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.math.roundToLong

/** Where the export stands, as field values; the records form parts list and service. */
internal sealed interface PdfExportState {
    data object Idle : PdfExportState
    data class Running(val progress: PdfProgress) : PdfExportState
    data class Done(val file: File) : PdfExportState
    data class Error(val reason: PdfFailure) : PdfExportState
}

/**
 * Controls the PDF export: start the job, wait for completion via SSE (polling
 * as a fallback), download the PDF. The job runs in the application scope, so
 * it survives the screen; the foreground service only keeps the process awake while it does.
 */
@Singleton
internal class PdfExportManager @Inject constructor(
    private val files: SetFilesRepository,
    private val stream: PdfJobStream,
    private val partListVault: PartListVault,
    private val areas: Scopes,
    @param:ApplicationContext private val context: Context,
) {
    private val _state = MutableStateFlow<PdfExportState>(PdfExportState.Idle)
    val state = _state.asStateFlow()

    private var job: Job? = null

    /** A new job replaces a running one; the state immediately switches to „starting“. */
    fun commission(request: PartListJob) {
        job?.cancel()
        _state.value = PdfExportState.Running(PdfProgress(PdfStep.STARTING))
        job = areas.application.launch(areas.io) { runFrom(request) }
    }

    /** Five attempts with a growing pause: the finished PDF is sometimes only ready shortly after the notification. */
    private suspend fun loadPdf(jobId: String): Outcome<ByteArray> {
        var outcome: Outcome<ByteArray> = files.downloadPdf(jobId)
        var pause = 2000L
        repeat(4) {
            if (outcome is Outcome.Success) return outcome
            delay(pause); pause = minOf(pause * 2, 30_000L)
            outcome = files.downloadPdf(jobId)
        }
        return outcome
    }

    suspend fun runFrom(request: PartListJob) {
        catchUnlessCancelled {
            val jobId = when (val r = files.startPdfJob(request)) {
                is Outcome.Success -> r.data
                is Outcome.Failure -> { fail(PdfFailure.Fetch(r)); return }
            }
            _state.value = PdfExportState.Running(PdfProgress(PdfStep.IMAGES_LOAD))
            val jobRun = JobRun()
            // Alongside the waiting, a ticker: from the server's estimate (etaSeconds ≈
            // missing images), the remaining time every second, but only while it's still being created.
            val reason = coroutineScope {
                val ticker = launch {
                    while (isActive) {
                        delay(1000)
                        val deadline = jobRun.deadlineMs
                        if (jobRun.created && deadline > 0L) {
                            val rest = ((deadline - System.currentTimeMillis() + 999) / 1000L).toInt()
                            _state.value = PdfExportState.Running(PdfProgress(PdfStep.CREATED, rest))
                        }
                    }
                }
                try { waitOnJob(jobId, jobRun) } finally { ticker.cancel() }
            }
            if (reason != null) { fail(reason); return }

            _state.value = PdfExportState.Running(PdfProgress(PdfStep.DOWNLOAD))
            when (val r = loadPdf(jobId)) {
                is Outcome.Success -> {
                    val file = partListVault.put(context.filesDir, context.getExternalFilesDir(null), r.data)
                    // Even encrypted, the inventory only stays as long as someone wants to open it.
                    runCatching { PartListsCleaner.plane(context) }
                    _state.value = PdfExportState.Done(file)
                }
                is Outcome.Failure -> fail(PdfFailure.Fetch(r))
            }
        }.onFailure { e -> fail(PdfFailure.Fetch(Outcome.Failure.Unknown(technical = e.message))) }
    }

    private fun fail(reason: PdfFailure) { _state.value = PdfExportState.Error(reason) }

    /** Waits for completion via SSE, otherwise via polling. Null means done, otherwise the reason. */
    private suspend fun waitOnJob(jobId: String, jobRun: JobRun): PdfFailure? {
        var outbox: Outbox? = null
        stream.observe(jobId).takeWhile { e ->
            when (e) {
                is PdfJobStream.Event.State -> { outbox = applyChange(e.state, jobRun); outbox == null }
                PdfJobStream.Event.Gone -> false
                is PdfJobStream.Event.Rejected -> { outbox = Outbox(PdfFailure.Fetch(e.error)); false }
            }
        }.collect { }
        return (outbox ?: questionAbUntilDone(jobId, jobRun)).reason
    }

    /** Null: still running. */
    private fun applyChange(state: PdfJobStatus, jobRun: JobRun): Outbox? {
        jobRun.rememberDeadline(state.restSeconds)
        return when (state.status) {
            RunStatus.DONE -> {
                jobRun.created = false
                _state.value = PdfExportState.Running(PdfProgress(PdfStep.COMPLETION))
                Outbox(null)
            }
            RunStatus.ERROR -> { jobRun.created = false; Outbox(PdfFailure.Job(state.error)) }
            RunStatus.RUNNING -> { jobRun.created = true; null }
            RunStatus.IDLE, RunStatus.WAITING, RunStatus.CANCELLED, RunStatus.UNKNOWN -> null
        }
    }

    /** Fallback without a stream: query every 3s, at most ten minutes, at most ten errors in a row. */
    private suspend fun questionAbUntilDone(jobId: String, jobRun: JobRun): Outbox {
        var error = 0
        val until = System.currentTimeMillis() + 10 * 60 * 1000L
        var last: Outcome.Failure = Outcome.Failure.Timeout
        while (System.currentTimeMillis() < until) {
            delay(3000)
            when (val r = files.getPdfJobStatus(jobId)) {
                is Outcome.Success -> { error = 0; applyChange(r.data, jobRun)?.let { return it } }
                is Outcome.Failure -> { last = r; if (++error >= 10) return Outbox(PdfFailure.Fetch(r)) }
            }
        }
        return Outbox(PdfFailure.Fetch(last))
    }

    /** How a job ended: [reason] null means done. */
    private class Outbox(val reason: PdfFailure?)

    /** What a single job knows about its own time; new for each job. */
    private class JobRun {
        /** When the PDF will be done according to the first estimate, 0 without an estimate. */
        @Volatile var deadlineMs = 0L

        /** Only while the server is still creating it does the ticker show a remaining time. */
        @Volatile var created = false

        fun rememberDeadline(seconds: Double?) {
            if (deadlineMs == 0L && seconds != null && seconds > 0) deadlineMs = System.currentTimeMillis() + (seconds * 1000).roundToLong()
        }
    }
}
