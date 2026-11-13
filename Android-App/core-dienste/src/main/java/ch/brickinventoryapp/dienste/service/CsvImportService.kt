package ch.brickinventoryapp.dienste.service

import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.SetDateienRepository
import dagger.hilt.android.AndroidEntryPoint
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import ch.brickinventoryapp.data.CsvImportSseClient
import ch.brickinventoryapp.model.data.model.CsvImportStatus
import javax.inject.Inject
import ch.brickinventoryapp.data.di.Anwendungsbereiche
import ch.brickinventoryapp.data.util.LanguageManager

/** Der Vordergrund-Dienst eines laufenden CSV-Imports; im Test ein Zähler. */
interface CsvImportDienst {
    fun start()
    fun stop()
}

internal class AndroidCsvImportDienst @Inject constructor(
    @param:ApplicationContext private val ctx: Context,
) : CsvImportDienst {
    override fun start() = CsvImportService.start(ctx)
    override fun stop() = CsvImportService.stop(ctx)
}

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
            } catch (_: Exception) { /* Dienst schon beendet — nichts mehr zu stoppen */ }
        }
    }

    @Inject lateinit var dateien: SetDateienRepository
    @Inject lateinit var sseClient: CsvImportSseClient

    // Service-Context in der gewählten App-Sprache: setApplicationLocales()
    // lokalisiert nur Activities — ohne diesen Wrapper kämen die
    // Benachrichtigungen unterhalb von Android 13 in der Systemsprache
    // (bzw. vorher: hartkodiert auf Deutsch).
    private val loc: Context by lazy {
        LanguageManager.localizedContext(this)
    }

    @Inject lateinit var bereiche: Anwendungsbereiche

    // Lebt mit dem Dienst (onDestroy bricht ab). lazy, weil Hilt die Felder erst
    // in super.onCreate() setzt.
    private val serviceScope by lazy { CoroutineScope(SupervisorJob() + bereiche.io) }
    private var pollJob: Job? = null

    // Anlaufschutz, siehe applyStatus()
    private val startedAtMs = System.currentTimeMillis()
    @Volatile private var sawRunning = false

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        fangeAusserAbbruch {
            ServiceCompat.startForeground(
                this, NOTIFICATION_ID,
                buildNotification(loc.getString(R.string.notif_csv_running), 0, 0),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            )
        }.onFailure {
            // Ohne Vordergrund (etwa wegen einer Hintergrundsperre) still beenden statt abstürzen.
            stopSelf()
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (pollJob?.isActive != true) startWatching()
        return START_STICKY
    }

    /**
     * Status-Beobachtung: SSE zuerst, Polling nur als Rückfallebene.
     * Er teilt sich den CsvImportSseClient mit dem ViewModel, statt denselben Endpunkt ein zweites
     * Mal abzufragen.
     */
    private fun startWatching() {
        pollJob = serviceScope.launch {
            var errors = 0
            while (isActive) {
                val sseFailed = !folgeStrom(sseClient.stream()) { status ->
                    errors = 0
                    applyStatus(status)
                }

                if (!isActive) return@launch
                if (!sseFailed) {
                    // Flow regulär beendet → Import ist durch
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
    private suspend fun pollOnce(): PollResult = fangeAusserAbbruch {
        when (val resp = dateien.getCsvImportStatus()) {
            is Ergebnis.Success ->
                if (applyStatus(resp.data)) PollResult.RUNNING else PollResult.FINISHED
            is Ergebnis.Error -> PollResult.ERROR
        }
    }.getOrElse { PollResult.ERROR }

    /**
     * Einzige Stelle, die aus einem Status eine Benachrichtigung macht —
     * von SSE und Polling gemeinsam genutzt.
     *
     * @return true solange der Import läuft, false wenn er fertig ist.
     */
    private fun applyStatus(s: CsvImportStatus): Boolean {
        val running = s.status?.laeuft == true
        val done    = s.done  ?: 0
        val total   = s.total ?: 0
        val current = s.current ?: ""
        if (!running) {
            // Anlaufschutz: Der Server meldet "idle", bis der Import-Job tatsächlich angelegt
            // ist.
            // Der Service startet mit dem Upload; ohne dieses Fenster beendete ihn die erste
            // idle-Antwort, bevor ein Fortschritt käme.
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
            // Gesperrt nur der Titel, wie die Meldungen in core-data (Sperrbildschirm.kt).
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
