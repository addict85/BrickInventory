package ch.brickinventoryapp.ui.theme

import ch.brickinventoryapp.model.appearance.Brightness
import ch.brickinventoryapp.model.appearance.Design

/**
 * What is drawn: the server's theme, in its dark variant where
 * needed — or, with [systemColors], the colors of the wallpaper (Material You).
 */
data class Appearance(val design: Design, val dark: Boolean, val systemColors: Boolean = false)

/** From Android 12 (API 31) onward, the system supplies its own color schemes. */
const val SYSTEM_COLORS_AB_SDK = 31

/**
 * [brightness] (Brightness.SYSTEM/LIGHT/DARK) decides whether the dark variant
 * applies for the SAME theme as on the web (data-dunkel), not a different theme.
 * Werkbank is already dark and stays as it is. System colors always have a
 * dark variant; below Android 12 they don't exist, then the theme applies.
 */
fun appearance(
    design: Design, brightness: String, systemDark: Boolean,
    systemColors: Boolean = false, sdk: Int = 0,
): Appearance {
    val dynamic = systemColors && sdk >= SYSTEM_COLORS_AB_SDK
    val desired = when (brightness) {
        Brightness.DARK -> true
        Brightness.LIGHT -> false
        else -> systemDark
    }
    return Appearance(design, desired && brightnessSelectable(design, systemColors, sdk), dynamic)
}

/**
 * Does the light/dark choice have any effect for this theme? Not for a theme without a dark
 * variant (Werkbank is already dark) — settings then disable the choice,
 * instead of offering a switch with no effect.
 */
fun brightnessSelectable(design: Design, systemColors: Boolean = false, sdk: Int = 0): Boolean =
    (systemColors && sdk >= SYSTEM_COLORS_AB_SDK) || hasDarkVersion(design)
