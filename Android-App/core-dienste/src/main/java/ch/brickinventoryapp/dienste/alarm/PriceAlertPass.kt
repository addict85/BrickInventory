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
import ch.brickinventoryapp.data.Credentials
import ch.brickinventoryapp.data.util.LanguageManager
import ch.brickinventoryapp.model.util.numbersLocale
import ch.brickinventoryapp.model.fach.PriceAlertView
import ch.brickinventoryapp.data.repository.AlarmRepository
import ch.brickinventoryapp.ressourcen.R
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.first
import java.util.Locale
import javax.inject.Inject

/** Ein Abruf der ausgelösten Preisalarme; der Worker stündlich, die App beim Öffnen. */
interface PriceAlertRepository {
    /** @return false nur, wenn der Server nicht erreichbar war. */
    suspend fun pass(): Boolean
}

/** Nachfragen, anzeigen, Marke setzen — mit den Ablagen aus dem Konstruktor statt aus einem EntryPoint. */
internal class PriceAlertPass @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val alerts: AlarmRepository,
    private val alarm: Alarmablage,
    private val access: Credentials,
    private val startziel: Startziel,
) : PriceAlertRepository {
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
    override suspend fun pass(): Boolean {
        if (!alarm.alarmMessagesAn.first()) return true
        if (access.tokenJetzt().isBlank()) return true

        val marke = alarm.alarmBrand.first()
        return when (val e = Alarmabholung.fetch(marke) { seit -> alerts.getPendingAlerts(seit) }) {
            is Alarmabholung.Ergebnis.Fehlgeschlagen -> false

            is Alarmabholung.Ergebnis.Markiert -> {
                alarm.setAlarmBrand(e.neueMarke)
                true
            }

            is Alarmabholung.Ergebnis.Geholt -> {
                zeige(e.meldungen)
                // IMMER speichern, auch ohne Meldung — sonst fragt der
                // naechste Durchgang wieder ab dem alten Zeitpunkt und
                // bringt dieselbe Meldung ein zweites Mal.
                alarm.setAlarmBrand(e.neueMarke)
                true
            }
        }
    }

    /**
     * Die Meldungen anzeigen — eine je gerissener Schwelle, gruppiert unter einer
     * Zusammenfassung: Man will ohne die App zu öffnen wissen, welcher Alarm gefallen
     * ist.
     */
    private fun zeige(meldungen: List<PriceAlertView>) {
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
                PreisalarmWorker.CHANNEL,
                context.getString(R.string.alert_channel_name),
                // DEFAULT, nicht HIGH: Ein Preisalarm ist wichtig, aber
                // nicht dringend — er soll nicht ueber den Bildschirm
                // fahren, waehrend jemand etwas anderes tut.
                NotificationManager.IMPORTANCE_DEFAULT,
            ).apply { description = context.getString(R.string.alert_channel_desc) }
        )

        // In der Sprache der App: Vor Android 13 sähe der Hintergrund sonst die des Systems.
        val texts = LanguageManager.localizedContext(context)
        val unter = texts.getString(R.string.detail_alert_below)
        val ueber = texts.getString(R.string.detail_alert_above)
        val zahlen = numbersLocale(texts.resources.configuration.locales[0], Locale.getDefault())
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
            val n = PreisalarmWorker.meldung(context, Alarmabholung.text(a, unter, ueber, zahlen), tippen)
            // Die Setnummer als ID: Zwei Meldungen zum selben Set
            // ueberschreiben sich, statt sich zu stapeln.
            nm.notify(PreisalarmWorker.CHANNEL + a.setNumber + a.condition, i + 1, n)
        }
    }
}
