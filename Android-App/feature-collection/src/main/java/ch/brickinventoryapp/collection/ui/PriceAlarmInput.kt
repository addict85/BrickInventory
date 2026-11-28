package ch.brickinventoryapp.collection.ui

import ch.brickinventoryapp.dataapi.alarm.AlarmInput
import ch.brickinventoryapp.dataapi.collection.AlarmRepository
import ch.brickinventoryapp.model.domain.AlarmDirection
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.outcome.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** The condition an alert is shown for on open — the more common case. */
internal val ALARM_STATE_DEFAULT = Condition.NEW

/**
 * A price alert's threshold, saved debounced — used jointly by the set detail
 * and the watchlist-item detail. The job runs in the ViewModel's scope, so
 * it survives leaving the screen: whoever types and goes back right
 * away shouldn't lose their input.
 */
internal class PriceAlarmInput(
    private val scope: CoroutineScope,
    private val alerts: AlarmRepository,
    /** Message for the message channel; null means: nothing to say. */
    private val report: (String?) -> Unit,
    private val describe: (Outcome.Failure) -> String?,
    /** After saving: reload the set's alerts, notify the overview. */
    private val saved: (setNumber: String) -> Unit,
    private val rest: Long = AlarmInput.QUIET_MS,
) {
    private var job: Job? = null

    /** An empty or unreadable input deletes this condition's alert. */
    fun set(setNumber: String, direction: AlarmDirection, raw: String, condition: Condition) {
        job?.cancel()
        job = scope.launch {
            delay(rest)
            val threshold = AlarmInput.number(raw)
            val r = if (threshold == null) alerts.deletePriceAlert(setNumber, condition)
                    else alerts.setPriceAlarm(setNumber, direction, threshold, condition)
            when (r) {
                is Outcome.Success -> saved(setNumber)
                is Outcome.Failure -> report(describe(r))
            }
        }
    }
}
