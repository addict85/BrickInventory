package ch.brickinventoryapp.dienste.alarm

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import ch.brickinventoryapp.data.Alarmablage
import ch.brickinventoryapp.data.Startziel
import ch.brickinventoryapp.data.Zugangsdaten
import ch.brickinventoryapp.model.data.model.Preisalarm
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.ressourcen.R
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.first
import javax.inject.Inject

/** Ein Abruf der ausgelösten Preisalarme; der Worker stündlich, die App beim Öffnen. */
interface PreisalarmRepository {
    /** @return false nur, wenn der Server nicht erreichbar war. */
    suspend fun durchgang(): Boolean
}

/** Nachfragen, anzeigen, Marke setzen — mit den Ablagen aus dem Konstruktor statt aus einem EntryPoint. */
internal class PreisalarmDurchgang @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val sets: SetsRepository,
    private val alarm: Alarmablage,
    private val zugang: Zugangsdaten,
    private val startziel: Startziel,
) : PreisalarmRepository {
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
    override suspend fun durchgang(): Boolean {
        if (!alarm.alarmMeldungenAn.first()) return true
        if (zugang.tokenJetzt().isBlank()) return true

        val marke = alarm.alarmMarke.first()
        return when (val e = Alarmabholung.hole(marke) { seit -> sets.getPendingAlerts(seit) }) {
            is Alarmabholung.Ergebnis.Fehlgeschlagen -> false

            is Alarmabholung.Ergebnis.Markiert -> {
                alarm.setzeAlarmMarke(e.neueMarke)
                true
            }

            is Alarmabholung.Ergebnis.Geholt -> {
                zeige(e.meldungen)
                // IMMER speichern, auch ohne Meldung — sonst fragt der
                // naechste Durchgang wieder ab dem alten Zeitpunkt und
                // bringt dieselbe Meldung ein zweites Mal.
                alarm.setzeAlarmMarke(e.neueMarke)
                true
            }
        }
    }

    /**
     * Die Meldungen anzeigen — eine je gerissener Schwelle, gruppiert unter einer
     * Zusammenfassung: Man will ohne die App zu öffnen wissen, welcher Alarm gefallen
     * ist.
     */
    private fun zeige(meldungen: List<Preisalarm>) {
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
                PreisalarmWorker.KANAL,
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
            // Ziel ist der nicht exportierte Einstieg der App (Startziel); er reicht an die
            // laufende App weiter. Ein requestCode je Set, sonst lieferte das System denselben
            // PendingIntent und die ältere Meldung öffnete das falsche Set. Die Klasse kommt
            // als Klasse, nicht als Name über Class.forName(), damit R8 sie ohne Keep-Regel behält.
            val ziel = Intent(context, startziel.aktivitaet).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
                putExtra(PreisalarmWorker.EXTRA_SET, a.setNumber)
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
            val n = PreisalarmWorker.meldung(context, Alarmabholung.text(a, unter, ueber), tippen)
            // Die Setnummer als ID: Zwei Meldungen zum selben Set
            // ueberschreiben sich, statt sich zu stapeln.
            nm.notify(PreisalarmWorker.KANAL + a.setNumber + a.condition, i + 1, n)
        }
    }
}
