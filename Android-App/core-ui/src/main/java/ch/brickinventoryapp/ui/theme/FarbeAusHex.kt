package ch.brickinventoryapp.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * The color of a part from the server's hex value ("rrggbb", with or without "#",
 * also "aarrggbb"); null if it's missing or not one. One place instead of eight,
 * so the error case and opacity come out the same everywhere.
 */
fun argbFromHex(hex: String?): Long? {
    val roh = hex?.trim()?.removePrefix("#") ?: return null
    if (roh.isEmpty() || roh.any { it !in "0123456789abcdefABCDEF" }) return null
    return when (roh.length) {
        6 -> 0xFF000000L or roh.toLong(16)
        8 -> roh.toLong(16)
        else -> null
    }
}

/** [argbFromHex] as a Compose color. */
fun colorFromHex(hex: String?): Color? = argbFromHex(hex)?.let { Color(it) }
