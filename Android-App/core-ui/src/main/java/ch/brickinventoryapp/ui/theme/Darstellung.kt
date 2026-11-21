package ch.brickinventoryapp.ui.theme

import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.model.ui.theme.Helligkeit

/**
 * What is drawn: the server's theme, in its dark variant where
 * needed — or, with [systemfarben], the colors of the wallpaper (Material You).
 */
data class Darstellung(val design: Design, val dunkel: Boolean, val systemfarben: Boolean = false)

/** From Android 12 (API 31) onward, the system supplies its own color schemes. */
const val SYSTEMFARBEN_AB_SDK = 31

/**
 * [helligkeit] (Helligkeit.SYSTEM/LIGHT/DARK) decides whether the dark variant
 * applies for the SAME theme as on the web (data-dunkel), not a different theme.
 * Werkbank is already dark and stays as it is. System colors always have a
 * dark variant; below Android 12 they don't exist, then the theme applies.
 */
fun darstellung(
    design: Design, helligkeit: String, systemDark: Boolean,
    systemfarben: Boolean = false, sdk: Int = 0,
): Darstellung {
    val dynamisch = systemfarben && sdk >= SYSTEMFARBEN_AB_SDK
    val gewuenscht = when (helligkeit) {
        Helligkeit.DARK -> true
        Helligkeit.LIGHT -> false
        else -> systemDark
    }
    return Darstellung(design, gewuenscht && brightnessSelectable(design, systemfarben, sdk), dynamisch)
}

/**
 * Does the light/dark choice have any effect for this theme? Not for a theme without a dark
 * variant (Werkbank is already dark) — settings then disable the choice,
 * instead of offering a switch with no effect.
 */
fun brightnessSelectable(design: Design, systemfarben: Boolean = false, sdk: Int = 0): Boolean =
    (systemfarben && sdk >= SYSTEMFARBEN_AB_SDK) || hatDarkVersion(design)
