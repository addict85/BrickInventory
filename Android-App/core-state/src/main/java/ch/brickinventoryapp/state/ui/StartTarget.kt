package ch.brickinventoryapp.state.ui

import ch.brickinventoryapp.network.util.NetworkPolicy

/** Where the app starts after launch. */
enum class StartTarget { SETUP, LOGIN, COLLECTION }

/**
 * A stored http address leads into setup, even with a token: that's where
 * it says how to proceed to https. Without this detour, the user would only see
 * network errors, because the guard rejects every request there.
 */
fun startTarget(serverUrl: String, loggedIn: Boolean, development: Boolean): StartTarget = when {
    serverUrl.isBlank() || NetworkPolicy.plaintextLegacyStock(serverUrl, development) -> StartTarget.SETUP
    !loggedIn -> StartTarget.LOGIN
    else -> StartTarget.COLLECTION
}
