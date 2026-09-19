package ch.brickinventoryapp.alarm

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
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
 * Holt stuendlich ab, ob ein Preisalarm ausgeloest hat, und meldet es.
 *
 * ── Warum Abholen und nicht Push ────────────────────────────────────────────
 *
 * Echtes Push hiesse Firebase: ein Google-Projekt, eine Konfigurationsdatei im
 * Baum, und jede Meldung — welches Set, welcher Preis — liefe ueber fremde
 * Server. Fuer eine selbstgehostete Sammlung ist das eine schwere
 * Abhaengigkeit fuer eine leichte Nachricht.
 *
 * Und sie kauft hier fast nichts: Der Preislauf auf dem Server laeuft
 * stuendlich (price_job_interval_minutes, Vorgabe 60). Eine Meldung kann gar
 * nicht schneller entstehen, als ein stuendliches Nachfragen sie abholt.
 *
 * ── Was das fuer den Akku heisst ────────────────────────────────────────────
 *
 * Der Verbrauch steckt nicht in der Rechenarbeit, sondern im Aufwecken des
 * Funkmodems. Drei Dinge daempfen ihn, und alle drei sind Absicht:
 *
 *   * NetworkType.CONNECTED — ohne Netz laeuft der Auftrag gar nicht erst an,
 *     statt vergeblich das Modem zu wecken.
 *   * Doze und App Standby Buckets — liegt das Telefon still oder wird die App
 *     selten geoeffnet, schiebt das System den Auftrag in seltenere Fenster.
 *     Eine Stunde ist der WUNSCH, nicht die Zusage.
 *   * Buendelung — der JobScheduler weckt das Geraet nicht je App, sondern
 *     fasst faellige Auftraege zusammen.
 *
 * ── Warum EntryPoint und nicht @HiltWorker ──────────────────────────────────
 *
 * @HiltWorker braucht den Artefakt androidx.hilt:hilt-work, eine eigene
 * WorkerFactory und eine Aenderung an der Application-Klasse. Fuer EINEN
 * Worker ist das mehr Apparat als Nutzen; der EntryPoint holt dieselben
 * Abhaengigkeiten ohne zusaetzliche Abhaengigkeit.
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

    override suspend fun doWork(): androidx.work.ListenableWorker.Result {
        val zugang = EntryPointAccessors.fromApplication(applicationContext, Zugang::class.java)
        val prefs = zugang.prefs()

        // Nicht angemeldet oder abgeschaltet: nichts zu tun, und zwar
        // ERFOLGREICH. Ein retry() liesse WorkManager mit wachsendem Abstand
        // weiterversuchen — fuer einen Zustand, der sich nicht von selbst
        // aendert.
        if (!prefs.alarmMeldungenAn.first()) return androidx.work.ListenableWorker.Result.success()
        if (prefs.authToken.first().isBlank()) return androidx.work.ListenableWorker.Result.success()

        val marke = prefs.alarmMarke.first()
        val repo = zugang.repo()
        return when (val e = Alarmabholung.hole(marke) { seit -> repo.sets.getPendingAlerts(seit) }) {
            // retry(): Der Server ist gerade nicht da. WorkManager versucht es
            // mit wachsendem Abstand erneut, statt eine Stunde zu warten.
            is Alarmabholung.Ergebnis.Fehlgeschlagen ->
                androidx.work.ListenableWorker.Result.retry()

            is Alarmabholung.Ergebnis.Markiert -> {
                prefs.setzeAlarmMarke(e.neueMarke)
                androidx.work.ListenableWorker.Result.success()
            }

            is Alarmabholung.Ergebnis.Geholt -> {
                zeige(applicationContext, e.meldungen)
                // IMMER speichern, auch ohne Meldung — sonst fragt der
                // naechste Durchgang wieder ab dem alten Zeitpunkt und bringt
                // dieselbe Meldung ein zweites Mal.
                prefs.setzeAlarmMarke(e.neueMarke)
                androidx.work.ListenableWorker.Result.success()
            }
        }
    }

    companion object {
        private const val NAME = "preisalarm-abruf"
        private const val KANAL = "preisalarm"

        /**
         * Einplanen oder abbestellen.
         *
         * KEEP statt UPDATE: Ein bereits eingeplanter Auftrag soll bei jedem
         * App-Start weiterlaufen und nicht neu beginnen — sonst schoebe ein
         * haeufig geoeffneter App den naechsten Lauf immer wieder nach hinten
         * und der Abruf faende nie statt.
         */
        fun einplanen(context: Context, an: Boolean) {
            val wm = WorkManager.getInstance(context)
            if (!an) { wm.cancelUniqueWork(NAME); return }
            val auftrag = PeriodicWorkRequestBuilder<PreisalarmWorker>(1, TimeUnit.HOURS)
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build()
                )
                .build()
            wm.enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, auftrag)
        }

        /**
         * Die Meldungen anzeigen — eine Benachrichtigung je gerissener
         * Schwelle, gruppiert unter einer Zusammenfassung.
         *
         * Eine einzige Sammelmeldung waere kuerzer und schlechter: Wer drei
         * Alarme gesetzt hat, will wissen WELCHER gefallen ist, ohne die App
         * zu oeffnen.
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
                val n = NotificationCompat.Builder(context, KANAL)
                    .setSmallIcon(android.R.drawable.ic_dialog_info)
                    .setContentTitle(context.getString(R.string.detail_alert))
                    .setContentText(Alarmabholung.text(a, unter, ueber))
                    .setGroup(KANAL)
                    .setAutoCancel(true)
                    .build()
                // Die Setnummer als ID: Zwei Meldungen zum selben Set
                // ueberschreiben sich, statt sich zu stapeln.
                nm.notify(KANAL + a.setNumber + a.condition, i + 1, n)
            }
        }
    }
}
