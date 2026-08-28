package ch.brickinventoryapp.service

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.PreferencesManager
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.data.repository.BrickRepository
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.*
import ch.brickinventoryapp.data.CsvImportSseClient
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.takeWhile
import javax.inject.Inject

@AndroidEntryPoint
class CsvImportService : Service() {

    companion object {
        const val CHANNEL_ID      = "csv_import_channel"
        const val NOTIFICATION_ID = 42

        // Rückfallebene, falls SSE nicht steht
        private const val POLL_INTERVAL_MS = 1500L
        private const val POLL_WINDOW      = 10   // Abfragen je Fenster, dann neuer SSE-Versuch
        private const val MAX_ERRORS       = 10
        private const val GRACE_MS         = 10_000L  // Anlauffenster, siehe applyStatus()

        fun start(context: Context) {
            // startForegroundService kann auf Android 12+ bereits an der
            // Aufrufstelle werfen, wenn die App im Hintergrund ist
            // (ForegroundServiceStartNotAllowedException). Das darf die App
            // nicht abstürzen lassen — die Notification ist nur "nice to have".
            try {
                context.startForegroundService(Intent(context, CsvImportService::class.java))
            } catch (_: Exception) { /* Hintergrund-Start nicht erlaubt — ignorieren */ }
        }

        fun stop(context: Context) {
            try {
                context.stopService(Intent(context, CsvImportService::class.java))
            } catch (_: Exception) {}
        }
    }

    @Inject lateinit var prefs: PreferencesManager
    @Inject lateinit var repo:  BrickRepository
    @Inject lateinit var sseClient: ch.brickinventoryapp.data.CsvImportSseClient

    // Service-Context in der gewählten App-Sprache: setApplicationLocales()
    // lokalisiert nur Activities — ohne diesen Wrapper kämen die
    // Benachrichtigungen unterhalb von Android 13 in der Systemsprache
    // (bzw. vorher: hartkodiert auf Deutsch).
    private val loc: Context by lazy {
        ch.brickinventoryapp.util.LanguageManager.localizedContext(this)
    }

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var pollJob: Job? = null

    // Anlaufschutz, siehe applyStatus()
    private val startedAtMs = System.currentTimeMillis()
    @Volatile private var sawRunning = false

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ServiceCompat.startForeground(
                    this, NOTIFICATION_ID,
                    buildNotification(loc.getString(R.string.notif_csv_running), 0, 0),
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
                )
            } else {
                startForeground(NOTIFICATION_ID, buildNotification(loc.getString(R.string.notif_csv_running), 0, 0))
            }
        } catch (e: Exception) {
            // If foreground service cannot be started (e.g. background restriction),
            // stop self gracefully instead of crashing
            stopSelf()
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (pollJob?.isActive != true) startWatching()
        return START_STICKY
    }

    /**
     * Status-Beobachtung: SSE zuerst, Polling nur als Rückfallebene.
     *
     * Vorher pollte dieser Service unabhängig vom ViewModel alle 1,5s
     * denselben Endpoint — zwei getrennte Implementierungen desselben
     * Sachverhalts, die beide gepflegt werden mussten. Jetzt teilt er sich
     * den [CsvImportSseClient] mit dem ViewModel (@Singleton, aber cold Flow:
     * jeder Collector bekommt seine eigene Verbindung). Der Fortschritt kommt
     * damit ohne Verzögerung statt im 1,5-Sekunden-Raster, und die
     * Statuslogik steht nur noch an einer Stelle: [applyStatus].
     */
    private fun startWatching() {
        pollJob = serviceScope.launch {
            var errors = 0
            while (isActive) {
                var sseFailed = false
                try {
                    // takeWhile statt collect: applyStatus() liefert false, sobald
                    // der Import fertig ist — dann endet der Flow und wir verlassen
                    // die Schleife, statt die Verbindung offen zu halten.
                    sseClient.stream().takeWhile { ev ->
                        when (ev) {
                            is CsvImportSseClient.Event.Status -> {
                                errors = 0
                                applyStatus(ev.status)
                            }
                            is CsvImportSseClient.Event.Failed -> {
                                sseFailed = true
                                false
                            }
                        }
                    }.collect { /* Werte selbst werden nicht gebraucht */ }
                } catch (_: Exception) {
                    sseFailed = true
                }

                if (!isActive) return@launch
                if (!sseFailed) {
                    // Flow reguläre beendet → Import ist durch
                    finishAndStop()
                    return@launch
                }

                // ── Rückfallebene: pollen, bis SSE wieder steht ──────────────
                // Ein Fenster von 10 Abfragen (~15s), danach neuer SSE-Versuch.
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

    /** Eine Status-Abfrage der Rückfallebene. */
    private suspend fun pollOnce(): PollResult = try {
        val url   = prefs.serverUrl.first()
        val token = prefs.authToken.first()
        if (token.isBlank()) {
            PollResult.ERROR
        } else {
            when (val resp = repo.getCsvImportStatus(url, token)) {
                is Result.Success ->
                    if (applyStatus(resp.data)) PollResult.RUNNING else PollResult.FINISHED
                is Result.Error -> PollResult.ERROR
            }
        }
    } catch (_: Exception) {
        PollResult.ERROR
    }

    /**
     * Einzige Stelle, die aus einem Status eine Benachrichtigung macht —
     * von SSE und Polling gemeinsam genutzt.
     *
     * @return true solange der Import läuft, false wenn er fertig ist.
     */
    private fun applyStatus(s: ch.brickinventoryapp.data.model.CsvImportStatus): Boolean {
        val running = s.status == "running" || s.status == "pending"
        val done    = s.done  ?: 0
        val total   = s.total ?: 0
        val current = s.current ?: ""
        if (!running) {
            // Anlaufschutz: Der Server meldet "idle", bis der Import-Job
            // tatsächlich angelegt ist. Der Service wird aber im selben Moment
            // gestartet wie der Upload — ohne dieses Fenster würde die erste
            // idle-Antwort den Service sofort wieder beenden, und der Nutzer
            // sähe nie einen Fortschritt. Erst nach GRACE_MS (oder sobald
            // einmal ein laufender Import gesehen wurde) gilt idle als "fertig".
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
