package ch.brickinventoryapp.catalog.ui

import ch.brickinventoryapp.model.domain.Alarmrichtung
import ch.brickinventoryapp.model.domain.Zustand

/**
 * "Add to watchlist" from the catalog detail. The threshold stays text: empty means
 * "no alert", not "threshold 0", and it's converted at the one place that
 * can do it (Alarmeingabe). [konto] is the target account, null without a household.
 */
data class Merkwunsch(
    val setNumber: String,
    val zustand: Zustand,
    val richtung: Alarmrichtung,
    val thresholdRaw: String,
    val konto: Int?,
)
