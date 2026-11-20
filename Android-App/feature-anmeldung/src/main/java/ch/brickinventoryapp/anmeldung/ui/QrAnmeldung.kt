package ch.brickinventoryapp.anmeldung.ui

import ch.brickinventoryapp.netz.util.NetworkPolicy
import ch.brickinventoryapp.sicherheit.isFingerprint

/**
 * Der Inhalt eines Anmelde-QR-Codes: `{"url": …, "token": "bim:…", "fp": …}`.
 * `fp` ist optional — SHA-256 des SubjectPublicKeyInfo, Base64. Ist es da, pinnt
 * die App genau diesen Schlüssel und fragt beim ersten Kontakt nicht nach.
 */
data class QrLoginPayload(val url: String, val token: String, val fingerabdruck: String? = null)

/** http lehnt erst der Dialog ab, mit Anleitung; diese Fehler machen den Code ungültig. */
private val QR_REJECTED = setOf(NetworkPolicy.AddressError.UNLESBAR, NetworkPolicy.AddressError.USER_INPUT,
    NetworkPolicy.AddressError.EXTRA)

/**
 * Geprüft vor dem Trimmen: Ein Code hat keinen Grund für Leerraum, aber mit einem
 * Zeilenumbruch stellte ein Angreifer im Dialog einen zweiten, harmlosen Namen hin.
 */
internal fun qrAddressInvalid(url: String): Boolean =
    url.any { it.isWhitespace() || it.isISOControl() } ||
        NetworkPolicy.addressError(url, NetworkPolicy.entwicklung) in QR_REJECTED

/**
 * Ein unlesbares `fp` macht den ganzen Code ungültig: Stillschweigend ohne Pin
 * weiterzumachen hiesse, die Prüfung, die der Server verlangt, wegzulassen.
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
        // Ein Pin über http ergibt nichts: Es gibt dort kein Zertifikat.
        fp != null && !url.trim().lowercase().startsWith("https://") -> null
        else -> QrLoginPayload(url, token, fp)
    }
} catch (_: Exception) { null }

/**
 * Übernehmen erst nach dem ausdrücklichen Ja zum gezeigten Ziel: Einen Code kann jeder
 * vorhalten, und wer nur auf „Übernehmen“ tippt, hat den Namen darüber nicht gelesen.
 */
internal fun qrUebernehmbar(gesperrt: Boolean, targetConfirmed: Boolean, abtippen: Boolean, eingabe: String): Boolean =
    !gesperrt && targetConfirmed && (!abtippen || eingabe.isNotBlank())

/**
 * Der Host des bisherigen Servers, wenn der Code woandershin führt: Das Ja meldet
 * dort ab und schickt alles Weitere an den neuen Server, also sagt der Dialog es.
 */
internal fun qrSwitchesServer(bisher: String, code: String): String? {
    if (bisher.isBlank() || NetworkPolicy.sameOrigin(bisher, NetworkPolicy.normalize(code))) return null
    return NetworkPolicy.ansicht(bisher)?.host
}
