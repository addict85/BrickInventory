package ch.brickinventoryapp.model.util

import java.net.URI

/**
 * The address for the authenticator app: only `otpauth://totp|hotp/…`. It comes
 * from the server and goes out via ACTION_VIEW; another scheme (`intent:`,
 * `https:`, `content:`) would otherwise open an arbitrary target and give it the secret.
 */
fun otpauthAddress(url: String?): String? {
    val roh = url?.trim()?.takeIf { it.isNotEmpty() && it.none(Char::isWhitespace) } ?: return null
    val uri = runCatching { URI(roh) }.getOrNull() ?: return null
    if (!uri.scheme.equals("otpauth", ignoreCase = true) || uri.isOpaque) return null
    return roh.takeIf { uri.host?.lowercase() in setOf("totp", "hotp") }
}
