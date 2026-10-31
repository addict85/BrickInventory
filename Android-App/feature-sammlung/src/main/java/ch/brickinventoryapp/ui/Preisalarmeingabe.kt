package ch.brickinventoryapp.ui

import ch.brickinventoryapp.alarm.Alarmeingabe
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.data.repository.SetsRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Der Zustand, für den ein Alarm beim Öffnen gezeigt wird — der häufigere Fall. */
internal const val ALARM_ZUSTAND_VORGABE = "N"

/**
 * Die Schwelle eines Preisalarms, entprellt gespeichert — von Set-Detail und
 * Merkposten-Detail gemeinsam benutzt. Der Auftrag läuft im Scope des
 * ViewModels, damit er das Verlassen des Bildschirms übersteht: Wer tippt und
 * sofort zurückgeht, soll seine Eingabe nicht verlieren.
 */
internal class Preisalarmeingabe(
    private val scope: CoroutineScope,
    private val sets: SetsRepository,
    /** Meldung für den Meldungskanal; null heisst: nichts zu sagen. */
    private val melde: (String?) -> Unit,
    private val beschreibe: (Result.Error) -> String?,
    /** Nach dem Speichern: Alarme des Sets neu laden, Übersicht benachrichtigen. */
    private val gespeichert: (setNumber: String) -> Unit,
    private val ruhe: Long = Alarmeingabe.RUHE_MS,
) {
    private var job: Job? = null

    /** Leere oder unlesbare Eingabe löscht den Alarm dieses Zustands. */
    fun setze(setNumber: String, richtung: String, roh: String, zustand: String) {
        job?.cancel()
        job = scope.launch {
            delay(ruhe)
            val schwelle = Alarmeingabe.zahl(roh)
            val r = if (schwelle == null) sets.deletePreisalarm(setNumber, zustand)
                    else sets.setPreisalarm(setNumber, richtung, schwelle, zustand)
            when (r) {
                is Result.Success ->
                    if (r.data.success) gespeichert(setNumber) else melde(r.data.error ?: "")
                is Result.Error -> melde(beschreibe(r))
            }
        }
    }
}
