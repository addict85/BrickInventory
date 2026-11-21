package ch.brickinventoryapp.shared.ui

/**
 * The quantity badge, everywhere „×3“: under review, „3×“ (from a set) and
 * „×3“ (manual, gallery, finances) read side by side like two different pieces of information.
 * Two names remain, so callers say where the quantity comes from.
 */
fun mengeManuell(menge: Int): String = "×$menge"

fun mengeAusSet(menge: Int): String = mengeManuell(menge)
