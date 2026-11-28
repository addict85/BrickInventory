package ch.brickinventoryapp.services.service

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import androidx.core.app.NotificationCompat
import ch.brickinventoryapp.dataapi.language.AppLanguage
import ch.brickinventoryapp.model.domain.CsvImportStatusView
import ch.brickinventoryapp.resources.R

/**
 * The CSV import's notifications. Texts come from the context in the app's language:
 * setApplicationLocales() only localizes activities, so below Android 13 a worker would
 * otherwise speak the system language.
 */
internal class AndroidCsvNotifier(context: Context, appLanguage: AppLanguage) : CsvNotifier {

    private val loc: Context = appLanguage.localizedContext(context)
    private val manager = loc.getSystemService(NotificationManager::class.java)

    init {
        val channel = NotificationChannel(
            CHANNEL_ID,
            loc.getString(R.string.notif_csv_channel_name),
            NotificationManager.IMPORTANCE_LOW,
        ).apply { description = loc.getString(R.string.notif_csv_channel_desc) }
        manager.createNotificationChannel(channel)
    }

    override fun started() = showProgress(loc.getString(R.string.notif_csv_running), 0, 0)

    override fun progress(status: CsvImportStatusView) {
        val current = status.current.orEmpty()
        val text = if (status.total > 0) "${status.done} / ${status.total}${if (current.isNotBlank()) " – $current" else ""}"
            else loc.getString(R.string.notif_csv_importing)
        showProgress(text, status.done, status.total)
    }

    private fun showProgress(text: String, done: Int, total: Int) {
        manager.notify(NOTIFICATION_ID, builder(text)
            .setOngoing(true)
            .setSilent(true)
            .apply { if (total > 0) setProgress(total, done, false) else setProgress(0, 0, true) }
            .build())
    }

    // Same ID as the progress: the final notice replaces the bar and can be swiped away.
    override fun finished() {
        manager.notify(NOTIFICATION_ID, builder(loc.getString(R.string.notif_csv_done)).setAutoCancel(true).build())
    }

    override fun clear() = manager.cancel(NOTIFICATION_ID)

    private fun builder(text: String) = NotificationCompat.Builder(loc, CHANNEL_ID)
        .setContentTitle(loc.getString(R.string.notif_csv_title))
        .setContentText(text)
        .setSmallIcon(R.drawable.ic_stat_brick)
        // Only the title while locked, like the notifications in core-data (LockScreenNotification.kt).
        .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
        .setPublicVersion(NotificationCompat.Builder(loc, CHANNEL_ID).setSmallIcon(R.drawable.ic_stat_brick)
            .setContentTitle(loc.getString(R.string.notif_csv_title)).build())

    private companion object {
        // Unchanged since the foreground service, so the user's channel settings stay.
        const val CHANNEL_ID = "csv_import_channel"
        const val NOTIFICATION_ID = 42
    }
}
