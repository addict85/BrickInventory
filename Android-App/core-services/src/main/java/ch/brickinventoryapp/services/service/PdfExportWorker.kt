package ch.brickinventoryapp.services.service

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.ListenableWorker
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import ch.brickinventoryapp.data.repository.errorTextToCode
import ch.brickinventoryapp.dataapi.parts.PdfFailure
import ch.brickinventoryapp.model.domain.PdfProgress
import ch.brickinventoryapp.model.domain.PdfStep
import ch.brickinventoryapp.model.outcome.Outcome
import ch.brickinventoryapp.resources.R
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Waits for the server's PDF job, downloads the file and posts „PDF ready, tap“. A plain worker
 * without foreground: WorkManager keeps the process for the run and runs it again after the
 * process died, so the export finishes without the dataSync foreground service.
 */
@HiltWorker
internal class PdfExportWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val manager: PdfExportManager,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result =
        PdfFollowUp(manager::follow, manager.state, AndroidPdfNotifier(applicationContext))
            .run(inputData.keyValueMap[KEY_JOB] as? String)

    companion object {
        private const val NAME = "pdf-export"
        private const val KEY_JOB = "job"

        /** REPLACE: a new export cancels the worker of the previous one. */
        fun schedule(context: Context, jobId: String) {
            val job = OneTimeWorkRequestBuilder<PdfExportWorker>()
                .setInputData(workDataOf(KEY_JOB to jobId))
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(NAME, ExistingWorkPolicy.REPLACE, job)
        }
    }
}

/** What the worker shows; the Android implementation in [AndroidPdfNotifier], in the test a recorder. */
internal interface PdfNotifier {
    fun progress(progress: PdfProgress)
    fun ready()
    fun failed(reason: PdfFailure)
    fun clearProgress()
}

/**
 * One run of the worker without Android types: the progress bar while [follow] runs, then
 * exactly one final notification. A replaced export (Idle) reports nothing, its successor does.
 */
internal class PdfFollowUp(
    private val follow: suspend (String) -> PdfExportState,
    private val progress: Flow<PdfExportState>,
    private val notifier: PdfNotifier,
) {
    suspend fun run(jobId: String?): ListenableWorker.Result {
        if (jobId.isNullOrBlank()) return ListenableWorker.Result.failure()
        coroutineScope {
            val bar = launch { progress.collect { (it as? PdfExportState.Running)?.let { r -> notifier.progress(r.progress) } } }
            try {
                when (val end = follow(jobId)) {
                    is PdfExportState.Done -> notifier.ready()
                    is PdfExportState.Error -> notifier.failed(end.reason)
                    PdfExportState.Idle, is PdfExportState.Running -> {}
                }
            } finally {
                // Joined first, so no late progress lands after the bar is gone.
                withContext(NonCancellable) { bar.cancelAndJoin() }
                notifier.clearProgress()
            }
        }
        return ListenableWorker.Result.success()
    }
}

/** A string from resources; in the worker from the context in the app's language, in the test a number. */
internal typealias Sentence = (id: Int, args: List<Any>) -> String

/** The string for a step, as the notification shows it. */
internal fun progressText(f: PdfProgress, sentence: Sentence): String = when (f.step) {
    PdfStep.STARTING -> sentence(R.string.pdfexp_starting, emptyList())
    PdfStep.IMAGES_LOAD -> sentence(R.string.pdfexp_loading_images, emptyList())
    PdfStep.CREATED -> f.restSeconds?.takeIf { it > 0 }?.let { sentence(R.string.pdfexp_creating_eta, listOf(it)) }
        ?: sentence(R.string.pdfexp_almost_done, emptyList())
    PdfStep.COMPLETION -> sentence(R.string.pdfexp_finalizing, emptyList())
    PdfStep.DOWNLOAD -> sentence(R.string.pdfexp_downloading, emptyList())
}

/** Never empty: without a string from the server, the error code speaks, otherwise the kind of error. */
internal fun errorText(reason: PdfFailure, sentence: Sentence): String = when (reason) {
    is PdfFailure.Job -> reason.sentence?.takeIf { it.isNotBlank() } ?: sentence(R.string.pdfexp_server_error, emptyList())
    is PdfFailure.Fetch -> reason.error.message.takeIf { it.isNotBlank() }
        ?: errorTextToCode(reason.error.code)?.let { sentence(it, emptyList()) }
        ?: when (val f = reason.error) {
            is Outcome.Failure.Server -> sentence(R.string.pdfexp_http_error, listOf(f.status))
            is Outcome.Failure.Network, Outcome.Failure.Cancelled -> sentence(R.string.err_network, emptyList())
            Outcome.Failure.Timeout -> sentence(R.string.err_timeout, emptyList())
            is Outcome.Failure.Rejected -> sentence(R.string.err_session_expired, emptyList())
            Outcome.Failure.Plaintext -> sentence(R.string.err_plaintext, emptyList())
            is Outcome.Failure.EmptyResponse, is Outcome.Failure.Refusal, is Outcome.Failure.Unknown -> sentence(R.string.pdfexp_unknown_error, emptyList())
        }
}
