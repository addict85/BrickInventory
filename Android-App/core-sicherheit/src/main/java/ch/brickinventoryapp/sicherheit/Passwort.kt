package ch.brickinventoryapp.sicherheit

/**
 * Die Mindestlaenge eines Passworts — an einer Stelle.
 * Eine Konstante, weil eine an jeder Stelle neu getippte Zahl auseinanderläuft.
 */
const val PASSWORT_MIN_ZEICHEN = 12

/** Ist dieses Passwort zu kurz? */
fun passwortZuKurz(passwort: String): Boolean = passwort.length < PASSWORT_MIN_ZEICHEN
