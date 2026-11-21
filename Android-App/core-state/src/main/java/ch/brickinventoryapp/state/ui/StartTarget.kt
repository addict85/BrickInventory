package ch.brickinventoryapp.state.ui

import ch.brickinventoryapp.network.util.NetworkPolicy

/** Where the app starts after launch. */
enum class StartTarget { EINRICHTUNG, LOGIN, SAMMLUNG }

/**
 * A stored http address leads into setup, even with a token: that's where
 * it says how to proceed to https. Without this detour, the user would only see
 * network errors, because the guard rejects every request there.
 */
fun startTarget(serverUrl: String, angemeldet: Boolean, entwicklung: Boolean): StartTarget = when {
    serverUrl.isBlank() || NetworkPolicy.plaintextLegacyStock(serverUrl, entwicklung) -> StartTarget.EINRICHTUNG
    !angemeldet -> StartTarget.LOGIN
    else -> StartTarget.SAMMLUNG
}
