package ch.brickinventoryapp.network.util

/**
 * The contract version this app is built against. The server states its own
 * (X-Api-Version) in every response, plus the lowest one it still works with
 * (X-Api-Min-App). The number only goes up on a change that breaks older
 * counterparts.
 */
const val APP_API_VERSION = 2

enum class VersionsHint { APP_TOO_OLD, SERVER_TO_OLD }

/** Null means: it fits, or the server says nothing about it (an older version). */
internal fun versionsHint(serverApi: Int?, minApp: Int?, appApi: Int = APP_API_VERSION): VersionsHint? = when {
    minApp != null && appApi < minApp -> VersionsHint.APP_TOO_OLD
    serverApi != null && serverApi < appApi -> VersionsHint.SERVER_TO_OLD
    else -> null
}
