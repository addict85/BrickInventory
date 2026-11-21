package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.model.domain.AlarmabrufView
import ch.brickinventoryapp.model.domain.PriceAlertView
import ch.brickinventoryapp.model.domain.Alarmrichtung
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.model.local.Local
import kotlinx.coroutines.flow.Flow

/**
 * Price alerts of the account. The list lies in the store like the others; its
 * marker `ausgeloest` is set by the server's price run, hence every view fetches
 * [refreshAlerts] on opening and shows what the store then has.
 */
interface AlarmRepository {
    /**
     * What has triggered since [since]. Never stored: the response applies exactly once —
     * read twice, the same notification would come twice.
     */
    suspend fun getPendingAlerts(since: String?): Ergebnis<AlarmabrufView>

    /** The alerts from the store; with [setNumber] only those of this set. */
    fun observeAlerts(setNumber: String? = null): Flow<Local<PriceAlertView>>

    /** All alerts of the account from the server into the store. */
    suspend fun refreshAlerts(): Ergebnis<Unit>

    suspend fun setPreisalarm(setNumber: String, richtung: Alarmrichtung, schwelle: Geld,
                              condition: Zustand = Zustand.NEU): Ergebnis<Unit>

    suspend fun deletePriceAlert(setNumber: String, condition: Zustand = Zustand.NEU): Ergebnis<Unit>
}
