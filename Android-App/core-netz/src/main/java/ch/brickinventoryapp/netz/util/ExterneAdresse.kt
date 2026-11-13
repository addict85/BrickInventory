package ch.brickinventoryapp.netz.util

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * Was an eine fremde App (Browser) gehen darf: nur https. Die Adressen kommen
 * aus Serverdaten (Anleitungen, Kauf-Links); ein `intent:`, `file:` oder
 * `content:` darin öffnete sonst beliebige Ziele im Gerät. Den eigenen Server
 * öffnet die App selbst, dafür braucht es hier kein http.
 */
fun externeAdresse(url: String?): String? =
    url?.trim()?.toHttpUrlOrNull()?.takeIf { it.isHttps }?.toString()

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
