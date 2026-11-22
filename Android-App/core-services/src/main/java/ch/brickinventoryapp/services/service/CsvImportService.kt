package ch.brickinventoryapp.services.service

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import ch.brickinventoryapp.data.CsvImportSseClient
import ch.brickinventoryapp.data.di.Scopes
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.data.repository.SetFilesRepository
import ch.brickinventoryapp.data.util.LanguageManager
import ch.brickinventoryapp.model.domain.CsvImportStatusView
import ch.brickinventoryapp.model.util.catchUnlessCancelled
import ch.brickinventoryapp.resources.R
import dagger.hilt.android.AndroidEntryPoint
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import javax.inject.Inject

/** The foreground service of a running CSV import; a counter in the test. */
interface CsvImportRunner {
    fun start()
    fun stop()
}

internal class AndroidCsvImportService @Inject constructor(
    @param:ApplicationContext private val ctx: Context,
) : CsvImportRunner {
    override fun start() = CsvImportService.start(ctx)
    override fun stop() = CsvImportService.stop(ctx)
}

@AndroidEntryPoint
class CsvImportService : Service() {

    companion object {
        const val CHANNEL_ID      = "csv_import_channel"
        const val NOTIFICATION_ID = 42

        // Fallback for when SSE isn't working
        private const val POLL_INTERVAL_MS = 1500L
        private const val POLL_WINDOW      = 10   // Abfragen je Fenster, dann neuer SSE-Versuch
        private const val MAX_ERRORS       = 10
        private const val GRACE_MS         = 10_000L  // Anlauffenster, siehe applyStatus()

        fun start(context: Context) {
            // startForegroundService can, on Android 12+, already throw at the
            // call site if the app is in the background
            // (ForegroundServiceStartNotAllowedException). That must not crash
            // the app — the notification is only "nice to have".
            try {
                context.startForegroundService(Intent(context, CsvImportService::class.java))
            } catch (_: Exception) { /* Background start not allowed — ignore */ }
        }

        fun stop(context: Context) {
            try {
                context.stopService(Intent(context, CsvImportService::class.java))
            } catch (_: Exception) { /* Service already ended — nothing left to stop */ }
        }
    }

    @Inject lateinit var files: SetFilesRepository
    @Inject lateinit var sseClient: CsvImportSseClient

    // Service context in the chosen app language: setApplicationLocales()
    // only localizes activities — without this wrapper, notifications
    // below Android 13 would come up in the system language
    // (or earlier: hardcoded to German).
    private val loc: Context by lazy {
        LanguageManager.localizedContext(this)
    }

    @Inject lateinit var areas: Scopes

    // Lives with the service (onDestroy cancels it). lazy, because Hilt only sets
    // the fields in super.onCreate().
    private val serviceScope by lazy { CoroutineScope(SupervisorJob() + areas.io) }
    private var pollJob: Job? = null

    // Anlaufschutz, siehe applyStatus()
    private val startedAtMs = System.currentTimeMillis()
    @Volatile private var sawRunning = false

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        catchUnlessCancelled {
            ServiceCompat.startForeground(
                this, NOTIFICATION_ID,
                buildNotification(loc.getString(R.string.notif_csv_running), 0, 0),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            )
        }.onFailure {
            // Without foreground (e.g. due to a background restriction) end quietly instead of crashing.
            stopSelf()
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (pollJob?.isActive != true) startWatching()
        return START_STICKY
    }

    /**
     * Status observation: SSE first, polling only as a fallback.
     * It shares the CsvImportSseClient with the ViewModel, instead of querying the same endpoint a second
     * time.
     */
    private fun startWatching() {
        pollJob = serviceScope.launch {
            var errors = 0
            while (isActive) {
                val sseFailed = !followStream(sseClient.stream()) { status ->
                    errors = 0
                    applyStatus(status)
                }

                if (!isActive) return@launch
                if (!sseFailed) {
                    // Flow ended normally → import is done
                    finishAndStop()
                    return@launch
                }

                // ── Fallback: poll until SSE works again ──────────────
                // A window of 10 queries (~15s), then a new SSE attempt.
                repeat(POLL_WINDOW) {
                    if (!isActive) return@launch
                    when (pollOnce()) {
                        PollResult.FINISHED -> { finishAndStop(); return@launch }
                        PollResult.RUNNING  -> errors = 0
                        PollResult.ERROR    -> {
                            errors++
                            if (errors >= MAX_ERRORS) { stopSelf(); return@launch }
                        }
                    }
                    delay(POLL_INTERVAL_MS)
                }
            }
        }
    }

    private enum class PollResult { RUNNING, FINISHED, ERROR }

    /** One status query of the fallback. */
    private suspend fun pollOnce(): PollResult = catchUnlessCancelled {
        when (val resp = files.getCsvImportStatus()) {
            is Outcome.Success ->
                if (applyStatus(resp.data)) PollResult.RUNNING else PollResult.FINISHED
            is Outcome.Failure -> PollResult.ERROR
        }
    }.getOrElse { PollResult.ERROR }

    /**
     * The one place that turns a status into a notification —
     * used jointly by SSE and polling.
     *
     * @return true as long as the import is running, false once it's done.
     */
    private fun applyStatus(s: CsvImportStatusView): Boolean {
        val running = s.status?.running == true
        val done    = s.done
        val total   = s.total
        val current = s.current ?: ""
        if (!running) {
            // Startup grace period: the server reports "idle" until the import job has actually
            // been created.
            // The service starts with the upload; without this window the first
            // idle response would end it before any progress could come in.
            if (!sawRunning && System.currentTimeMillis() - startedAtMs < GRACE_MS) return true
            return false
        }
        sawRunning = true
        val text = if (total > 0)
            "$done / $total${if (current.isNotBlank()) " – $current" else ""}"
            else loc.getString(R.string.notif_csv_importing)
        updateNotification(text, done, total)
        return true
    }

    /** Abschlussmeldung kurz stehen lassen, dann beenden. */
    private suspend fun finishAndStop() {
        updateNotification(loc.getString(R.string.notif_csv_done), 1, 1)
        delay(4000)
        stopSelf()
    }

    private fun buildNotification(text: String, progress: Int, max: Int) =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(loc.getString(R.string.notif_csv_title))
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_stat_brick)
            .setOngoing(true)
            .setSilent(true)
            .apply {
                if (max > 0) setProgress(max, progress, false)
                else         setProgress(0, 0, true)
            }
            // Only the title while locked, like the notifications in core-data (Sperrbildschirm.kt).
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(NotificationCompat.Builder(this, CHANNEL_ID).setSmallIcon(R.drawable.ic_stat_brick)
                .setContentTitle(loc.getString(R.string.notif_csv_title)).build())
            .build()

    private fun updateNotification(text: String, progress: Int, max: Int) {
        (getSystemService(NOTIFICATION_SERVICE) as NotificationManager)
            .notify(NOTIFICATION_ID, buildNotification(text, progress, max))
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            loc.getString(R.string.notif_csv_channel_name),
            NotificationManager.IMPORTANCE_LOW
        ).apply { description = loc.getString(R.string.notif_csv_channel_desc) }
        (getSystemService(NOTIFICATION_SERVICE) as NotificationManager)
            .createNotificationChannel(channel)
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
        serviceScope.cancel()
    }
}
