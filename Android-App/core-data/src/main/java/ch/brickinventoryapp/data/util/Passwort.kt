package ch.brickinventoryapp.data.util

/**
 * Die Mindestlaenge eines Passworts — an einer Stelle.
 * Ausführlich: docs/begruendungen/core-data/data/util/Passwort.kt.md#passwort-min-zeichen
 */
const val PASSWORT_MIN_ZEICHEN = 12

/** Ist dieses Passwort zu kurz? */
fun passwortZuKurz(passwort: String): Boolean = passwort.length < PASSWORT_MIN_ZEICHEN
