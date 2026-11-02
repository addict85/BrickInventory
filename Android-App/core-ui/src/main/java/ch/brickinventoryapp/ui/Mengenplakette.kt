package ch.brickinventoryapp.ui

/**
 * Die Mengenplakette, überall „×3“: In der Prüfung lasen „3×“ (aus einem Set) und
 * „×3“ (manuell, Galerie, Finanzen) nebeneinander wie zwei verschiedene Angaben.
 * Zwei Namen bleiben, damit die Aufrufer sagen, woher die Menge kommt.
 */
fun mengeManuell(menge: Int): String = "×$menge"

fun mengeAusSet(menge: Int): String = mengeManuell(menge)
