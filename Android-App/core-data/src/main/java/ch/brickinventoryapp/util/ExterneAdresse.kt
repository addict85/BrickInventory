package ch.brickinventoryapp.util

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * Was an eine fremde App (Browser) gehen darf: nur https. Die Adressen kommen
 * aus Serverdaten (Anleitungen, Kauf-Links); ein `intent:`, `file:` oder
 * `content:` darin öffnete sonst beliebige Ziele im Gerät. Den eigenen Server
 * öffnet die App selbst, dafür braucht es hier kein http.
 */
internal fun externeAdresse(url: String?): HttpUrl? =
    url?.trim()?.toHttpUrlOrNull()?.takeIf { it.isHttps }

/**
 * Ein Pfad des eigenen Servers als volle Adresse — aufgelöst statt verkettet, und
 * nur, wenn er auf demselben Server und unter dessen Unterpfad bleibt:
 * `//fremd.example/x`, `../andere-app/x` oder eine volle Adresse in `local_path`
 * führten sonst den Token-Client zu einer fremden Anwendung.
 */
fun eigeneAdresse(serverUrl: String, pfad: String): String? {
    val basis = (serverUrl.trim().trimEnd('/') + "/").toHttpUrlOrNull() ?: return null
    val ziel = basis.resolve(pfad.trim().removePrefix("/")) ?: return null
    return ziel.takeIf { it.scheme == basis.scheme && it.host == basis.host && it.port == basis.port &&
        NetworkPolicy.imBasisPfad(it, serverUrl) }?.toString()
}

/**
 * Lädt der In-App-Betrachter diese Adresse? Nur vom eigenen Server: Er lädt mit
 * dem Token-Client. Gerendert wird isoliert (PdfRenderDienst), geladen aber hier.
 * Fremde PDFs öffnet das System (oeffneExtern), wie es SetDetailSections tut.
 */
fun pdfImBetrachter(pdfUrl: String, serverUrl: String): Boolean {
    val ziel = pdfUrl.trim().toHttpUrlOrNull() ?: return false
    return serverUrl.isNotBlank() && NetworkPolicy.isSameOrigin(ziel, serverUrl) && NetworkPolicy.imBasisPfad(ziel, serverUrl)
}

/**
 * Die Adresse für die Authenticator-App: nur `otpauth://totp|hotp/…`. Sie kommt
 * vom Server und geht per ACTION_VIEW hinaus; ein anderes Schema (`intent:`,
 * `https:`, `content:`) öffnete sonst ein beliebiges Ziel und gäbe ihm das Geheimnis.
 */
fun otpauthAdresse(url: String?): String? {
    val roh = url?.trim()?.takeIf { it.isNotEmpty() && it.none(Char::isWhitespace) } ?: return null
    val uri = runCatching { java.net.URI(roh) }.getOrNull() ?: return null
    if (!uri.scheme.equals("otpauth", ignoreCase = true) || uri.isOpaque) return null
    return roh.takeIf { uri.host?.lowercase() in setOf("totp", "hotp") }
}
