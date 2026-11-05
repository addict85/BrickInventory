package ch.brickinventoryapp.alarm

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
import ch.brickinventoryapp.ressourcen.R
import androidx.hilt.work.HiltWorker
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import java.util.concurrent.TimeUnit

/**
 * Holt stündlich ab, ob ein Preisalarm ausgelöst hat, und meldet es. Abholen statt
 * Push: Push hiesse Firebase und fremde Server für jede Meldung, und schneller als
 * der stündliche Preislauf des Servers entsteht keine Meldung. Den Akku schonen
 * NetworkType.CONNECTED, Doze und die Bündelung des JobSchedulers.
 */
@HiltWorker
class PreisalarmWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val abholung: PreisalarmRepository,
) : CoroutineWorker(context, params) {

    // erfolg=false heisst NUR „der Server war nicht erreichbar". Alles andere
    // — abgeschaltet, nicht angemeldet, nichts Neues — ist ein erfolgreicher
    // Durchgang, der nichts zu tun hatte.
    override suspend fun doWork(): androidx.work.ListenableWorker.Result =
        // retry(): Der Server ist gerade nicht da. WorkManager versucht es mit
        // wachsendem Abstand erneut, statt eine Stunde zu warten.
        if (abholung.durchgang()) androidx.work.ListenableWorker.Result.success()
        else androidx.work.ListenableWorker.Result.retry()

    companion object {
        /**
         * Die Setnummer, die eine angetippte Meldung öffnen soll — hier, weil wer den
         * Intent baut, seinen Inhalt bestimmt. Lesen darf es nur der nicht exportierte
         * MeldungsEinstieg der App.
         */
        const val EXTRA_SET = "preisalarm_set"

        private const val NAME = "preisalarm-abruf"
        internal const val KANAL = "preisalarm"

        /**
         * Einplanen oder abbestellen. KEEP statt UPDATE, damit ein häufiges Öffnen der App
         * den nächsten Lauf nicht immer wieder nach hinten schiebt. Wirft nie: WorkManager
         * fährt beim ersten Zugriff hoch und kann dabei scheitern; am Schalter auf dem
         * Hauptthread brachte das die App zum Absturz. Die Absicherung steht hier einmal
         * statt an jeder Aufrufstelle.
         *
         * @return null bei Erfolg, sonst der Fehler, damit der Aufrufer ihn zeigen kann —
         *         ein Schalter auf „an“ ohne Meldung soll nicht unbemerkt bleiben.
         */
        fun einplanen(context: Context, an: Boolean): Throwable? = runCatching {
            val wm = WorkManager.getInstance(context)
            if (!an) { wm.cancelUniqueWork(NAME); return@runCatching }
            val auftrag = PeriodicWorkRequestBuilder<PreisalarmWorker>(1, TimeUnit.HOURS)
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build()
                )
                .build()
            wm.enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, auftrag)
        }.exceptionOrNull()

        /**
         * Auf dem gesperrten Bildschirm nur „Preisalarm“: Set und Preis verrieten jedem,
         * der das Telefon sieht, was im Regal steht und was es wert ist.
         */
        fun meldung(context: Context, text: String, tippen: PendingIntent?): android.app.Notification {
            val oeffentlich = NotificationCompat.Builder(context, KANAL)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(context.getString(R.string.detail_alert))
                .setContentText(context.getString(R.string.alert_gesperrt))
                .build()
            return NotificationCompat.Builder(context, KANAL)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(context.getString(R.string.detail_alert))
                .setContentText(text)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setPublicVersion(oeffentlich)
                .setGroup(KANAL)
                .setAutoCancel(true)
                .setContentIntent(tippen)
                .build()
        }
    }
}
