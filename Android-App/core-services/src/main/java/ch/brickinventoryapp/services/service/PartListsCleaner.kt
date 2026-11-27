package ch.brickinventoryapp.services.service

import android.content.Context
import androidx.core.app.NotificationManagerCompat
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import ch.brickinventoryapp.data.util.PART_LIST_DEADLINE_MS
import ch.brickinventoryapp.data.util.cleanOldPartListOn
import java.util.concurrent.TimeUnit

/**
 * Deletes the exported parts list after [PART_LIST_DEADLINE_MS]: even encrypted,
 * the inventory should only sit on the device as long as someone wants to open it.
 * The „done, tap to open“ notification disappears with it, since it would otherwise point nowhere.
 */
internal class PartListsCleaner(context: Context, params: WorkerParameters) : Worker(context, params) {

    override fun doWork(): Result {
        if (cleanOldPartListOn(applicationContext.filesDir, System.currentTimeMillis())) {
            NotificationManagerCompat.from(applicationContext).cancel(AndroidPdfNotifier.DONE_ID)
        }
        return Result.success()
    }

    companion object {
        private const val NAME = "teileliste-aufraeumen"

        /** REPLACE: the deadline runs from the most recent parts list. */
        fun plane(context: Context) {
            val job = OneTimeWorkRequestBuilder<PartListsCleaner>()
                .setInitialDelay(PART_LIST_DEADLINE_MS, TimeUnit.MILLISECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(NAME, ExistingWorkPolicy.REPLACE, job)
        }
    }
}
