package ch.brickinventoryapp.model.util

/**
 * The minimum length of a password — in one place.
 * A constant, because a number typed anew at every place drifts apart.
 */

const val PASSWORD_MIN_CHARS = 12

/** Is this password too short? */
fun passwordToShort(passwort: String): Boolean = passwort.length < PASSWORD_MIN_CHARS
