package ch.brickinventoryapp.netz.util

/**
 * The contract version this app is built against. The server states its own
 * (X-Api-Version) in every response, plus the lowest one it still works with
 * (X-Api-Min-App). The number only goes up on a change that breaks older
 * counterparts.
 */
const val APP_API_VERSION = 2

enum class VersionsHinweis { APP_ZU_ALT, SERVER_ZU_ALT }

/** Null means: it fits, or the server says nothing about it (an older version). */
internal fun versionsHinweis(serverApi: Int?, minApp: Int?, appApi: Int = APP_API_VERSION): VersionsHinweis? = when {
    minApp != null && appApi < minApp -> VersionsHinweis.APP_ZU_ALT
    serverApi != null && serverApi < appApi -> VersionsHinweis.SERVER_ZU_ALT
    else -> null
}
