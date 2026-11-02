package ch.brickinventoryapp.ui

/**
 * Wofür ein Ladefehler steht, grob genug für Symbol, Überschrift und Rat: Wer offline
 * ist, soll das Netz prüfen, wer abgemeldet wurde, sich anmelden. Ein roher Satz wie
 * „Serverfehler (500)“ allein sagte weder das eine noch das andere.
 */
enum class Fehlerklasse { OFFLINE, SERVER, ANMELDUNG, UNBEKANNT }
