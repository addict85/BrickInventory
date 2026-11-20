package ch.brickinventoryapp.verwaltung.ui

import kotlinx.serialization.Serializable

/** Die Verwalterseite. */
@Serializable
sealed interface ManagementTarget {
    @Serializable data object Monitoring : ManagementTarget
}
