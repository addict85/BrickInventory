package ch.brickinventoryapp.collection.ui

import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.data.alarm.Alarmeingabe
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.AlarmRepository
import ch.brickinventoryapp.model.domain.Alarmrichtung
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** The condition an alert is shown for on open — the more common case. */
internal val ALARM_STATE_DEFAULT = Zustand.NEU

/**
 * A price alert's threshold, saved debounced — used jointly by the set detail
 * and the watchlist-item detail. The job runs in the ViewModel's scope, so
 * it survives leaving the screen: whoever types and goes back right
 * away shouldn't lose their input.
 */
internal class Preisalarmeingabe(
    private val scope: CoroutineScope,
    private val alerts: AlarmRepository,
    /** Message for the message channel; null means: nothing to say. */
    private val melde: (String?) -> Unit,
    private val describe: (Ergebnis.Fehler) -> String?,
    /** After saving: reload the set's alerts, notify the overview. */
    private val gespeichert: (setNumber: String) -> Unit,
    private val rest: Long = Alarmeingabe.RUHE_MS,
) {
    private var job: Job? = null

    /** An empty or unreadable input deletes this condition's alert. */
    fun setze(setNumber: String, richtung: Alarmrichtung, roh: String, zustand: Zustand) {
        job?.cancel()
        job = scope.launch {
            delay(rest)
            val schwelle = Alarmeingabe.zahl(roh)
            val r = if (schwelle == null) alerts.deletePriceAlert(setNumber, zustand)
                    else alerts.setPreisalarm(setNumber, richtung, schwelle, zustand)
            when (r) {
                is Ergebnis.Erfolg -> gespeichert(setNumber)
                is Ergebnis.Fehler -> melde(describe(r))
            }
        }
    }
}
