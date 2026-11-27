package ch.brickinventoryapp.services.service

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.ListenableWorker
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import ch.brickinventoryapp.data.CsvImportSseClient
import ch.brickinventoryapp.data.collection.SetFilesRepository
import ch.brickinventoryapp.data.di.Scopes
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.model.domain.CsvImportStatusView
import ch.brickinventoryapp.model.util.catchUnlessCancelled
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import java.util.concurrent.TimeUnit
import javax.inject.Inject

/** Background follow-up of a running CSV import; a counter in the test. */
interface CsvImportRunner {
    fun start()
    fun stop()
}

/**
 * One serial lane on io: WorkManager reads its database on first access (never on the main
 * thread), and a stop() right after start() must not overtake it.
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal class WorkManagerCsvImportRunner @Inject constructor(
    @param:ApplicationContext private val ctx: Context,
    private val areas: Scopes,
) : CsvImportRunner {
    private val lane = areas.io.limitedParallelism(1)

    override fun start() {
        areas.application.launch(lane) { catchUnlessCancelled { CsvImportWorker.schedule(ctx) } }
    }

    override fun stop() {
        areas.application.launch(lane) { catchUnlessCancelled { WorkManager.getInstance(ctx).cancelUniqueWork(CsvImportWorker.NAME) } }
    }
}

/**
 * Watches the server-side import while the app may be in the background and posts the final
 * notification. A plain worker, no foreground: it only waits, and a foreground worker would
 * need the dataSync permission again. Past [BUDGET_MS] it hands over to its own retry, because
 * the system stops a worker after ten minutes.
 */
@HiltWorker
internal class CsvImportWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val files: SetFilesRepository,
    private val sseClient: CsvImportSseClient,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val notifier = AndroidCsvNotifier(applicationContext)
        val watch = CsvImportWatch(sseClient::stream, files::getCsvImportStatus, notifier, System::currentTimeMillis)
        return watch.run(BUDGET_MS).toWorkResult()
    }

    companion object {
        internal const val NAME = "csv-import-watch"
        private const val BUDGET_MS = 8 * 60 * 1000L

        /** KEEP: the import already being watched is the same import. */
        fun schedule(context: Context) {
            val job = OneTimeWorkRequestBuilder<CsvImportWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.LINEAR, 10, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(NAME, ExistingWorkPolicy.KEEP, job)
        }
    }
}

/** What the worker shows; the Android implementation in [AndroidCsvNotifier], in the test a recorder. */
internal interface CsvNotifier {
    fun started()
    fun progress(status: CsvImportStatusView)
    fun finished()
    fun clear()
}

/** Only out of time asks for another run; unreachable ends quietly, as the foreground service did. */
internal fun CsvImportWatch.End.toWorkResult(): ListenableWorker.Result = when (this) {
    CsvImportWatch.End.FINISHED, CsvImportWatch.End.UNREACHABLE -> ListenableWorker.Result.success()
    CsvImportWatch.End.OUT_OF_TIME -> ListenableWorker.Result.retry()
}

/**
 * Status observation: SSE first, polling only as a fallback; shares the CsvImportSseClient
 * with the ViewModel instead of querying the same endpoint a second time. Without Android
 * types, so the test drives it with virtual time.
 */
internal class CsvImportWatch(
    private val stream: () -> Flow<CsvImportSseClient.Event>,
    private val poll: suspend () -> Outcome<CsvImportStatusView>,
    private val notifier: CsvNotifier,
    private val clock: () -> Long,
) {
    enum class End { FINISHED, UNREACHABLE, OUT_OF_TIME }

    private val startedAtMs = clock()
    @Volatile private var sawRunning = false

    /** Never leaves an ongoing notification behind: only a finished import posts one that stays. */
    suspend fun run(budgetMs: Long): End {
        notifier.started()
        val end = try {
            withTimeoutOrNull(budgetMs) { follow() } ?: End.OUT_OF_TIME
        } catch (e: CancellationException) {
            notifier.clear()
            throw e
        }
        if (end == End.FINISHED) notifier.finished() else notifier.clear()
        return end
    }

    private suspend fun follow(): End {
        var errors = 0
        while (true) {
            val sseOk = followStream(stream()) { status ->
                errors = 0
                applyStatus(status)
            }
            if (sseOk) return End.FINISHED
            // A window of queries (~15 s), then a new SSE attempt.
            repeat(POLL_WINDOW) {
                when (pollOnce()) {
                    PollResult.FINISHED -> return End.FINISHED
                    PollResult.RUNNING -> errors = 0
                    PollResult.ERROR -> if (++errors >= MAX_ERRORS) return End.UNREACHABLE
                }
                delay(POLL_INTERVAL_MS)
            }
        }
    }

    private enum class PollResult { RUNNING, FINISHED, ERROR }

    private suspend fun pollOnce(): PollResult = catchUnlessCancelled {
        when (val resp = poll()) {
            is Outcome.Success -> if (applyStatus(resp.data)) PollResult.RUNNING else PollResult.FINISHED
            is Outcome.Failure -> PollResult.ERROR
        }
    }.getOrElse { PollResult.ERROR }

    /** The one place that turns a status into progress; true as long as the import runs. */
    private fun applyStatus(s: CsvImportStatusView): Boolean {
        if (s.status?.running != true) return importGoesOn(sawRunning, clock() - startedAtMs)
        sawRunning = true
        notifier.progress(s)
        return true
    }

    private companion object {
        const val POLL_INTERVAL_MS = 1500L
        const val POLL_WINDOW = 10
        const val MAX_ERRORS = 10
    }
}

/** How long after the start an idle answer still means "the import job is not created yet". */
internal const val CSV_GRACE_MS = 10_000L

/**
 * Does the import go on although the server reports idle? The watch starts with the upload, and
 * until the import job exists the server says "idle"; without this window the first idle answer
 * would end the watch before any progress came in. After a running state, idle is the end.
 */
internal fun importGoesOn(sawRunning: Boolean, sinceStartMs: Long): Boolean = !sawRunning && sinceStartMs < CSV_GRACE_MS
