package ch.brickinventoryapp.ui

import ch.brickinventoryapp.util.istFingerabdruck

/**
 * Der Inhalt eines Anmelde-QR-Codes: `{"url": …, "token": "bim:…", "fp": …}`.
 * `fp` ist optional — SHA-256 des SubjectPublicKeyInfo, Base64. Ist es da, pinnt
 * die App genau diesen Schlüssel und fragt beim ersten Kontakt nicht nach.
 */
data class QrLoginPayload(val url: String, val token: String, val fingerabdruck: String? = null)

/**
 * Ein unlesbares `fp` macht den ganzen Code ungültig: Stillschweigend ohne Pin
 * weiterzumachen hiesse, die Prüfung, die der Server verlangt, wegzulassen.
 */
fun parseQrPayload(raw: String): QrLoginPayload? = try {
    val obj = org.json.JSONObject(raw)
    val url = obj.optString("url", "")
    val token = obj.optString("token", "")
    val fp = obj.optString("fp", "").trim().ifEmpty { null }
    when {
        url.isBlank() || !token.startsWith("bim:") -> null
        fp != null && !istFingerabdruck(fp) -> null
        // Ein Pin über http ergibt nichts: Es gibt dort kein Zertifikat.
        fp != null && !url.trim().lowercase().startsWith("https://") -> null
        else -> QrLoginPayload(url, token, fp)
    }
} catch (_: Exception) { null }
