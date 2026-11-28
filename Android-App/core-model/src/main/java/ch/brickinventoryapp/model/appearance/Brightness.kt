package ch.brickinventoryapp.model.appearance

/**
 * Does „dark by system" apply? Without a saved choice yes — an app that stays light
 * at night although the phone is dark looks broken. Whoever explicitly
 * chose „server design" earlier keeps that.
 */

fun darkAfterSystemApplies(saved: Boolean?): Boolean = saved ?: true

/** Light, dark or like the system — per device, in the settings under „Darstellung“. */
object Brightness {
    const val SYSTEM = "system"
    const val LIGHT = "hell"
    const val DARK = "dunkel"
}

/**
 * The effective choice: the saved one, otherwise the earlier yes/no choice „dark
 * by system“ (yes → system, no → light), so that nobody sees differently after the update.
 */
fun brightnessApplies(saved: String?, earlierAfterSystem: Boolean?): String =
    saved?.takeIf { it == Brightness.SYSTEM || it == Brightness.LIGHT || it == Brightness.DARK }
        ?: if (darkAfterSystemApplies(earlierAfterSystem)) Brightness.SYSTEM else Brightness.LIGHT
