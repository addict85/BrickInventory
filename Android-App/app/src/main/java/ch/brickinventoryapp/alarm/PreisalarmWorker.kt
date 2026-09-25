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
         * Die Setnummer, die eine angetippte Meldung oeffnen soll.
         *
         * Hier und nicht in MainActivity: Wer den Intent BAUT, bestimmt seinen
         * Inhalt. Die Activity liest nur nach — und muss dafuer denselben
         * Namen kennen, nicht eine eigene Kopie davon.
         */
        const val EXTRA_SET = "preisalarm_set"

        private const val NAME = "preisalarm-abruf"
        private const val KANAL = "preisalarm"

        /**
         * EIN Durchgang: nachfragen, anzeigen, Marke setzen.
         *
         * ── Warum das nicht mehr in doWork() steht ──────────────────────────
         *
         * Marcos Befund vom 25.09.: „In der Android-App kommt trotz aktivem
         * Preisalarm keine notification."
         *
         * Abgeholt hat bis dahin AUSSCHLIESSLICH der stuendliche Auftrag. Wer
         * die App oeffnet, erfaehrt also nichts — im schlechtesten Fall eine
         * Stunde lang. Fuer eine Meldung, deren Zweck „schnell Bescheid
         * wissen" ist, ist das zu traege, und zum Ausprobieren ist es
         * unbrauchbar.
         *
         * Die Webapp macht es laengst richtig: zeigeOffeneAlarme() laeuft dort
         * beim Anmelden (js/07-admin.js, aufgerufen aus showApp()). Die App
         * hinkte hinterher — genau das Muster, das dieser Baum sonst ueberall
         * verhindert, und das test/preisalarm-beide.test.js fuer jede andere
         * Haelfte dieses Themas schon festhaelt.
         *
         * Der Rumpf steht deshalb hier und nicht zweimal: Wer WANN gefragt
         * wird, entscheiden die beiden Aufrufer; WAS dabei geschieht, steht
         * einmal.
         *
         * Doppelte Meldungen kann das nicht geben — dafuer sorgt die Marke,
         * nicht der Aufrufer: Jeder Durchgang fragt „was hat seit `marke`
         * ausgeloest?" und schreibt den Zeitpunkt des Servers zurueck. Zwei
         * Durchgaenge kurz hintereinander liefern deshalb beim zweiten Mal
         * nichts.
         *
         * @return false NUR, wenn der Server nicht erreichbar war. Abgeschaltet
         *         oder nicht angemeldet ist ein erfolgreicher Durchgang ohne
         *         Arbeit: Ein retry() liesse WorkManager mit wachsendem Abstand
         *         weiterversuchen — fuer einen Zustand, der sich nicht von
         *         selbst aendert.
         */
        suspend fun durchgang(context: Context): Boolean {
            val zugang = EntryPointAccessors.fromApplication(context, Zugang::class.java)
            val prefs = zugang.prefs()
            if (!prefs.alarmMeldungenAn.first()) return true
            if (prefs.authToken.first().isBlank()) return true

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
         * Einplanen oder abbestellen.
         *
         * KEEP statt UPDATE: Ein bereits eingeplanter Auftrag soll bei jedem
         * App-Start weiterlaufen und nicht neu beginnen — sonst schoebe ein
         * haeufig geoeffneter App den naechsten Lauf immer wieder nach hinten
         * und der Abruf faende nie statt.
         *
         * ── Warum sie NICHT wirft (Marcos Befund vom 25.09.) ────────────────
         *
         *   „Sobald ich den Schalter Preisalarm in der App aktivieren will,
         *    wird die App geschlossen."
         *
         * Genau dieser Aufruf war an EINER seiner beiden Stellen abgesichert
         * und an der anderen nicht:
         *
         *   BrickInventoryApp.onCreate  runCatching { … einplanen(…) }
         *   SettingsScreen, am Schalter  einplanen(context, neu)
         *
         * Die erste Zeile gibt es, weil WorkManager auf Marcos Geraet schon
         * einmal beim Hochfahren gescheitert ist — der Manifest-Eintrag
         * darueber erzaehlt die ganze Geschichte und schliesst mit: „WARUM er
         * gescheitert ist, weiss bis heute niemand." Seither faehrt WorkManager
         * beim ERSTEN Zugriff hoch, und dieser Zugriff ist einplanen(). Am
         * Start faengt ihn das runCatching ab, die App laeuft weiter. Am
         * Schalter fing ihn nichts ab — und dort ist es der Hauptthread einer
         * sichtbaren Oberflaeche, also stirbt die App.
         *
         * Dieselbe Absicherung ein zweites Mal hinzuschreiben waere die
         * naheliegende und die schlechtere Loesung: Die naechste Aufrufstelle
         * vergisst sie wieder. Deshalb steht sie HIER, einmal, und die
         * Funktion kann gar nicht mehr werfen.
         *
         * @return null bei Erfolg, sonst der Fehler — damit der Aufrufer ihn
         *         ZEIGEN kann. Ein stilles Verschlucken waere die zweite Haelfte
         *         desselben Fehlers: Der Schalter stuende auf „an" und es kaeme
         *         nie eine Meldung.
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
                // ── Antippen oeffnet das Set (Marcos Wunsch vom 25.09.) ────
                //
                //   „dass ich in der Android App die notification anklicken
                //    kann und dann die App sowie das Set im Detaildialog
                //    geoeffnet wird."
                //
                // Ohne setContentIntent tut ein Antippen NICHTS — die Meldung
                // bleibt einfach stehen. Das faellt erst auf dem Geraet auf.
                //
                // CLEAR_TOP|SINGLE_TOP zusammen mit launchMode="singleTop" im
                // Manifest: Eine laufende App bekommt den Intent in
                // onNewIntent(), statt ein zweites Mal gestartet zu werden.
                // Ohne das haette der Nutzer nach dem Antippen zwei Instanzen
                // hintereinander im Zurueck-Stapel.
                //
                // requestCode: Zwei Meldungen zu VERSCHIEDENEN Sets brauchen
                // verschiedene PendingIntents. Mit demselben Code (etwa 0)
                // liefert das System denselben Intent zurueck — UPDATE_CURRENT
                // schriebe dann beiden dasselbe Set hinein, und die aeltere
                // Meldung oeffnete das falsche.
                //
                // MainActivity::class.java und NICHT Class.forName(): Ein Name
                // als Zeichenkette ist fuer R8 kein Aufruf. Genau daran ist am
                // 25.09. WorkDatabase_Impl gescheitert (siehe
                // proguard-rules.pro) — dieselbe Falle ein zweites Mal
                // aufzustellen waere schwer zu entschuldigen. Eine direkte
                // Referenz haelt die Klasse am Leben, ohne dass jemand eine
                // Keep-Regel pflegen muss.
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
