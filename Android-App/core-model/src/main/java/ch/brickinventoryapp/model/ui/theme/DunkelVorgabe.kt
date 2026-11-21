package ch.brickinventoryapp.model.ui.theme

/**
 * Does „dark by system" apply? Without a saved choice yes — an app that stays light
 * at night although the phone is dark looks broken. Whoever explicitly
 * chose „server design" earlier keeps that.
 */

fun darkAfterSystemApplies(gespeichert: Boolean?): Boolean = gespeichert ?: true

/** Light, dark or like the system — per device, in the settings under „Darstellung“. */
object Helligkeit {
    const val SYSTEM = "system"
    const val LIGHT = "hell"
    const val DARK = "dunkel"
}

/**
 * The effective choice: the saved one, otherwise the earlier yes/no choice „dark
 * by system“ (yes → system, no → light), so that nobody sees differently after the update.
 */
fun brightnessApplies(gespeichert: String?, earlierAfterSystem: Boolean?): String =
    gespeichert?.takeIf { it == Helligkeit.SYSTEM || it == Helligkeit.LIGHT || it == Helligkeit.DARK }
        ?: if (darkAfterSystemApplies(earlierAfterSystem)) Helligkeit.SYSTEM else Helligkeit.LIGHT
