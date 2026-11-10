package ch.brickinventoryapp.anmeldung.ui

import ch.brickinventoryapp.netz.util.NetworkPolicy
import ch.brickinventoryapp.sicherheit.istFingerabdruck

/**
 * Der Inhalt eines Anmelde-QR-Codes: `{"url": …, "token": "bim:…", "fp": …}`.
 * `fp` ist optional — SHA-256 des SubjectPublicKeyInfo, Base64. Ist es da, pinnt
 * die App genau diesen Schlüssel und fragt beim ersten Kontakt nicht nach.
 */
data class QrLoginPayload(val url: String, val token: String, val fingerabdruck: String? = null)

/** http lehnt erst der Dialog ab, mit Anleitung; diese Fehler machen den Code ungültig. */
private val QR_ABGELEHNT = setOf(NetworkPolicy.Adressfehler.UNLESBAR, NetworkPolicy.Adressfehler.BENUTZERANGABE,
    NetworkPolicy.Adressfehler.ZUSATZ)

/**
 * Geprüft vor dem Trimmen: Ein Code hat keinen Grund für Leerraum, aber mit einem
 * Zeilenumbruch stellte ein Angreifer im Dialog einen zweiten, harmlosen Namen hin.
 */
internal fun qrAdresseUngueltig(url: String): Boolean =
    url.any { it.isWhitespace() || it.isISOControl() } ||
        NetworkPolicy.adressfehler(url, NetworkPolicy.entwicklung) in QR_ABGELEHNT

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
        qrAdresseUngueltig(url) -> null
        fp != null && !istFingerabdruck(fp) -> null
        // Ein Pin über http ergibt nichts: Es gibt dort kein Zertifikat.
        fp != null && !url.trim().lowercase().startsWith("https://") -> null
        else -> QrLoginPayload(url, token, fp)
    }
} catch (_: Exception) { null }

/**
 * Der Host des bisherigen Servers, wenn der Code woandershin führt: Das Ja meldet
 * dort ab und schickt alles Weitere an den neuen Server, also sagt der Dialog es.
 */
internal fun qrWechseltServer(bisher: String, code: String): String? {
    if (bisher.isBlank() || NetworkPolicy.gleicheHerkunft(bisher, NetworkPolicy.normalisiere(code))) return null
    return NetworkPolicy.ansicht(bisher)?.host
}
