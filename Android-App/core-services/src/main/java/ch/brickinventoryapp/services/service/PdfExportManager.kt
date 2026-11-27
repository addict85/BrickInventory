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

/** Where the export stands, as field values; the parts list and the worker read it. */
internal sealed interface PdfExportState {
    data object Idle : PdfExportState
    data class Running(val progress: PdfProgress) : PdfExportState
    data class Done(val file: File) : PdfExportState
    data class Error(val reason: PdfFailure) : PdfExportState
}

/**
 * Controls the PDF export: start the job here, then hand its id to [PdfExportWorker], which
 * waits for completion via SSE (polling as a fallback) and downloads the PDF through [follow].
 * Starting stays in-process because the job (all rows) is too large for WorkManager's input;
 * the waiting goes to WorkManager so it survives the screen and the process.
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

    // The job whose worker may write the state; "" while a new one is starting. The old
    // worker only stops once the new one replaces it and must not report its PDF meanwhile.
    @Volatile private var current: String? = null

    /** A new job replaces a running one; the state immediately switches to „starting“. */
    fun commission(request: PartListJob) {
        job?.cancel()
        synchronized(this) {
            current = ""
            _state.value = PdfExportState.Running(PdfProgress(PdfStep.STARTING))
        }
        job = areas.application.launch(areas.io) { start(request) }
    }

    private suspend fun start(request: PartListJob) {
        catchUnlessCancelled {
            val jobId = when (val r = files.startPdfJob(request)) {
                is Outcome.Success -> r.data
                is Outcome.Failure -> { fail(PdfFailure.Fetch(r)); return }
            }
            synchronized(this) {
                current = jobId
                _state.value = PdfExportState.Running(PdfProgress(PdfStep.IMAGES_LOAD))
            }
            PdfExportWorker.schedule(context, jobId)
        }.onFailure { e -> fail(PdfFailure.Fetch(Outcome.Failure.Unknown(technical = e.message))) }
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

    /**
     * Waits for the server job and downloads the PDF; ends in Done or Error, or Idle when a
     * newer export replaced this one. Called by the worker, also in a new process after the
     * old one died (current is then null), so it only needs the job id.
     */
    suspend fun follow(jobId: String): PdfExportState {
        if (current != null && current != jobId) return PdfExportState.Idle
        current = jobId
        publish(jobId, PdfExportState.Running(PdfProgress(PdfStep.IMAGES_LOAD)))
        catchUnlessCancelled {
            val jobRun = JobRun(jobId)
            // Alongside the waiting, a ticker: from the server's estimate (etaSeconds ≈
            // missing images), the remaining time every second, but only while it's still being created.
            val reason = coroutineScope {
                val ticker = launch {
                    while (isActive) {
                        delay(1000)
                        val deadline = jobRun.deadlineMs
                        if (jobRun.created && deadline > 0L) {
                            val rest = ((deadline - System.currentTimeMillis() + 999) / 1000L).toInt()
                            publish(jobId, PdfExportState.Running(PdfProgress(PdfStep.CREATED, rest)))
                        }
                    }
                }
                try { waitOnJob(jobId, jobRun) } finally { ticker.cancel() }
            }
            if (reason != null) { publish(jobId, PdfExportState.Error(reason)); return outcomeOf(jobId) }

            publish(jobId, PdfExportState.Running(PdfProgress(PdfStep.DOWNLOAD)))
            when (val r = loadPdf(jobId)) {
                is Outcome.Success -> {
                    val file = partListVault.put(context.filesDir, context.getExternalFilesDir(null), r.data)
                    // Even encrypted, the inventory only stays as long as someone wants to open it.
                    runCatching { PartListsCleaner.plane(context) }
                    publish(jobId, PdfExportState.Done(file))
                }
                is Outcome.Failure -> publish(jobId, PdfExportState.Error(PdfFailure.Fetch(r)))
            }
        }.onFailure { e -> publish(jobId, PdfExportState.Error(PdfFailure.Fetch(Outcome.Failure.Unknown(technical = e.message)))) }
        return outcomeOf(jobId)
    }

    private fun outcomeOf(jobId: String) = if (current == jobId) _state.value else PdfExportState.Idle

    private fun fail(reason: PdfFailure) { _state.value = PdfExportState.Error(reason) }

    /** Only the current job writes; see [current]. */
    private fun publish(jobId: String, s: PdfExportState) = synchronized(this) {
        if (current == jobId) _state.value = s
    }

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
                publish(jobRun.jobId, PdfExportState.Running(PdfProgress(PdfStep.COMPLETION)))
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
    private class JobRun(val jobId: String) {
        /** When the PDF will be done according to the first estimate, 0 without an estimate. */
        @Volatile var deadlineMs = 0L

        /** Only while the server is still creating it does the ticker show a remaining time. */
        @Volatile var created = false

        fun rememberDeadline(seconds: Double?) {
            if (deadlineMs == 0L && seconds != null && seconds > 0) deadlineMs = System.currentTimeMillis() + (seconds * 1000).roundToLong()
        }
    }
}
