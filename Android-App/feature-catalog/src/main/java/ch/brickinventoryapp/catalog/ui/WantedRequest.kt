package ch.brickinventoryapp.catalog.ui

import ch.brickinventoryapp.model.domain.AlarmDirection
import ch.brickinventoryapp.model.domain.Condition

/**
 * "Add to watchlist" from the catalog detail. The threshold stays text: empty means
 * "no alert", not "threshold 0", and it's converted at the one place that
 * can do it (AlarmInput). [account] is the target account, null without a household.
 */
data class WantedRequest(
    val setNumber: String,
    val condition: Condition,
    val direction: AlarmDirection,
    val thresholdRaw: String,
    val account: Int?,
)
