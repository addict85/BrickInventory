package ch.brickinventoryapp.session

import ch.brickinventoryapp.data.Abmeldeweg

/** Sign out, the way SitzungsDienst triggers it; this lets its test run without a context and image loader. */
fun interface Abmeldevorgang {
    /** Reports whether the server revokes the token only later; null without a sign-in. */
    suspend fun ausfuehren(): Abmeldeweg?
}

/** The one step that SitzungsDienst knows from warming up. */
fun interface WarmUp {
    fun kick()
}

/**
 * What SitzungsDienst loads after a sign-in. The Blickfeld that holds these
 * lists lives one layer up, in the state (core-state); the session only knows these
 * four steps, otherwise it would depend on the scopes' filters.
 */
interface Filterquelle {
    suspend fun loadFilter()
    suspend fun loadMembers()
    suspend fun ladeLagerorte()
    suspend fun loadOwnLocations()
}
