package ch.brickinventoryapp.dienste.service

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
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.fehlerTextZuCode
import ch.brickinventoryapp.data.service.PdfFehlschlag
import ch.brickinventoryapp.data.service.teilelistenAuswahl
import ch.brickinventoryapp.model.fach.PdfFortschritt
import ch.brickinventoryapp.model.fach.PdfSchritt

/**
 * Foreground-Service für den PDF-Export der Teileliste: Er hält den Prozess wach,
 * solange der Auftrag im PdfExportManager läuft (auch in Doze oder ohne Activity),
 * und zeigt dessen Stand als Benachrichtigung in der Sprache der App.
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

    @Inject internal lateinit var manager: PdfExportManager

    // Siehe CsvImportService: Services bekommen die per-App-Sprache unterhalb
    // von Android 13 nicht automatisch — Context dafür wrappen.
    private val loc: Context by lazy {
        LanguageManager.localizedContext(this)
    }

    private val satz: Satz = { id, args -> loc.getString(id, *args.toTypedArray()) }

    @Inject lateinit var bereiche: Anwendungsbereiche

    // Lebt mit dem Dienst (onDestroy bricht ab). lazy, weil Hilt die Felder erst
    // in super.onCreate() setzt.
    private val serviceScope by lazy { CoroutineScope(SupervisorJob() + bereiche.io) }
    private var begleitung: Job? = null

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
        // Der Auftrag läuft im Manager; der Dienst zeigt nur seinen Stand und endet mit ihm.
        if (begleitung?.isActive != true) {
            begleitung = serviceScope.launch {
                manager.state.collect { s ->
                    when (s) {
                        is PdfExportState.Running -> updateNotification(fortschrittText(s.fortschritt, satz))
                        is PdfExportState.Done -> {
                            showFinalNotification(loc.getString(R.string.notif_pdf_done_tap), openPdfIntent())
                            stopSelf()
                        }
                        is PdfExportState.Error -> {
                            showFinalNotification(loc.getString(R.string.notif_pdf_failed, fehlerText(s.grund, satz)), null)
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

/** Ein Satz aus den Ressourcen; im Dienst aus dem Context in der Sprache der App, im Test eine Nummer. */
internal typealias Satz = (id: Int, args: List<Any>) -> String

/** Der Satz zu einem Schritt, wie ihn die Benachrichtigung zeigt. */
internal fun fortschrittText(f: PdfFortschritt, satz: Satz): String = when (f.schritt) {
    PdfSchritt.STARTET -> satz(R.string.pdfexp_starting, emptyList())
    PdfSchritt.BILDER_LADEN -> satz(R.string.pdfexp_loading_images, emptyList())
    PdfSchritt.ERSTELLT -> f.restSekunden?.takeIf { it > 0 }?.let { satz(R.string.pdfexp_creating_eta, listOf(it)) }
        ?: satz(R.string.pdfexp_almost_done, emptyList())
    PdfSchritt.ABSCHLUSS -> satz(R.string.pdfexp_finalizing, emptyList())
    PdfSchritt.HERUNTERLADEN -> satz(R.string.pdfexp_downloading, emptyList())
}

/** Nie leer: Ohne Satz des Servers spricht der Fehlercode, sonst die Art des Fehlers. */
internal fun fehlerText(grund: PdfFehlschlag, satz: Satz): String = when (grund) {
    is PdfFehlschlag.Auftrag -> grund.satz?.takeIf { it.isNotBlank() } ?: satz(R.string.pdfexp_server_error, emptyList())
    is PdfFehlschlag.Abruf -> grund.fehler.message.takeIf { it.isNotBlank() }
        ?: fehlerTextZuCode(grund.fehler.code)?.let { satz(it, emptyList()) }
        ?: when (val f = grund.fehler) {
            is Ergebnis.Error.Server -> satz(R.string.pdfexp_http_error, listOf(f.status))
            is Ergebnis.Error.Netz, Ergebnis.Error.Abgebrochen -> satz(R.string.err_network, emptyList())
            Ergebnis.Error.Zeitueberschreitung -> satz(R.string.err_timeout, emptyList())
            is Ergebnis.Error.Abgewiesen -> satz(R.string.err_session_expired, emptyList())
            Ergebnis.Error.Klartext -> satz(R.string.err_klartext, emptyList())
            is Ergebnis.Error.LeereAntwort, is Ergebnis.Error.Unbekannt -> satz(R.string.pdfexp_unknown_error, emptyList())
        }
}
