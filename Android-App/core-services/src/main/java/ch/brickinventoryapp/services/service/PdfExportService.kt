package ch.brickinventoryapp.services.service

import ch.brickinventoryapp.model.util.catchUnlessCancelled
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import ch.brickinventoryapp.resources.R
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import javax.inject.Inject
import ch.brickinventoryapp.data.di.Scopes
import ch.brickinventoryapp.data.onlyUnlocked
import ch.brickinventoryapp.data.util.LanguageManager
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.data.repository.errorTextToCode
import ch.brickinventoryapp.data.service.PdfFailure
import ch.brickinventoryapp.data.service.partListsSelection
import ch.brickinventoryapp.model.domain.PdfProgress
import ch.brickinventoryapp.model.domain.PdfStep

/**
 * Foreground service for the parts list's PDF export: it keeps the process awake
 * as long as the job is running in PdfExportManager (even in Doze or without an activity),
 * and shows its state as a notification in the app's language.
 */
@AndroidEntryPoint
class PdfExportService : Service() {

    companion object {
        const val CHANNEL_ID      = "pdf_export_channel"
        const val NOTIFICATION_ID = 43
        /** The completion notification; [PartListsCleaner] removes it along with the file. */
        const val DONE_ID = NOTIFICATION_ID + 1

        fun start(context: Context) {
            // See CsvImportService: startForegroundService can throw at the
            // call site if the app is in the background. The
            // PDF export is triggered by the user in the foreground, but
            // we guard it defensively anyway, so the app never crashes because of it.
            try {
                context.startForegroundService(Intent(context, PdfExportService::class.java))
            } catch (_: Exception) { /* Background start not allowed — ignore */ }
        }
    }

    @Inject internal lateinit var manager: PdfExportManager

    // See CsvImportService: services don't get the per-app language automatically
    // below Android 13 — wrap the context for that.
    private val loc: Context by lazy {
        LanguageManager.localizedContext(this)
    }

    private val sentence: Sentence = { id, args -> loc.getString(id, *args.toTypedArray()) }

    @Inject lateinit var areas: Scopes

    // Lives with the service (onDestroy cancels it). lazy, because Hilt only sets
    // the fields in super.onCreate().
    private val serviceScope by lazy { CoroutineScope(SupervisorJob() + areas.io) }
    private var companion: Job? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        catchUnlessCancelled {
            ServiceCompat.startForeground(
                this, NOTIFICATION_ID,
                buildNotification(loc.getString(R.string.notif_pdf_running)),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            )
        }.onFailure { _ ->
            stopSelf()
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // The job runs in the manager; the service only shows its state and ends with it.
        if (companion?.isActive != true) {
            companion = serviceScope.launch {
                manager.state.collect { s ->
                    when (s) {
                        is PdfExportState.Running -> updateNotification(progressText(s.progress, sentence))
                        is PdfExportState.Done -> {
                            showFinalNotification(loc.getString(R.string.notif_pdf_done_tap), openPdfIntent())
                            stopSelf()
                        }
                        is PdfExportState.Error -> {
                            showFinalNotification(loc.getString(R.string.notif_pdf_failed, errorText(s.reason, sentence)), null)
                            stopSelf()
                        }
                        PdfExportState.Idle -> {}
                    }
                }
            }
        }
        return START_NOT_STICKY
    }

    private fun openPdfIntent(): PendingIntent {
        val view = partListsSelection(this, loc.getString(R.string.pdfexp_open_with))
        return PendingIntent.getActivity(
            this, 0, view,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun buildNotification(text: String) =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(loc.getString(R.string.notif_pdf_title))
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_stat_brick)
            .setOngoing(true)
            .setSilent(true)
            .setProgress(0, 0, true)
            .onlyUnlocked(this, CHANNEL_ID, loc.getString(R.string.notif_pdf_title), R.drawable.ic_stat_brick)
            .build()

    private fun updateNotification(text: String) {
        (getSystemService(NOTIFICATION_SERVICE) as NotificationManager)
            .notify(NOTIFICATION_ID, buildNotification(text))
    }

    private fun showFinalNotification(text: String, tapIntent: PendingIntent?) {
        val n = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(loc.getString(R.string.notif_pdf_title))
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_stat_brick)
            .setAutoCancel(true)
            .apply { tapIntent?.let { setContentIntent(it) } }
            .onlyUnlocked(this, CHANNEL_ID, loc.getString(R.string.notif_pdf_title), R.drawable.ic_stat_brick)
            .build()
        // A different ID, so the completion notification survives the foreground ending
        (getSystemService(NOTIFICATION_SERVICE) as NotificationManager)
            .notify(DONE_ID, n)
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            loc.getString(R.string.notif_pdf_channel_name),
            NotificationManager.IMPORTANCE_LOW
        ).apply { description = loc.getString(R.string.notif_pdf_channel_desc) }
        (getSystemService(NOTIFICATION_SERVICE) as NotificationManager)
            .createNotificationChannel(channel)
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
        serviceScope.cancel()
    }
}

/** A string from resources; in the service from the context in the app's language, in the test a number. */
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
