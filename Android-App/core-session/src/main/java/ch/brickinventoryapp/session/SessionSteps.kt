package ch.brickinventoryapp.session

import ch.brickinventoryapp.data.LogoutPath

/** Sign out, the way SessionService triggers it; this lets its test run without a context and image loader. */
fun interface LogoutProcess {
    /** Reports whether the server revokes the token only later; null without a sign-in. */
    suspend fun execute(): LogoutPath?
}

/** The one step that SessionService knows from warming up. */
fun interface WarmUp {
    fun kick()
}

/**
 * What SessionService loads after a sign-in. The Blickfeld that holds these
 * lists lives one layer up, in the state (core-state); the session only knows these
 * four steps, otherwise it would depend on the scopes' filters.
 */
interface FilterSource {
    suspend fun loadFilter()
    suspend fun loadMembers()
    suspend fun fetchStorageLocations()
    suspend fun loadOwnLocations()
}
