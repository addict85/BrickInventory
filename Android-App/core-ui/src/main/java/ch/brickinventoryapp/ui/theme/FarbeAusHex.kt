package ch.brickinventoryapp.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * Die Farbe eines Teils aus dem Hex-Wert des Servers ("rrggbb", mit oder ohne "#",
 * auch "aarrggbb"); null, wenn er fehlt oder keiner ist. Eine Stelle statt acht,
 * damit Fehlerfall und Deckkraft überall gleich ausfallen.
 */
fun argbAusHex(hex: String?): Long? {
    val roh = hex?.trim()?.removePrefix("#") ?: return null
    if (roh.isEmpty() || roh.any { it !in "0123456789abcdefABCDEF" }) return null
    return when (roh.length) {
        6 -> 0xFF000000L or roh.toLong(16)
        8 -> roh.toLong(16)
        else -> null
    }
}

/** [argbAusHex] als Compose-Farbe. */
fun farbeAusHex(hex: String?): Color? = argbAusHex(hex)?.let { Color(it) }
