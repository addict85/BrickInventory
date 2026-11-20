package ch.brickinventoryapp.model.util

/**
 * Die Mindestlaenge eines Passworts — an einer Stelle.
 * Eine Konstante, weil eine an jeder Stelle neu getippte Zahl auseinanderläuft.
 */

const val PASSWORD_MIN_CHARS = 12

/** Ist dieses Passwort zu kurz? */
fun passwordToShort(passwort: String): Boolean = passwort.length < PASSWORD_MIN_CHARS
