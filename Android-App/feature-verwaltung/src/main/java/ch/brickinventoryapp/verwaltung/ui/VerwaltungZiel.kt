package ch.brickinventoryapp.verwaltung.ui

import kotlinx.serialization.Serializable

/** Die Verwalterseite. */
@Serializable
sealed interface VerwaltungZiel {
    @Serializable data object Monitoring : VerwaltungZiel
}
