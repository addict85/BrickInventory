package ch.brickinventoryapp.services.service

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import androidx.core.app.NotificationCompat
import ch.brickinventoryapp.data.onlyUnlocked
import ch.brickinventoryapp.dataapi.language.AppLanguage
import ch.brickinventoryapp.dataapi.parts.PdfFailure
import ch.brickinventoryapp.dataapi.parts.partListsSelection
import ch.brickinventoryapp.model.domain.PdfProgress
import ch.brickinventoryapp.resources.R

/**
 * The PDF export's notifications, in the app's language: setApplicationLocales() only
 * localizes activities, so below Android 13 a worker would otherwise speak the system language.
 */
internal class AndroidPdfNotifier(context: Context, appLanguage: AppLanguage) : PdfNotifier {

    private val loc: Context = appLanguage.localizedContext(context)
    private val manager = loc.getSystemService(NotificationManager::class.java)
    private val sentence: Sentence = { id, args -> loc.getString(id, *args.toTypedArray()) }

    init {
        val channel = NotificationChannel(
            CHANNEL_ID,
            loc.getString(R.string.notif_pdf_channel_name),
            NotificationManager.IMPORTANCE_LOW,
        ).apply { description = loc.getString(R.string.notif_pdf_channel_desc) }
        manager.createNotificationChannel(channel)
    }

    override fun progress(progress: PdfProgress) {
        manager.notify(NOTIFICATION_ID, builder(progressText(progress, sentence))
            .setOngoing(true)
            .setSilent(true)
            .setProgress(0, 0, true)
            .build())
    }

    override fun ready() = showFinal(loc.getString(R.string.notif_pdf_done_tap), openPdfIntent())

    override fun failed(reason: PdfFailure) =
        showFinal(loc.getString(R.string.notif_pdf_failed, errorText(reason, sentence)), null)

    override fun clearProgress() = manager.cancel(NOTIFICATION_ID)

    private fun openPdfIntent(): PendingIntent {
        val view = partListsSelection(loc, loc.getString(R.string.pdfexp_open_with))
        return PendingIntent.getActivity(loc, 0, view, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    // A separate ID, so removing the bar leaves it; PartListsCleaner removes it with the file.
    private fun showFinal(text: String, tapIntent: PendingIntent?) {
        manager.notify(DONE_ID, builder(text)
            .setAutoCancel(true)
            .apply { tapIntent?.let { setContentIntent(it) } }
            .build())
    }

    private fun builder(text: String) = NotificationCompat.Builder(loc, CHANNEL_ID)
        .setContentTitle(loc.getString(R.string.notif_pdf_title))
        .setContentText(text)
        .setSmallIcon(R.drawable.ic_stat_brick)
        .onlyUnlocked(loc, CHANNEL_ID, loc.getString(R.string.notif_pdf_title), R.drawable.ic_stat_brick)

    companion object {
        // Unchanged since the foreground service, so the user's channel settings stay.
        private const val CHANNEL_ID = "pdf_export_channel"
        private const val NOTIFICATION_ID = 43

        /** The completion notification; [PartListsCleaner] removes it along with the file. */
        const val DONE_ID = NOTIFICATION_ID + 1
    }
}
