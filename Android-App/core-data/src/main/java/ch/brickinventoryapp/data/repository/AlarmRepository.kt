package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.fach.Geld
import ch.brickinventoryapp.model.fach.AlarmabrufAnsicht
import ch.brickinventoryapp.model.fach.PreisalarmAnsicht
import ch.brickinventoryapp.model.fach.Alarmrichtung
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.lokal.Lokal
import kotlinx.coroutines.flow.Flow

/**
 * Preisalarme des Kontos. Die Liste liegt in der Ablage wie die übrigen; ihren
 * Merker `ausgeloest` setzt der Preislauf des Servers, deshalb holt jede Ansicht
 * beim Öffnen [aktualisiereAlarme] und zeigt, was die Ablage dann hat.
 */
interface AlarmRepository {
    /**
     * Was seit [since] ausgelöst hat. Nie abgelegt: Die Antwort gilt genau einmal —
     * zweimal gelesen, käme dieselbe Meldung zweimal.
     */
    suspend fun getPendingAlerts(since: String?): Ergebnis<AlarmabrufAnsicht>

    /** Die Alarme aus der Ablage; mit [setNumber] nur die dieses Sets. */
    fun beobachteAlarme(setNumber: String? = null): Flow<Lokal<PreisalarmAnsicht>>

    /** Alle Alarme des Kontos vom Server in die Ablage. */
    suspend fun aktualisiereAlarme(): Ergebnis<Unit>

    suspend fun setPreisalarm(setNumber: String, richtung: Alarmrichtung, schwelle: Geld,
                              condition: Zustand = Zustand.NEU): Ergebnis<Unit>

    suspend fun deletePreisalarm(setNumber: String, condition: Zustand = Zustand.NEU): Ergebnis<Unit>
}
