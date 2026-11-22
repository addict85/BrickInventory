package ch.brickinventoryapp.account.ui

import ch.brickinventoryapp.ui.TabTarget
import kotlinx.serialization.Serializable

/** Settings and its subpages. */
@Serializable
sealed interface AccountTarget {
    @Serializable data object Settings : AccountTarget, TabTarget {
        override val rollKey get() = "settings"
    }
    @Serializable data object PriceAlarms : AccountTarget
    @Serializable data object StorageLocations : AccountTarget
    @Serializable data object Household : AccountTarget
    @Serializable data object CsvImport : AccountTarget
    @Serializable data object Account : AccountTarget
}
