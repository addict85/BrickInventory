package ch.brickinventoryapp.login.ui

import kotlinx.serialization.Serializable

/** The sign-in destinations; the app starts in one of them. */
@Serializable
sealed interface LoginTarget {
    @Serializable data object Setup : LoginTarget
    @Serializable data object Login : LoginTarget

    /**
     * The subgraph made of setup and sign-in. Not a destination but the holder of the
     * ViewModel they share; that is why it is not in the list of destinations.
     */
    @Serializable data object Bereich
}
