package ch.brickinventoryapp.zustand.ui

import ch.brickinventoryapp.netz.util.NetworkPolicy

/** Wo die App nach dem Start beginnt. */
enum class StartTarget { EINRICHTUNG, LOGIN, SAMMLUNG }

/**
 * Eine gespeicherte http-Adresse führt in die Einrichtung, auch mit Token: Dort
 * steht, wie es mit https weitergeht. Ohne diesen Umweg sähe der Nutzer nur
 * Netzfehler, weil der Wächter jede Anfrage dorthin ablehnt.
 */
fun startTarget(serverUrl: String, angemeldet: Boolean, entwicklung: Boolean): StartTarget = when {
    serverUrl.isBlank() || NetworkPolicy.plaintextLegacyStock(serverUrl, entwicklung) -> StartTarget.EINRICHTUNG
    !angemeldet -> StartTarget.LOGIN
    else -> StartTarget.SAMMLUNG
}
