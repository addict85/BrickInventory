package ch.brickinventoryapp.model.util

/**
 * The minimum length of a password — in one place.
 * A constant, because a number typed anew at every place drifts apart.
 */

const val PASSWORD_MIN_CHARS = 12

/** Is this password too short? */
fun passwordToShort(password: String): Boolean = password.length < PASSWORD_MIN_CHARS
