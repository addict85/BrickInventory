package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.domain.AlarmFetchView
import ch.brickinventoryapp.model.domain.PriceAlertView
import ch.brickinventoryapp.model.domain.AlarmDirection
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.local.Local
import kotlinx.coroutines.flow.Flow

/**
 * Price alerts of the account. The list lies in the store like the others; its
 * marker `triggered` is set by the server's price run, hence every view fetches
 * [refreshAlerts] on opening and shows what the store then has.
 */
interface AlarmRepository {
    /**
     * What has triggered since [since]. Never stored: the response applies exactly once —
     * read twice, the same notification would come twice.
     */
    suspend fun getPendingAlerts(since: String?): Outcome<AlarmFetchView>

    /** The alerts from the store; with [setNumber] only those of this set. */
    fun observeAlerts(setNumber: String? = null): Flow<Local<PriceAlertView>>

    /** All alerts of the account from the server into the store. */
    suspend fun refreshAlerts(): Outcome<Unit>

    suspend fun setPriceAlarm(setNumber: String, direction: AlarmDirection, threshold: Money,
                              condition: Condition = Condition.NEW): Outcome<Unit>

    suspend fun deletePriceAlert(setNumber: String, condition: Condition = Condition.NEW): Outcome<Unit>
}
