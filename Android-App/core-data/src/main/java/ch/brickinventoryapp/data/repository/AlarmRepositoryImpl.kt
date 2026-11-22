package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.contract.PreisalarmRequest
import ch.brickinventoryapp.contract.mapping.asView
import ch.brickinventoryapp.data.NetworkState.RetryPolicy
import ch.brickinventoryapp.data.api.SetsApi
import ch.brickinventoryapp.model.domain.AlarmDirection
import ch.brickinventoryapp.model.domain.AlarmFetchView
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.domain.PriceAlertView
import ch.brickinventoryapp.model.local.Local
import ch.brickinventoryapp.offline.OfflineStore
import ch.brickinventoryapp.offline.OfflineStore.FollowUp
import ch.brickinventoryapp.offline.Slots
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/** Price alerts via Retrofit; setting and deleting update the store. */
@Singleton
class AlarmRepositoryImpl @Inject constructor(
    private val api: SetsApi,
    private val store: OfflineStore,
    private val retry: RetryPolicy,
) : AlarmRepository {

    override suspend fun getPendingAlerts(since: String?): Outcome<AlarmFetchView> =
        safeCall { api.getPendingAlerts(since) }
            .promised({ it.success }) { r -> AlarmFetchView(r.alerts.map { it.asView() }, r.now) }

    override fun observeAlerts(setNumber: String?): Flow<Local<PriceAlertView>> =
        store.observe(Slots.PRICE_ALARMS).map { l -> l.copy(list = l.list.filter { setNumber == null || it.setNumber == setNumber }) }

    /** The overview comes whole, without pages. */
    override suspend fun refreshAlerts(): Outcome<Unit> =
        store.refreshPaged(Slots.PRICE_ALARMS, { r -> r.alerts.map { it.asView() } }, { it.alerts.size }, retry) { _ ->
            safeCall { api.getAllAlerts() }
        }

    override suspend fun setPriceAlarm(setNumber: String, direction: AlarmDirection, threshold: Money,
                                       condition: Condition): Outcome<Unit> =
        store.caughtUp({ r -> r.alert?.takeIf { r.success }?.let { FollowUp.AlarmSet(it.asView()) } }) {
            safeCall { api.setPriceAlarm(setNumber, PreisalarmRequest(direction = direction, threshold = threshold.asDouble(), condition = condition)) }
        }.promised({ it.success }) { }

    override suspend fun deletePriceAlert(setNumber: String, condition: Condition): Outcome<Unit> =
        store.caughtUp({ r -> FollowUp.AlarmRemoved(setNumber, condition).takeIf { r.success } }) {
            safeCall { api.deletePriceAlert(setNumber, condition.identifier) }
        }.promised({ it.success }) { }
}
