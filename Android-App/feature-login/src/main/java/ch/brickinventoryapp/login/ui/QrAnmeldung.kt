package ch.brickinventoryapp.login.ui

import ch.brickinventoryapp.network.util.NetworkPolicy
import ch.brickinventoryapp.security.isFingerprint

/**
 * The content of a sign-in QR code: `{"url": …, "token": "bim:…", "fp": …}`.
 * `fp` is optional — SHA-256 of the SubjectPublicKeyInfo, Base64. If it is there, the
 * app pins exactly this key and does not ask on first contact.
 */
data class QrLoginPayload(val url: String, val token: String, val fingerabdruck: String? = null)

/** http is rejected only by the dialog, with an explanation; these errors make the code invalid. */
private val QR_REJECTED = setOf(NetworkPolicy.AddressError.UNLESBAR, NetworkPolicy.AddressError.USER_INPUT,
    NetworkPolicy.AddressError.EXTRA)

/**
 * Checked before trimming: a code has no reason for whitespace, but with a
 * line break an attacker could place a second, harmless-looking name in the dialog.
 */
internal fun qrAddressInvalid(url: String): Boolean =
    url.any { it.isWhitespace() || it.isISOControl() } ||
        NetworkPolicy.addressError(url, NetworkPolicy.entwicklung) in QR_REJECTED

/**
 * An unreadable `fp` makes the whole code invalid: silently continuing without
 * a pin would mean leaving out the check the server demands.
 */
internal fun parseQrPayload(raw: String): QrLoginPayload? = try {
    val obj = org.json.JSONObject(raw)
    val url = obj.optString("url", "")
    val token = obj.optString("token", "")
    val fp = obj.optString("fp", "").trim().ifEmpty { null }
    when {
        url.isBlank() || !token.startsWith("bim:") -> null
        qrAddressInvalid(url) -> null
        fp != null && !isFingerprint(fp) -> null
        // A pin over http gives nothing: there is no certificate there.
        fp != null && !url.trim().lowercase().startsWith("https://") -> null
        else -> QrLoginPayload(url, token, fp)
    }
} catch (_: Exception) { null }

/**
 * Taken over only after an explicit yes to the shown destination: anyone can
 * hold up a code, and whoever just taps „Übernehmen“ has not read the name above it.
 */
internal fun qrUebernehmbar(gesperrt: Boolean, targetConfirmed: Boolean, abtippen: Boolean, eingabe: String): Boolean =
    !gesperrt && targetConfirmed && (!abtippen || eingabe.isNotBlank())

/**
 * The host of the previous server, if the code leads elsewhere: the yes signs out
 * there and sends everything else to the new server, so the dialog says so.
 */
internal fun qrSwitchesServer(bisher: String, code: String): String? {
    if (bisher.isBlank() || NetworkPolicy.sameOrigin(bisher, NetworkPolicy.normalize(code))) return null
    return NetworkPolicy.ansicht(bisher)?.host
}
