package ch.brickinventoryapp.model.util

import java.net.URI

/**
 * Die Adresse für die Authenticator-App: nur `otpauth://totp|hotp/…`. Sie kommt
 * vom Server und geht per ACTION_VIEW hinaus; ein anderes Schema (`intent:`,
 * `https:`, `content:`) öffnete sonst ein beliebiges Ziel und gäbe ihm das Geheimnis.
 */
fun otpauthAdresse(url: String?): String? {
    val roh = url?.trim()?.takeIf { it.isNotEmpty() && it.none(Char::isWhitespace) } ?: return null
    val uri = runCatching { URI(roh) }.getOrNull() ?: return null
    if (!uri.scheme.equals("otpauth", ignoreCase = true) || uri.isOpaque) return null
    return roh.takeIf { uri.host?.lowercase() in setOf("totp", "hotp") }
}
