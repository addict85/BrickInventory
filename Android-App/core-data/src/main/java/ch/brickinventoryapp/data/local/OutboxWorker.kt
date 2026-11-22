package ch.brickinventoryapp.data.local

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.hilt.work.HiltWorker
import ch.brickinventoryapp.security.DeviceLock
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import dagger.hilt.android.qualifiers.ApplicationContext
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import ch.brickinventoryapp.offline.OutboxPlanner

/**
 * Sends the outbox as soon as there is network. WorkManager takes over the network condition,
 * backoff and surviving a restart; the logic stands in [Reconcile].
 */
@HiltWorker
internal class OutboxWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val sync: Reconcile,
    private val lock: DeviceLock,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result =
        if (sync.send().again(lock.locked())) Result.retry() else Result.success()

    companion object {
        const val NAME = "ausgang-senden"
    }
}

/**
 * Schedules a send run. APPEND_OR_REPLACE instead of KEEP: if one is running and has
 * already seen the outbox empty, an item just queued would otherwise only get its turn
 * at the next occasion.
 */
internal class WorkManagerPlanner @Inject constructor(
    @param:ApplicationContext private val context: Context,
) : OutboxPlanner {
    override fun plane() {
        val job = OneTimeWorkRequestBuilder<OutboxWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(OutboxWorker.NAME, ExistingWorkPolicy.APPEND_OR_REPLACE, job)
    }
}
