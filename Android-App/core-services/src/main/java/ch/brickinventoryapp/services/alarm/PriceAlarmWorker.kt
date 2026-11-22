package ch.brickinventoryapp.services.alarm

import android.app.PendingIntent
import android.content.Context
import androidx.core.app.NotificationCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import ch.brickinventoryapp.resources.R
import androidx.hilt.work.HiltWorker
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import java.util.concurrent.TimeUnit

/**
 * Fetches hourly whether a price alert has triggered, and reports it. Fetching instead of
 * push: push would mean Firebase and a third-party server for every notification, and no notification
 * can arise faster than the server's hourly price run anyway. NetworkType.CONNECTED,
 * Doze and the JobScheduler's batching save battery.
 */
@HiltWorker
class PriceAlarmWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val pickup: PriceAlertRepository,
) : CoroutineWorker(context, params) {

    // erfolg=false means ONLY „the server was not reachable“. Everything else
    // — disabled, signed out, nothing new — is a successful
    // run that had nothing to do.
    override suspend fun doWork(): androidx.work.ListenableWorker.Result =
        // retry(): the server just isn't there right now. WorkManager tries again with
        // a growing interval, instead of waiting a full hour.
        if (pickup.pass()) androidx.work.ListenableWorker.Result.success()
        else androidx.work.ListenableWorker.Result.retry()

    companion object {
        /**
         * The set number that a tapped notification should open — here, because whoever
         * builds the intent determines its contents. Only the app's own, non-exported
         * MessageEntryPoint may read it.
         */
        const val EXTRA_SET = "preisalarm_set"

        private const val NAME = "preisalarm-abruf"
        internal const val CHANNEL = "preisalarm"

        /**
         * Schedule or unschedule. KEEP instead of UPDATE, so that frequently opening the app
         * doesn't keep pushing the next run further back. Never throws: WorkManager
         * boots up on first access and can fail doing so; at the switch on the
         * main thread that crashed the app. The safeguard lives here once,
         * instead of at every call site.
         *
         * @return null on success, otherwise the error, so the caller can show it —
         *         a switch left „on“ without a notification should not go unnoticed.
         */
        fun schedule(context: Context, an: Boolean): Throwable? = runCatching {
            val wm = WorkManager.getInstance(context)
            if (!an) { wm.cancelUniqueWork(NAME); return@runCatching }
            val job = PeriodicWorkRequestBuilder<PriceAlarmWorker>(1, TimeUnit.HOURS)
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build()
                )
                .build()
            wm.enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, job)
        }.exceptionOrNull()

        /**
         * On the locked screen only „Preisalarm“: set and price would reveal to anyone
         * who sees the phone what's in the shelf and what it's worth.
         */
        fun message(context: Context, text: String, tap: PendingIntent?): android.app.Notification {
            val public = NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(context.getString(R.string.detail_alert))
                .setContentText(context.getString(R.string.alert_locked))
                .build()
            return NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(context.getString(R.string.detail_alert))
                .setContentText(text)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setPublicVersion(public)
                .setGroup(CHANNEL)
                .setAutoCancel(true)
                .setContentIntent(tap)
                .build()
        }
    }
}
