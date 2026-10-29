package ch.brickinventoryapp.alarm

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.PreferencesManager
import ch.brickinventoryapp.data.repository.BrickRepository
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.flow.first
import java.util.concurrent.TimeUnit

/**
 * Holt stündlich ab, ob ein Preisalarm ausgelöst hat, und meldet es. Abholen statt
 * Push: Push hiesse Firebase und fremde Server für jede Meldung, und schneller als
 * der stündliche Preislauf des Servers entsteht keine Meldung. Den Akku schonen
 * NetworkType.CONNECTED, Doze und die Bündelung des JobSchedulers. EntryPoint
 * statt @HiltWorker, weil das für einen Worker weniger Apparat ist.
 */
class PreisalarmWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {

    @EntryPoint
    @InstallIn(SingletonComponent::class)
    interface Zugang {
        fun repo(): BrickRepository
        fun prefs(): PreferencesManager
    }

    // erfolg=false heisst NUR „der Server war nicht erreichbar". Alles andere
    // — abgeschaltet, nicht angemeldet, nichts Neues — ist ein erfolgreicher
    // Durchgang, der nichts zu tun hatte.
    override suspend fun doWork(): androidx.work.ListenableWorker.Result =
        // retry(): Der Server ist gerade nicht da. WorkManager versucht es mit
        // wachsendem Abstand erneut, statt eine Stunde zu warten.
        if (durchgang(applicationContext)) androidx.work.ListenableWorker.Result.success()
        else androidx.work.ListenableWorker.Result.retry()

    companion object {
        /**
         * Die Setnummer, die eine angetippte Meldung öffnen soll — hier, weil wer den
         * Intent baut, seinen Inhalt bestimmt; die Activity liest denselben Namen.
         */
        const val EXTRA_SET = "preisalarm_set"

        private const val NAME = "preisalarm-abruf"
        private const val KANAL = "preisalarm"

        /**
         * Ein Durchgang: nachfragen, anzeigen, Marke setzen. Hier statt in doWork(), weil
         * auch das Öffnen der App abholt (wie die Webapp beim Anmelden) — sonst käme eine
         * Meldung bis zu eine Stunde zu spät. Doppelte Meldungen verhindert die Marke:
         * Jeder Durchgang fragt „seit wann?“ und schreibt die Zeit des Servers zurück.
         *
         * @return false nur, wenn der Server nicht erreichbar war. Abgeschaltet oder
         *         abgemeldet ist ein erfolgreicher Durchgang ohne Arbeit — ein retry()
         *         versuchte vergeblich weiter.
         */
        suspend fun durchgang(context: Context): Boolean {
            val zugang = EntryPointAccessors.fromApplication(context, Zugang::class.java)
            val prefs = zugang.prefs()
            if (!prefs.alarmMeldungenAn.first()) return true
            if (prefs.tokenJetzt().isBlank()) return true

            val marke = prefs.alarmMarke.first()
            val repo = zugang.repo()
            return when (val e = Alarmabholung.hole(marke) { seit -> repo.sets.getPendingAlerts(seit) }) {
                is Alarmabholung.Ergebnis.Fehlgeschlagen -> false

                is Alarmabholung.Ergebnis.Markiert -> {
                    prefs.setzeAlarmMarke(e.neueMarke)
                    true
                }

                is Alarmabholung.Ergebnis.Geholt -> {
                    zeige(context, e.meldungen)
                    // IMMER speichern, auch ohne Meldung — sonst fragt der
                    // naechste Durchgang wieder ab dem alten Zeitpunkt und
                    // bringt dieselbe Meldung ein zweites Mal.
                    prefs.setzeAlarmMarke(e.neueMarke)
                    true
                }
            }
        }

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
         * Die Meldungen anzeigen — eine je gerissener Schwelle, gruppiert unter einer
         * Zusammenfassung: Man will ohne die App zu öffnen wissen, welcher Alarm gefallen
         * ist.
         */
        fun zeige(context: Context, meldungen: List<ch.brickinventoryapp.data.model.Preisalarm>) {
            if (meldungen.isEmpty()) return
            // Ab Android 13 ist POST_NOTIFICATIONS eine Laufzeitberechtigung.
            // Ohne sie wirft notify() nicht, es passiert schlicht nichts —
            // deshalb hier pruefen, statt sich auf das Ausbleiben zu verlassen.
            if (android.os.Build.VERSION.SDK_INT >= 33 &&
                ContextCompat.checkSelfPermission(
                    context, android.Manifest.permission.POST_NOTIFICATIONS
                ) != PackageManager.PERMISSION_GRANTED
            ) return

            val mgr = context.getSystemService(NotificationManager::class.java) ?: return
            mgr.createNotificationChannel(
                NotificationChannel(
                    KANAL,
                    context.getString(R.string.alert_channel_name),
                    // DEFAULT, nicht HIGH: Ein Preisalarm ist wichtig, aber
                    // nicht dringend — er soll nicht ueber den Bildschirm
                    // fahren, waehrend jemand etwas anderes tut.
                    NotificationManager.IMPORTANCE_DEFAULT,
                ).apply { description = context.getString(R.string.alert_channel_desc) }
            )

            val unter = context.getString(R.string.detail_alert_below)
            val ueber = context.getString(R.string.detail_alert_above)
            val nm = NotificationManagerCompat.from(context)
            for ((i, a) in meldungen.withIndex()) {
                // ── Antippen öffnet das Set ──
                //
                // CLEAR_TOP|SINGLE_TOP mit launchMode="singleTop": Eine laufende App bekommt den
                // Intent in onNewIntent() statt einer zweiten Instanz. Ein requestCode je Set,
                // sonst lieferte das System denselben PendingIntent und die ältere Meldung öffnete
                // das falsche Set. Die Klasse direkt referenziert statt Class.forName(), damit R8
                // sie ohne Keep-Regel behält.
                val ziel = Intent(context, ch.brickinventoryapp.MainActivity::class.java).apply {
                    flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
                    putExtra(EXTRA_SET, a.setNumber)
                }
                val tippen = PendingIntent.getActivity(
                    context,
                    (a.setNumber + a.condition).hashCode(),
                    ziel,
                    // IMMUTABLE ist ab Android 12 Pflicht, wenn nicht
                    // ausdruecklich MUTABLE verlangt wird. Wir fuellen den
                    // Intent vollstaendig, also gibt es nichts zu ergaenzen.
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                )
                val n = NotificationCompat.Builder(context, KANAL)
                    .setSmallIcon(android.R.drawable.ic_dialog_info)
                    .setContentTitle(context.getString(R.string.detail_alert))
                    .setContentText(Alarmabholung.text(a, unter, ueber))
                    .setGroup(KANAL)
                    .setAutoCancel(true)
                    .setContentIntent(tippen)
                    .build()
                // Die Setnummer als ID: Zwei Meldungen zum selben Set
                // ueberschreiben sich, statt sich zu stapeln.
                nm.notify(KANAL + a.setNumber + a.condition, i + 1, n)
            }
        }
    }
}
