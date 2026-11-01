package ch.brickinventoryapp.ui

import ch.brickinventoryapp.util.NetworkPolicy

/** Wo die App nach dem Start beginnt. */
enum class StartZiel { EINRICHTUNG, ANMELDUNG, SAMMLUNG }

/**
 * Eine gespeicherte http-Adresse führt in die Einrichtung, auch mit Token: Dort
 * steht, wie es mit https weitergeht. Ohne diesen Umweg sähe der Nutzer nur
 * Netzfehler, weil der Wächter jede Anfrage dorthin ablehnt.
 */
fun startZiel(serverUrl: String, angemeldet: Boolean, entwicklung: Boolean): StartZiel = when {
    serverUrl.isBlank() || NetworkPolicy.klartextAltbestand(serverUrl, entwicklung) -> StartZiel.EINRICHTUNG
    !angemeldet -> StartZiel.ANMELDUNG
    else -> StartZiel.SAMMLUNG
}
