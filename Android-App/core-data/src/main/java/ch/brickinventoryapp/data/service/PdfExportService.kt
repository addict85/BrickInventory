package ch.brickinventoryapp.data.service

import ch.brickinventoryapp.model.util.fangeAusserAbbruch
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
import ch.brickinventoryapp.ressourcen.R
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.*
import javax.inject.Inject
import ch.brickinventoryapp.data.di.Anwendungsbereiche
import ch.brickinventoryapp.data.util.LanguageManager

/**
 * Foreground-Service für den PDF-Export der Teileliste.
 * Ersetzt den früheren WakeLock-Ansatz im ViewModel: Der Export überlebt
 * damit auch, wenn die Activity vom System beendet wird oder das Gerät
 * in Doze geht. Fortschritt/Ergebnis laufen über den PdfExportManager,
 * den die UI beobachtet.
 */
@AndroidEntryPoint
class PdfExportService : Service() {

    companion object {
        const val CHANNEL_ID      = "pdf_export_channel"
        const val NOTIFICATION_ID = 43
        /** Die Abschlussmeldung; [TeilelistenAufraeumer] nimmt sie mit der Datei weg. */
        const val FERTIG_ID = NOTIFICATION_ID + 1

        fun start(context: Context) {
            // Siehe CsvImportService: startForegroundService kann an der
            // Aufrufstelle werfen, wenn die App im Hintergrund ist. Der
            // PDF-Export wird zwar vom Nutzer im Vordergrund ausgelöst, aber
            // wir sichern es defensiv ab, damit die App nie deswegen abstürzt.
            try {
                context.startForegroundService(Intent(context, PdfExportService::class.java))
            } catch (_: Exception) { /* Hintergrund-Start nicht erlaubt — ignorieren */ }
        }
    }

    @Inject lateinit var manager: PdfExportManager

    // Siehe CsvImportService: Services bekommen die per-App-Sprache unterhalb
    // von Android 13 nicht automatisch — Context dafür wrappen.
    private val loc: Context by lazy {
        LanguageManager.localizedContext(this)
    }

    @Inject lateinit var bereiche: Anwendungsbereiche

    // Lebt mit dem Dienst (onDestroy bricht ab). lazy, weil Hilt die Felder erst
    // in super.onCreate() setzt.
    private val serviceScope by lazy { CoroutineScope(SupervisorJob() + bereiche.io) }
    private var exportJob: Job? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        fangeAusserAbbruch {
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
        if (exportJob?.isActive != true) {
            // Notification an den Manager-Zustand koppeln
            serviceScope.launch {
                manager.state.collect { s ->
                    when (s) {
                        is PdfExportState.Running -> updateNotification(s.statusText)
                        else -> { /* Endzustände behandelt der Export-Job unten */ }
                    }
                }
            }
            exportJob = serviceScope.launch {
                manager.run()
                when (val s = manager.state.value) {
                    is PdfExportState.Done -> {
                        showFinalNotification(loc.getString(R.string.notif_pdf_done_tap), openPdfIntent())
                    }
                    is PdfExportState.Error -> {
                        showFinalNotification(loc.getString(R.string.notif_pdf_failed, s.message), null)
                    }
                    else -> {}
                }
                stopSelf()
            }
        }
        return START_NOT_STICKY
    }

    private fun openPdfIntent(): PendingIntent {
        val view = teilelistenAuswahl(this, loc.getString(R.string.pdfexp_oeffnen_mit))
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
            .build()
        // Andere ID, damit die Abschluss-Notification das Foreground-Ende überlebt
        (getSystemService(NOTIFICATION_SERVICE) as NotificationManager)
            .notify(FERTIG_ID, n)
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
