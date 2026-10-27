package ch.brickinventoryapp.util

/**
 * Die Fassung der Schnittstelle, gegen die diese App gebaut ist. Der Server
 * nennt in jeder Antwort seine eigene (X-Api-Version) und die kleinste, mit
 * der er noch zusammenarbeitet (X-Api-Min-App). Erhöht wird die Zahl nur bei
 * einer Änderung, die alte Gegenstücke bricht.
 */
const val APP_API_VERSION = 1

enum class VersionsHinweis { APP_ZU_ALT, SERVER_ZU_ALT }

/** Null heisst: passt, oder der Server sagt nichts dazu (ältere Fassung). */
fun versionsHinweis(serverApi: Int?, minApp: Int?, appApi: Int = APP_API_VERSION): VersionsHinweis? = when {
    minApp != null && appApi < minApp -> VersionsHinweis.APP_ZU_ALT
    serverApi != null && serverApi < appApi -> VersionsHinweis.SERVER_ZU_ALT
    else -> null
}
