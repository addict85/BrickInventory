package ch.brickinventoryapp.security

import ch.brickinventoryapp.security.CertificateQuestion.CodeCheck
import java.security.MessageDigest
import java.util.Base64

/**
 * The QR code the web app shows under Settings → App → Server certificate:
 * `brickinventory-cert:v1:spki-sha256:<64 hex>`. Always the whole hash and never a short form:
 * 24 hex digits would already be in reach of someone grinding keys of their own until the end fits.
 */
internal object CertificateCode {
    private const val PREFIX = "brickinventory-cert:"
    private const val VERSION = "v1"
    private const val HASH = "spki-sha256"
    private const val HASH_BYTES = 32

    /** The 32 bytes of a v1 code, or null; [check] says why not. */
    fun parse(payload: String?): ByteArray? = hexOf(payload)?.let { hex ->
        ByteArray(HASH_BYTES) { hex.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
    }

    /**
     * Compares the whole code with [fingerprint] (Base64, as in [CertificateUnresolved]). Constant
     * time, so the duration does not tell how many leading bytes were right.
     */
    fun check(payload: String?, fingerprint: String): CodeCheck {
        val scanned = parse(payload) ?: return refusal(payload)
        val presented = runCatching { Base64.getDecoder().decode(fingerprint) }.getOrNull()
            ?: return CodeCheck.FITS_NOT
        return if (MessageDigest.isEqual(scanned, presented)) CodeCheck.MATCHES else CodeCheck.FITS_NOT
    }

    /**
     * The hex part of a v1 code, lower case and without separators. Case and pair separators
     * (`:`, spaces) are tolerated: they do not change the value, and the web app shows `AB:CD:…`.
     */
    private fun hexOf(payload: String?): String? {
        val parts = versionAndHash(payload) ?: return null
        if (!parts[0].equals(VERSION, ignoreCase = true) || !parts[1].equals(HASH, ignoreCase = true)) return null
        val hex = parts[2].filterNot { it == ':' || it.isWhitespace() }.lowercase()
        return hex.takeIf { it.length == HASH_BYTES * 2 && it.all { c -> c in "0123456789abcdef" } }
    }

    private fun versionAndHash(payload: String?): List<String>? {
        val text = payload?.trim().orEmpty()
        if (!text.startsWith(PREFIX, ignoreCase = true)) return null
        return text.substring(PREFIX.length).split(':', limit = 3).takeIf { it.size == 3 }
    }

    /** Our prefix with an unknown version or hash gets its own message: the app may be too old. */
    private fun refusal(payload: String?): CodeCheck {
        if (!payload.orEmpty().trim().startsWith(PREFIX, ignoreCase = true)) return CodeCheck.NOT_A_CODE
        val parts = versionAndHash(payload)
        val known = parts != null && parts[0].equals(VERSION, ignoreCase = true) && parts[1].equals(HASH, ignoreCase = true)
        return if (known) CodeCheck.NOT_A_CODE else CodeCheck.UNKNOWN_VERSION
    }
}
