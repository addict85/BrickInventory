package ch.brickinventoryapp.ui

/**
 * Die Mengenplakette in der Schreibweise der Webapp: manuell erfasst steht das
 * Zeichen vor der Zahl (qbadge, „×3“), aus einem Set dahinter (part-qty, „3×“).
 * Eine Stelle für beide, damit Teile und Figuren nicht auseinanderlaufen.
 */
fun mengeManuell(menge: Int): String = "×$menge"

fun mengeAusSet(menge: Int): String = "$menge×"
