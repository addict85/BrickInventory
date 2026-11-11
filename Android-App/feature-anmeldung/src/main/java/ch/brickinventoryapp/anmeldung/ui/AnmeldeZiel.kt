package ch.brickinventoryapp.anmeldung.ui

import kotlinx.serialization.Serializable

/** Die Ziele der Anmeldung; die App beginnt in einem von ihnen. */
@Serializable
sealed interface AnmeldeZiel {
    @Serializable data object Setup : AnmeldeZiel
    @Serializable data object Login : AnmeldeZiel

    /**
     * Der Teilgraph aus Einrichtung und Anmeldung. Kein Ziel, sondern der Halter des
     * ViewModels, das beide teilen; darum steht er nicht in der Liste der Ziele.
     */
    @Serializable data object Bereich
}
