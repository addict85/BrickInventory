package ch.brickinventoryapp.sammlung.ui

import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.data.alarm.Alarmeingabe
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.AlarmRepository
import ch.brickinventoryapp.model.fach.Alarmrichtung
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Der Zustand, für den ein Alarm beim Öffnen gezeigt wird — der häufigere Fall. */
internal val ALARM_STATE_DEFAULT = Zustand.NEU

/**
 * Die Schwelle eines Preisalarms, entprellt gespeichert — von Set-Detail und
 * Merkposten-Detail gemeinsam benutzt. Der Auftrag läuft im Scope des
 * ViewModels, damit er das Verlassen des Bildschirms übersteht: Wer tippt und
 * sofort zurückgeht, soll seine Eingabe nicht verlieren.
 */
internal class Preisalarmeingabe(
    private val scope: CoroutineScope,
    private val alerts: AlarmRepository,
    /** Meldung für den Meldungskanal; null heisst: nichts zu sagen. */
    private val melde: (String?) -> Unit,
    private val describe: (Ergebnis.Fehler) -> String?,
    /** Nach dem Speichern: Alarme des Sets neu laden, Übersicht benachrichtigen. */
    private val gespeichert: (setNumber: String) -> Unit,
    private val rest: Long = Alarmeingabe.RUHE_MS,
) {
    private var job: Job? = null

    /** Leere oder unlesbare Eingabe löscht den Alarm dieses Zustands. */
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
